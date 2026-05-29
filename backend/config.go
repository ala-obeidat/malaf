package main

import (
	"os"
	"strconv"
	"time"
)

const (
	defaultAddr            = "127.0.0.1:8080"
	defaultFilesDir        = "/var/lib/malaf/files"
	defaultClaimedDir      = "/var/lib/malaf/claimed"
	defaultMaxUploadBytes  = int64(100 * 1024 * 1024)
	defaultFileTTL         = 30 * time.Minute
	defaultCleanupInterval = 60 * time.Second
	defaultUploadsPerHour  = 5
)

type Config struct {
	Addr              string
	FilesDir          string
	ClaimedDir        string
	MaxUploadBytes    int64
	FileTTL           time.Duration
	CleanupInterval   time.Duration
	UploadsPerHour    int
	TrustProxyHeaders bool
}

func LoadConfig() Config {
	return Config{
		Addr:              envString("MALAF_ADDR", defaultAddr),
		FilesDir:          envString("MALAF_FILES_DIR", defaultFilesDir),
		ClaimedDir:        envString("MALAF_CLAIMED_DIR", defaultClaimedDir),
		MaxUploadBytes:    envInt64("MALAF_MAX_UPLOAD_BYTES", defaultMaxUploadBytes),
		FileTTL:           envDuration("MALAF_FILE_TTL", defaultFileTTL),
		CleanupInterval:   envDuration("MALAF_CLEANUP_INTERVAL", defaultCleanupInterval),
		UploadsPerHour:    envInt("MALAF_UPLOADS_PER_HOUR", defaultUploadsPerHour),
		TrustProxyHeaders: envBool("MALAF_TRUST_PROXY_HEADERS", false),
	}
}

func envString(name, fallback string) string {
	if value := os.Getenv(name); value != "" {
		return value
	}
	return fallback
}

func envInt(name string, fallback int) int {
	value := os.Getenv(name)
	if value == "" {
		return fallback
	}
	parsed, err := strconv.Atoi(value)
	if err != nil {
		return fallback
	}
	return parsed
}

func envInt64(name string, fallback int64) int64 {
	value := os.Getenv(name)
	if value == "" {
		return fallback
	}
	parsed, err := strconv.ParseInt(value, 10, 64)
	if err != nil {
		return fallback
	}
	return parsed
}

func envDuration(name string, fallback time.Duration) time.Duration {
	value := os.Getenv(name)
	if value == "" {
		return fallback
	}
	parsed, err := time.ParseDuration(value)
	if err != nil {
		return fallback
	}
	return parsed
}

func envBool(name string, fallback bool) bool {
	value := os.Getenv(name)
	if value == "" {
		return fallback
	}
	parsed, err := strconv.ParseBool(value)
	if err != nil {
		return fallback
	}
	return parsed
}
