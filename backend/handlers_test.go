package main

import (
	"bytes"
	"fmt"
	"io"
	"net/http"
	"net/http/httptest"
	"os"
	"path/filepath"
	"strings"
	"sync"
	"testing"
	"time"
)

const testFileID = "11111111-1111-4111-8111-111111111111"

func TestUploadMaxSizeEnforcement(t *testing.T) {
	storage := newTestStorage(t)
	server := httptest.NewServer(NewServer(testConfig(storage), storage, NewRateLimiter(1000)))
	defer server.Close()

	resp, err := http.Post(server.URL+"/api/upload?fileId="+testFileID, "application/octet-stream", strings.NewReader("123456789"))
	if err != nil {
		t.Fatal(err)
	}
	defer resp.Body.Close()

	if resp.StatusCode != http.StatusRequestEntityTooLarge {
		t.Fatalf("status = %d, want %d", resp.StatusCode, http.StatusRequestEntityTooLarge)
	}
	if _, err := os.Stat(storage.filePath(testFileID)); !os.IsNotExist(err) {
		t.Fatalf("oversize upload left target file behind: %v", err)
	}
}

func TestInvalidFileIDRejected(t *testing.T) {
	storage := newTestStorage(t)
	server := httptest.NewServer(NewServer(testConfig(storage), storage, NewRateLimiter(1000)))
	defer server.Close()

	resp, err := http.Post(server.URL+"/api/upload?fileId=../bad", "application/octet-stream", strings.NewReader("ciphertext"))
	if err != nil {
		t.Fatal(err)
	}
	defer resp.Body.Close()

	if resp.StatusCode != http.StatusBadRequest {
		t.Fatalf("status = %d, want %d", resp.StatusCode, http.StatusBadRequest)
	}
}

func TestExpiryDeletion(t *testing.T) {
	storage := newTestStorage(t)
	now := time.Date(2026, 5, 30, 10, 0, 0, 0, time.UTC)
	ttl := 30 * time.Minute

	oldActive := filepath.Join(storage.filesDir, "old-active")
	newActive := filepath.Join(storage.filesDir, "new-active")
	oldClaimed := filepath.Join(storage.claimedDir, "old-claimed")
	newClaimed := filepath.Join(storage.claimedDir, "new-claimed")
	for _, path := range []string{oldActive, newActive, oldClaimed, newClaimed} {
		if err := os.WriteFile(path, []byte("x"), 0o600); err != nil {
			t.Fatal(err)
		}
	}
	oldTime := now.Add(-31 * time.Minute)
	newTime := now.Add(-10 * time.Minute)
	for _, path := range []string{oldActive, oldClaimed} {
		if err := os.Chtimes(path, oldTime, oldTime); err != nil {
			t.Fatal(err)
		}
	}
	for _, path := range []string{newActive, newClaimed} {
		if err := os.Chtimes(path, newTime, newTime); err != nil {
			t.Fatal(err)
		}
	}

	if err := storage.CleanupOnce(now, ttl); err != nil {
		t.Fatal(err)
	}

	assertMissing(t, oldActive)
	assertMissing(t, oldClaimed)
	assertExists(t, newActive)
	assertExists(t, newClaimed)
}

func TestConcurrentDownloadExactlyOneWinner(t *testing.T) {
	storage := newTestStorage(t)
	payload := []byte("encrypted payload")
	if err := os.WriteFile(storage.filePath(testFileID), payload, 0o600); err != nil {
		t.Fatal(err)
	}

	server := httptest.NewServer(NewServer(testConfig(storage), storage, NewRateLimiter(1000)))
	defer server.Close()

	const requests = 100
	start := make(chan struct{})
	results := make(chan int, requests)
	var wg sync.WaitGroup
	for i := 0; i < requests; i++ {
		wg.Add(1)
		go func() {
			defer wg.Done()
			<-start
			resp, err := http.Get(server.URL + "/api/download/" + testFileID)
			if err != nil {
				results <- 0
				return
			}
			body, _ := io.ReadAll(resp.Body)
			_ = resp.Body.Close()
			if resp.StatusCode == http.StatusOK && !bytes.Equal(body, payload) {
				results <- -1
				return
			}
			results <- resp.StatusCode
		}()
	}

	close(start)
	wg.Wait()
	close(results)

	winners := 0
	for status := range results {
		switch status {
		case http.StatusOK:
			winners++
		case http.StatusGone, http.StatusNotFound:
		default:
			t.Fatalf("unexpected status from concurrent download: %d", status)
		}
	}
	if winners != 1 {
		t.Fatalf("winners = %d, want 1", winners)
	}
	assertMissing(t, storage.filePath(testFileID))
}

