package main

import (
	"context"
	"os"
	"path/filepath"
	"time"
)

func StartCleanup(ctx context.Context, storage *Storage, ttl, interval time.Duration) {
	if interval <= 0 {
		interval = defaultCleanupInterval
	}
	_ = storage.CleanupOnce(time.Now().UTC(), ttl)

	ticker := time.NewTicker(interval)
	defer ticker.Stop()
	for {
		select {
		case <-ctx.Done():
			return
		case now := <-ticker.C:
			_ = storage.CleanupOnce(now.UTC(), ttl)
		}
	}
}

func (s *Storage) CleanupOnce(now time.Time, ttl time.Duration) error {
	if ttl <= 0 {
		ttl = defaultFileTTL
	}
	cutoff := now.Add(-ttl)
	for _, dir := range []string{s.filesDir, s.claimedDir} {
		if err := removeExpiredFiles(dir, cutoff); err != nil {
			return err
		}
	}
	return nil
}

func removeExpiredFiles(dir string, cutoff time.Time) error {
	entries, err := os.ReadDir(dir)
	if err != nil {
		return err
	}
	for _, entry := range entries {
		if entry.IsDir() {
			continue
		}
		path := filepath.Join(dir, entry.Name())
		info, err := entry.Info()
		if err != nil {
			continue
		}
		if info.ModTime().Before(cutoff) {
			_ = os.Remove(path)
		}
	}
	return nil
}
