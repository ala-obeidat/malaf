package main

import (
	"context"
	"errors"
	"log"
	"net/http"
	"os/signal"
	"syscall"
	"time"
)

func main() {
	cfg := LoadConfig()

	storage, err := NewStorage(cfg.FilesDir, cfg.ClaimedDir)
	if err != nil {
		log.Fatal("malaf startup failed")
	}

	ctx, stop := signal.NotifyContext(context.Background(), syscall.SIGINT, syscall.SIGTERM)
	defer stop()

	go StartCleanup(ctx, storage, cfg.FileTTL, cfg.CleanupInterval)

	server := &http.Server{
		Addr:              cfg.Addr,
		Handler:           NewServer(cfg, storage, NewRateLimiter(cfg.UploadsPerHour)),
		ReadHeaderTimeout: 5 * time.Second,
		ReadTimeout:       5 * time.Minute,
		WriteTimeout:      10 * time.Minute,
		IdleTimeout:       60 * time.Second,
	}

	go func() {
		<-ctx.Done()
		shutdownCtx, cancel := context.WithTimeout(context.Background(), 10*time.Second)
		defer cancel()
		_ = server.Shutdown(shutdownCtx)
	}()

	if err := server.ListenAndServe(); err != nil && !errors.Is(err, http.ErrServerClosed) {
		log.Fatal("malaf server stopped")
	}
}