func TestAbortedDownloadDeletesClaimedFile(t *testing.T) {
	storage := newTestStorage(t)
	if err := os.WriteFile(storage.filePath(testFileID), bytes.Repeat([]byte("x"), 1024*1024), 0o600); err != nil {
		t.Fatal(err)
	}

	handler := NewServer(testConfig(storage), storage, NewRateLimiter(1000))
	req := httptest.NewRequest(http.MethodGet, "/api/download/"+testFileID, nil)
	rw := &failingResponseWriter{header: make(http.Header)}
	handler.ServeHTTP(rw, req)

	if rw.status != http.StatusOK {
		t.Fatalf("status = %d, want %d", rw.status, http.StatusOK)
	}
	assertDirEmpty(t, storage.filesDir)
	assertDirEmpty(t, storage.claimedDir)
}

func TestRateLimiterDoesNotPersistRawIPs(t *testing.T) {
	limiter := NewRateLimiter(5)
	rawIP := "203.0.113.77"
	now := time.Date(2026, 5, 30, 11, 0, 0, 0, time.UTC)

	if !limiter.Allow(rawIP, now) {
		t.Fatal("first request should be allowed")
	}

	keys := limiter.SnapshotKeys()
	if len(keys) != 1 {
		t.Fatalf("keys = %d, want 1", len(keys))
	}
	if keys[0] == rawIP || strings.Contains(keys[0], rawIP) {
		t.Fatalf("rate limiter key contains raw IP: %q", keys[0])
	}
	if strings.Contains(fmt.Sprintf("%+v", limiter), rawIP) {
		t.Fatal("rate limiter state contains raw IP")
	}
}

func newTestStorage(t *testing.T) *Storage {
	t.Helper()
	root := t.TempDir()
	storage, err := NewStorage(filepath.Join(root, "files"), filepath.Join(root, "claimed"))
	if err != nil {
		t.Fatal(err)
	}
	return storage
}

func testConfig(storage *Storage) Config {
	return Config{
		Addr:              "127.0.0.1:0",
		FilesDir:          storage.filesDir,
		ClaimedDir:        storage.claimedDir,
		MaxUploadBytes:    8,
		FileTTL:           30 * time.Minute,
		CleanupInterval:   time.Hour,
		UploadsPerHour:    1000,
		TrustProxyHeaders: false,
	}
}

func assertMissing(t *testing.T, path string) {
	t.Helper()
	if _, err := os.Stat(path); !os.IsNotExist(err) {
		t.Fatalf("%s still exists or stat failed unexpectedly: %v", path, err)
	}
}

func assertExists(t *testing.T, path string) {
	t.Helper()
	if _, err := os.Stat(path); err != nil {
		t.Fatalf("%s missing: %v", path, err)
	}
}

func assertDirEmpty(t *testing.T, dir string) {
	t.Helper()
	entries, err := os.ReadDir(dir)
	if err != nil {
		t.Fatal(err)
	}
	if len(entries) != 0 {
		t.Fatalf("%s contains %d entries, want empty", dir, len(entries))
	}
}

type failingResponseWriter struct {
	header http.Header
	status int
}

func (w *failingResponseWriter) Header() http.Header {
	return w.header
}

func (w *failingResponseWriter) WriteHeader(status int) {
	w.status = status
}

func (w *failingResponseWriter) Write(_ []byte) (int, error) {
	if w.status == 0 {
		w.status = http.StatusOK
	}
	return 0, io.ErrClosedPipe
}
