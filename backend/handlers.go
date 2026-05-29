package main

import (
	"encoding/json"
	"errors"
	"net"
	"net/http"
	"regexp"
	"strconv"
	"strings"
	"time"
)

var fileIDPattern = regexp.MustCompile(`^[a-f0-9]{8}-[a-f0-9]{4}-4[a-f0-9]{3}-[89ab][a-f0-9]{3}-[a-f0-9]{12}$`)

type Server struct {
	cfg     Config
	storage *Storage
	limiter *RateLimiter
	now     func() time.Time
}

func NewServer(cfg Config, storage *Storage, limiter *RateLimiter) http.Handler {
	return &Server{
		cfg:     cfg,
		storage: storage,
		limiter: limiter,
		now:     func() time.Time { return time.Now().UTC() },
	}
}

func (s *Server) ServeHTTP(w http.ResponseWriter, r *http.Request) {
	setAPIHeaders(w)

	switch {
	case r.Method == http.MethodGet && r.URL.Path == "/api/health":
		s.handleHealth(w, r)
	case r.Method == http.MethodPost && r.URL.Path == "/api/upload":
		s.handleUpload(w, r)
	case r.Method == http.MethodGet && strings.HasPrefix(r.URL.Path, "/api/stat/"):
		s.handleStat(w, r)
	case r.Method == http.MethodGet && strings.HasPrefix(r.URL.Path, "/api/download/"):
		s.handleDownload(w, r)
	default:
		http.NotFound(w, r)
	}
}

func setAPIHeaders(w http.ResponseWriter) {
	w.Header().Set("Cache-Control", "no-store")
	w.Header().Set("X-Content-Type-Options", "nosniff")
	w.Header().Set("Referrer-Policy", "no-referrer")
}

func (s *Server) handleHealth(w http.ResponseWriter, _ *http.Request) {
	w.Header().Set("Content-Type", "application/json")
	_, _ = w.Write([]byte(`{"ok":true}`))
}

func (s *Server) handleUpload(w http.ResponseWriter, r *http.Request) {
	fileID := r.URL.Query().Get("fileId")
	if !validFileID(fileID) {
		http.Error(w, "invalid file id", http.StatusBadRequest)
		return
	}

	if s.limiter != nil && !s.limiter.Allow(clientIP(r, s.cfg.TrustProxyHeaders), s.now()) {
		http.Error(w, "rate limit exceeded", http.StatusTooManyRequests)
		return
	}

	body := http.MaxBytesReader(w, r.Body, s.cfg.MaxUploadBytes)
	defer body.Close()

	err := s.storage.StoreUpload(r.Context(), fileID, body)
	switch {
	case err == nil:
		w.Header().Set("Content-Type", "application/json")
		w.WriteHeader(http.StatusCreated)
		_, _ = w.Write([]byte(`{"ok":true}`))
	case errors.Is(err, ErrDuplicate):
		http.Error(w, "file already exists", http.StatusConflict)
	case isMaxBytesError(err):
		http.Error(w, "upload too large", http.StatusRequestEntityTooLarge)
	default:
		http.Error(w, "upload failed", http.StatusInternalServerError)
	}
}

func (s *Server) handleStat(w http.ResponseWriter, r *http.Request) {
	fileID := strings.TrimPrefix(r.URL.Path, "/api/stat/")
	if !validFileID(fileID) {
		http.Error(w, "invalid file id", http.StatusBadRequest)
		return
	}

	size, err := s.storage.Stat(fileID)
	if err != nil {
		http.Error(w, "not found", http.StatusNotFound)
		return
	}

	w.Header().Set("Content-Type", "application/json")
	_ = json.NewEncoder(w).Encode(struct {
		Exists bool  `json:"exists"`
		Size   int64 `json:"size"`
	}{Exists: true, Size: size})
}

func (s *Server) handleDownload(w http.ResponseWriter, r *http.Request) {
	fileID := strings.TrimPrefix(r.URL.Path, "/api/download/")
	if !validFileID(fileID) {
		http.Error(w, "invalid file id", http.StatusBadRequest)
		return
	}

	claimed, err := s.storage.ClaimAndOpen(fileID)
	if err != nil {
		http.Error(w, "gone", http.StatusGone)
		return
	}
	defer claimed.Close()

	w.Header().Set("Content-Type", "application/octet-stream")
	w.Header().Set("Content-Disposition", `attachment; filename="malaf.bin"`)
	w.Header().Set("Content-Length", strconv.FormatInt(claimed.Size, 10))
	w.WriteHeader(http.StatusOK)
	_, _ = claimed.WriteTo(w)
}

func validFileID(fileID string) bool {
	return fileIDPattern.MatchString(fileID)
}

func isMaxBytesError(err error) bool {
	var maxBytesErr *http.MaxBytesError
	return errors.As(err, &maxBytesErr)
}

func clientIP(r *http.Request, trustProxyHeaders bool) string {
	if trustProxyHeaders {
		if ip := strings.TrimSpace(r.Header.Get("CF-Connecting-IP")); net.ParseIP(ip) != nil {
			return ip
		}
		for _, part := range strings.Split(r.Header.Get("X-Forwarded-For"), ",") {
			ip := strings.TrimSpace(part)
			if net.ParseIP(ip) != nil {
				return ip
			}
		}
	}

	host, _, err := net.SplitHostPort(r.RemoteAddr)
	if err == nil {
		return host
	}
	return r.RemoteAddr
}
