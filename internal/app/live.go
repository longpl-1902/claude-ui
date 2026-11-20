package app

import (
	"fmt"
	"os"
	"path/filepath"
	"strconv"
	"strings"

	"github.com/longpl-1902/claude-ui/internal/core"
	"github.com/longpl-1902/claude-ui/internal/safefs"
	"github.com/longpl-1902/claude-ui/internal/transcript"
)

// snapshotPIDs records the pids of our own children. It calls controller
// methods, so it must run without mu held; refreshLive then reads the
// snapshot under mu.
func (s *Store) snapshotPIDs() {
	s.mu.Lock()
	list := make([]controller, 0, len(s.controlSessions))
	for _, cs := range s.controlSessions {
		list = append(list, cs.ctl)
	}
	s.mu.Unlock()

	pids := make(map[int]bool, len(list))
	for _, c := range list {
		if pid := c.Info().PID; pid > 0 {
			pids[pid] = true
		}
	}

	s.mu.Lock()
	s.pids = pids
	s.mu.Unlock()
}

// isDraft reports whether a row is a draft that has no session id yet.
func isDraft(k core.SessionKey) bool { return k.SessionID == "" && k.DraftID != "" }

func registryWhere(e transcript.RegistryEntry) string {
	switch core.SourceFromString(e.Entrypoint) {
	case core.SourceVSCode:
		return "VS Code"
	case core.SourceSDK:
		return fmt.Sprintf("an SDK process (pid %d)", e.PID)
	default:
		return fmt.Sprintf("a terminal (pid %d)", e.PID)
	}
}

func otherACWhere(info LockInfo) string {
	if info.Account != "" {
		return fmt.Sprintf("another ac (pid %d, %s)", info.PID, info.Account)
	}
	return fmt.Sprintf("another ac (pid %d)", info.PID)
}

// refreshLive recomputes Ctl, CtlWhere and Status of every session of acct
// that this process does not control (mu held). locks may be nil, in which
// case the lock directory is read.
func (s *Store) refreshLive(acct core.Account, locks map[string]LockInfo) {
	if locks == nil {
		locks = ListLocks(s.dirs.Locks)
	}

	// 1. reset everything we do not control
	for id, ss := range s.sessions {
		if ss.summary.Key.Account != acct.ID || isDraft(ss.summary.Key) {
			continue
		}
		if _, mine := s.controlSessions[id]; mine {
			continue
		}
		ss.summary.Ctl = core.Ctl{}
		ss.summary.CtlWhere = ""
		ss.summary.Status = core.StatusDone
		ss.summary.Blocked = false
		ss.summary.Reason = ""
	}

	// 2. registry written by claude processes
	sessDir := filepath.Join(acct.ConfigDir, "sessions")
	if regEntries, err := safefs.ReadDir(sessDir); err == nil {
		for _, re := range regEntries {
			name := re.Name()
			if !strings.HasSuffix(name, ".json") {
				continue
			}
			if _, err := strconv.Atoi(strings.TrimSuffix(name, ".json")); err != nil {
				continue
			}
			data, err := safefs.ReadFile(filepath.Join(sessDir, name))
			if err != nil {
				continue
			}
			entry, ok := transcript.ParseRegistryEntry(data)
			if !ok || s.pids[entry.PID] || !isProcessAlive(entry.PID) {
				continue
			}
			if _, mine := s.controlSessions[entry.SessionID]; mine {
				continue
			}
			ss, exists := s.sessions[entry.SessionID]
			if !exists || ss.summary.Key.Account != acct.ID {
				continue
			}
			where := registryWhere(entry)
			ss.summary.Status = registryStatus(entry.Status)
			ss.summary.Source = core.SourceFromString(entry.Entrypoint)
			if entry.Name != "" {
				ss.summary.Title = entry.Name
			}
			ss.summary.Ctl = core.Ctl{Kind: core.CtlElsewhere, PID: entry.PID}
			ss.summary.CtlWhere = where
			ss.summary.Blocked = entry.Status == "waiting"
			if ss.summary.Blocked {
				ss.summary.Reason = "waiting in " + where
			}
		}
	}

	// 3. locks held by another ac win over the registry
	for id, info := range locks {
		if info.PID == os.Getpid() {
			continue
		}
		if _, mine := s.controlSessions[id]; mine {
			continue
		}
		ss, exists := s.sessions[id]
		if !exists || ss.summary.Key.Account != acct.ID {
			continue
		}
		ss.summary.Ctl = core.Ctl{Kind: core.CtlOtherAC, PID: info.PID}
		ss.summary.CtlWhere = otherACWhere(info)
	}

	// 4. sessions we control
	for _, cs := range s.controlSessions {
		if cs.account.ID == acct.ID {
			s.syncSummary(cs)
		}
	}
}
