package main

import (
	"context"
	"crypto/rand"
	"encoding/hex"
	"errors"
	"io"
	"os"
	"path/filepath"
	"sync"
)

var (
	ErrDuplicate = errors.New("duplicate file id")
	ErrNotFound  = errors.New("file not found")
)

type Storage struct {
	filesDir   string
	claimedDir string
	mu         sync.Mutex
}

type ClaimedFile struct {
	*os.File
	Path          string
	Size          int64
	removeOnClose bool
}

func NewStorage(filesDir, claimedDir string) (*Storage, error) {
	if err := os.MkdirAll(filesDir, 0o700); err != nil {
		return nil, err
	}
	if err := os.MkdirAll(claimedDir, 0o700); err != nil {
		return nil, err
	}
	if err := verifyAtomicRename(filesDir, claimedDir); err != nil {
		return nil, err
	}
	return &Storage{filesDir: filesDir, claimedDir: claimedDir}, nil
}

func (s *Storage) StoreUpload(ctx context.Context, fileID string, src io.Reader) error {
	target := s.filePath(fileID)
	if _, err := os.Stat(target); err == nil {
		return ErrDuplicate
	} else if err != nil && !errors.Is(err, os.ErrNotExist) {
		return err
	}

	tmp, err := os.CreateTemp(s.filesDir, ".upload-*")
	if err != nil {
		return err
	}
	tmpPath := tmp.Name()
	complete := false
	defer func() {
		if !complete {
			_ = os.Remove(tmpPath)
		}
	}()

	_, err = io.CopyBuffer(tmp, &contextReader{ctx: ctx, reader: src}, make([]byte, 1024*1024))
	if closeErr := tmp.Close(); err == nil {
		err = closeErr
	}
	if err != nil {
		return err
	}

	if err := promoteNoReplace(tmpPath, target, &s.mu); err != nil {
		return err
	}
	complete = true
	return nil
}

func (s *Storage) Stat(fileID string) (int64, error) {
	info, err := os.Stat(s.filePath(fileID))
	if err != nil {
		return 0, ErrNotFound
	}
	if info.IsDir() {
		return 0, ErrNotFound
	}
	return info.Size(), nil
}

func (s *Storage) ClaimAndOpen(fileID string) (*ClaimedFile, error) {
	source := s.filePath(fileID)
	claimed := filepath.Join(s.claimedDir, fileID+"."+randomHex(16))

	if err := os.Rename(source, claimed); err != nil {
		return nil, ErrNotFound
	}

	file, err := os.Open(claimed)
	if err != nil {
		_ = os.Remove(claimed)
		return nil, err
	}

	info, err := file.Stat()
	if err != nil {
		_ = file.Close()
		_ = os.Remove(claimed)
		return nil, err
	}

	removeOnClose := false
	if err := os.Remove(claimed); err != nil {
		removeOnClose = true
	}

	return &ClaimedFile{
		File:          file,
		Path:          claimed,
		Size:          info.Size(),
		removeOnClose: removeOnClose,
	}, nil
}

func (c *ClaimedFile) Close() error {
	err := c.File.Close()
	if c.removeOnClose {
		_ = os.Remove(c.Path)
	}
	return err
}

func (c *ClaimedFile) WriteTo(w io.Writer) (int64, error) {
	return io.CopyBuffer(w, c.File, make([]byte, 1024*1024))
}

func (s *Storage) filePath(fileID string) string {
	return filepath.Join(s.filesDir, fileID)
}

func promoteNoReplace(source, target string, mu *sync.Mutex) error {
	if err := os.Link(source, target); err == nil {
		_ = os.Remove(source)
		return nil
	} else if errors.Is(err, os.ErrExist) {
		return ErrDuplicate
	}

	mu.Lock()
	defer mu.Unlock()

	if _, err := os.Stat(target); err == nil {
		return ErrDuplicate
	} else if err != nil && !errors.Is(err, os.ErrNotExist) {
		return err
	}
	return os.Rename(source, target)
}

func verifyAtomicRename(filesDir, claimedDir string) error {
	tmp, err := os.CreateTemp(filesDir, ".fscheck-*")
	if err != nil {
		return err
	}
	source := tmp.Name()
	_ = tmp.Close()
	target := filepath.Join(claimedDir, filepath.Base(source))
	if err := os.Rename(source, target); err != nil {
		_ = os.Remove(source)
		return err
	}
	return os.Remove(target)
}

func randomHex(bytesLen int) string {
	buf := make([]byte, bytesLen)
	if _, err := rand.Read(buf); err != nil {
		panic("crypto random failed")
	}
	return hex.EncodeToString(buf)
}

type contextReader struct {
	ctx    context.Context
	reader io.Reader
}

func (r *contextReader) Read(p []byte) (int, error) {
	select {
	case <-r.ctx.Done():
		return 0, r.ctx.Err()
	default:
		return r.reader.Read(p)
	}
}
