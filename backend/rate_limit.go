package main

import (
	"crypto/hmac"
	"crypto/rand"
	"crypto/sha256"
	"encoding/hex"
	"sync"
	"time"
)

type rateBucket struct {
	windowStart time.Time
	count       int
}

type RateLimiter struct {
	mu      sync.Mutex
	limit   int
	salt    []byte
	saltDay string
	buckets map[string]rateBucket
}

func NewRateLimiter(limit int) *RateLimiter {
	return &RateLimiter{
		limit:   limit,
		buckets: make(map[string]rateBucket),
	}
}

func (r *RateLimiter) Allow(rawIP string, now time.Time) bool {
	if r == nil || r.limit <= 0 {
		return true
	}

	now = now.UTC()
	r.mu.Lock()
	defer r.mu.Unlock()

	day := now.Format("2006-01-02")
	if r.saltDay != day {
		r.rotateSaltLocked(day)
	}

	key := r.hashIPLocked(rawIP)
	window := now.Truncate(time.Hour)
	bucket := r.buckets[key]
	if bucket.windowStart != window {
		bucket = rateBucket{windowStart: window}
	}
	if bucket.count >= r.limit {
		return false
	}
	bucket.count++
	r.buckets[key] = bucket
	return true
}

func (r *RateLimiter) SnapshotKeys() []string {
	r.mu.Lock()
	defer r.mu.Unlock()

	keys := make([]string, 0, len(r.buckets))
	for key := range r.buckets {
		keys = append(keys, key)
	}
	return keys
}

func (r *RateLimiter) rotateSaltLocked(day string) {
	salt := make([]byte, 32)
	if _, err := rand.Read(salt); err != nil {
		panic("crypto random failed")
	}
	r.salt = salt
	r.saltDay = day
	r.buckets = make(map[string]rateBucket)
}

func (r *RateLimiter) hashIPLocked(rawIP string) string {
	mac := hmac.New(sha256.New, r.salt)
	_, _ = mac.Write([]byte(rawIP))
	return hex.EncodeToString(mac.Sum(nil))
}
