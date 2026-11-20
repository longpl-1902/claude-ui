package app

import (
	"encoding/json"
	"errors"
	"fmt"
	"math/rand/v2"
	"os"
	"path/filepath"
	"regexp"
	"strings"
	"time"

	"github.com/longpl-1902/claude-ui/internal/core"
	"github.com/longpl-1902/claude-ui/internal/statefile"
)

// LockInfo represents a session lock held by an ac instance.
type LockInfo struct {
	PID     int       `json:"pid"`
	Account string    `json:"account"`
	Since   time.Time `json:"since"`
	// Started is the holder's process start time in Unix ms (0 when unknown).
	Started int64 `json:"started,omitempty"`
}

var sessionIDRe = regexp.MustCompile(`^[0-9a-fA-F]{8}-[0-9a-fA-F]{4}-[0-9a-fA-F]{4}-[0-9a-fA-F]{4}-[0-9a-fA-F]{12}$`)

func validSessionID(id string) bool { return sessionIDRe.MatchString(id) }

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
	if err := statefile.WriteFileSync(tmp, data); err != nil {
		os.Remove(tmp)
		return err
	}
	defer os.Remove(tmp)
	return os.Link(tmp, path)
}

// lockAlive reports whether the holder of a lock is still the same live
// process. A start-time mismatch (±1 s) means the pid was reused.
func lockAlive(info LockInfo) bool {
	if !isProcessAlive(info.PID) {
		return false
	}
	if info.Started != 0 {
		if st := processStart(info.PID); st != 0 {
			d := st - info.Started
			if d < -1000 || d > 1000 {
				return false
			}
		}
	}
	return true
}

// removeIfSame removes the lock file only if it still holds the same content
// we judged stale, so a lock freshly taken by another instance is not deleted.
func removeIfSame(path string, stale LockInfo) {
	cur, err := readLock(path)
	if err != nil {
		if errors.Is(err, os.ErrNotExist) {
			return
		}
		os.Remove(path) // corrupt
		return
	}
	if cur.PID == stale.PID && cur.Started == stale.Started && cur.Since.Equal(stale.Since) {
		os.Remove(path)
	}
}

// AcquireLock tries to take the lock for a session. Returns (true, info, nil)
// if acquired (including when this process already holds it). Returns
// (false, info, nil) with the existing lock info if another live process holds it.
func AcquireLock(locksDir, sessionID string, account core.AccountID) (bool, *LockInfo, error) {
	if !validSessionID(sessionID) {
		return false, nil, fmt.Errorf("invalid session id %q", sessionID)
	}
	path := lockPath(locksDir, sessionID)
	mine := LockInfo{
		PID:     os.Getpid(),
		Account: string(account),
		Since:   time.Now().UTC(),
		Started: processStart(os.Getpid()),
	}

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
		if lockAlive(*existing) {
			return false, existing, nil
		}
		removeIfSame(path, *existing)
	}
	return false, nil, fmt.Errorf("could not acquire lock for session %s", sessionID)
}

// ReleaseLock removes the lock file for a session, only if it is ours.
// A missing file is not an error.
func ReleaseLock(locksDir, sessionID string) error {
	if !validSessionID(sessionID) {
		return fmt.Errorf("invalid session id %q", sessionID)
	}
	path := lockPath(locksDir, sessionID)
	info, err := readLock(path)
	if err != nil {
		if errors.Is(err, os.ErrNotExist) {
			return nil
		}
		// Corrupt: nobody can own it; clean it up.
		os.Remove(path)
		return nil
	}
	if info.PID != os.Getpid() {
		return nil
	}
	err = os.Remove(path)
	if err != nil && !errors.Is(err, os.ErrNotExist) {
		return err
	}
	return nil
}

// CheckLock reads the lock file and checks if the holder is alive.
// Returns nil if no lock or stale lock (auto-cleaned).
func CheckLock(locksDir, sessionID string) *LockInfo {
	if !validSessionID(sessionID) {
		return nil
	}
	path := lockPath(locksDir, sessionID)
	info, err := readLock(path)
	if err != nil {
		if !errors.Is(err, os.ErrNotExist) {
			os.Remove(path)
		}
		return nil
	}
	if !lockAlive(*info) {
		removeIfSame(path, *info)
		return nil
	}
	return info
}

// ListLocks returns all live locks keyed by session id (including ours;
// callers filter by pid). Stale and corrupt locks are removed.
func ListLocks(locksDir string) map[string]LockInfo {
	out := map[string]LockInfo{}
	entries, err := os.ReadDir(locksDir)
	if err != nil {
		return out
	}
	for _, e := range entries {
		name := e.Name()
		if e.IsDir() || strings.Contains(name, ".tmp-") || !strings.HasSuffix(name, ".lock") {
			continue
		}
		id := strings.TrimSuffix(name, ".lock")
		if !validSessionID(id) {
			continue
		}
		path := filepath.Join(locksDir, name)
		info, err := readLock(path)
		if err != nil {
			if !errors.Is(err, os.ErrNotExist) {
				os.Remove(path)
			}
			continue
		}
		if !lockAlive(*info) {
			removeIfSame(path, *info)
			continue
		}
		out[id] = *info
	}
	return out
}
