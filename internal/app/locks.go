package app

import (
	"encoding/json"
	"errors"
	"fmt"
	"math/rand/v2"
	"os"
	"path/filepath"
	"runtime"
	"syscall"
	"time"
)

// LockInfo represents a session lock held by an ac instance.
type LockInfo struct {
	PID     int       `json:"pid"`
	Account string    `json:"account"`
	Since   time.Time `json:"since"`
}

func lockPath(locksDir, sessionID string) string {
	return filepath.Join(locksDir, sessionID+".lock")
}

func readLock(path string) (*LockInfo, error) {
	data, err := os.ReadFile(path)
	if err != nil {
		return nil, err
	}
	var info LockInfo
	if err := json.Unmarshal(data, &info); err != nil {
		return nil, err
	}
	return &info, nil
}

// createLockExclusive writes the lock content to a temp file and hard-links it
// into place. The link fails if the lock already exists, so creation is atomic
// and readers never observe a partially written lock.
func createLockExclusive(path string, info LockInfo) error {
	if err := os.MkdirAll(filepath.Dir(path), 0755); err != nil {
		return err
	}
	data, err := json.MarshalIndent(info, "", "  ")
	if err != nil {
		return err
	}
	tmp := fmt.Sprintf("%s.tmp-%d-%d", path, os.Getpid(), rand.IntN(1000000))
	if err := os.WriteFile(tmp, data, 0644); err != nil {
		return err
	}
	defer os.Remove(tmp)
	return os.Link(tmp, path)
}

// AcquireLock tries to take the lock for a session. Returns (true, info, nil)
// if acquired (including when this process already holds it). Returns
// (false, info, nil) with the existing lock info if another live process holds it.
func AcquireLock(locksDir, sessionID string) (bool, *LockInfo, error) {
	path := lockPath(locksDir, sessionID)
	mine := LockInfo{PID: os.Getpid(), Since: time.Now().UTC()}

	for range 5 {
		err := createLockExclusive(path, mine)
		if err == nil {
			return true, &mine, nil
		}
		if !errors.Is(err, os.ErrExist) {
			return false, nil, err
		}

		existing, rerr := readLock(path)
		if rerr != nil {
			if errors.Is(rerr, os.ErrNotExist) {
				continue // released between attempts
			}
			// Corrupt lock: treat as stale.
			os.Remove(path)
			continue
		}
		if existing.PID == os.Getpid() {
			return true, existing, nil
		}
		if isProcessAlive(existing.PID) {
			return false, existing, nil
		}
		os.Remove(path) // stale
	}
	return false, nil, fmt.Errorf("could not acquire lock for session %s", sessionID)
}

// ReleaseLock removes the lock file for a session. Missing file is not an error.
func ReleaseLock(locksDir, sessionID string) error {
	err := os.Remove(lockPath(locksDir, sessionID))
	if err != nil && !errors.Is(err, os.ErrNotExist) {
		return err
	}
	return nil
}

// CheckLock reads the lock file and checks if the holder is alive.
// Returns nil if no lock or stale lock (auto-cleaned).
func CheckLock(locksDir, sessionID string) *LockInfo {
	path := lockPath(locksDir, sessionID)
	info, err := readLock(path)
	if err != nil {
		if !errors.Is(err, os.ErrNotExist) {
			os.Remove(path)
		}
		return nil
	}
	if !isProcessAlive(info.PID) {
		os.Remove(path)
		return nil
	}
	return info
}

// isProcessAlive checks if a pid is still running.
func isProcessAlive(pid int) bool {
	if pid <= 0 {
		return false
	}
	p, err := os.FindProcess(pid)
	if err != nil {
		return false
	}
	if runtime.GOOS == "windows" {
		// FindProcess uses OpenProcess on Windows and fails for dead pids.
		p.Release()
		return true
	}
	err = p.Signal(syscall.Signal(0))
	return err == nil || errors.Is(err, syscall.EPERM)
}
