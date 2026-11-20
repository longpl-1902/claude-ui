package app

import (
	"fmt"
	"os"
	"os/exec"
	"path/filepath"
	"strings"
	"sync"
	"time"

	"github.com/longpl-1902/claude-ui/internal/accounts"
	"github.com/longpl-1902/claude-ui/internal/control"
	"github.com/longpl-1902/claude-ui/internal/core"
	"github.com/longpl-1902/claude-ui/internal/statefile"

	tea "charm.land/bubbletea/v2"
)

func (s *Store) statePath() string {
	return filepath.Join(s.dirs.Config, "state.json")
}

// findAccountLocked looks an account up by ID or (case-insensitive) name.
// The caller holds s.mu.
func (s *Store) findAccountLocked(id string) (core.Account, int, bool) {
	for i, a := range s.accounts {
		if string(a.ID) == id {
			return a, i, true
		}
	}
	for i, a := range s.accounts {
		if strings.EqualFold(a.Name, id) || strings.EqualFold(string(a.ID), id) {
			return a, i, true
		}
	}
	return core.Account{}, -1, false
}

// doSwitchAccount makes a.ID the active account and persists it as the last
// used one. a.Text "always" / "never" also sets / clears the "always use"
// account. Controlled sessions of the previous account keep running.
func (s *Store) doSwitchAccount(a core.Action) tea.Msg {
	s.mu.Lock()
	acct, _, ok := s.findAccountLocked(a.ID)
	if ok {
		s.account = acct
	}
	s.mu.Unlock()
	if !ok {
		return core.ErrMsg{Text: "unknown account: " + a.ID}
	}

	id := string(acct.ID)
	err := statefile.Update(s.statePath(), func(st *accounts.State) error {
		st.LastAccount = id
		st.LastAccountAt = time.Now().UnixMilli()
		switch a.Text {
		case "always":
			st.AlwaysUse = id
		case "never":
			st.AlwaysUse = ""
		}
		return nil
	})
	invalidateAlwaysCache(s.statePath())
	if err != nil {
		return core.ErrMsg{Text: "could not save last account: " + err.Error()}
	}
	return core.ChangedMsg{}
}

// buildSignInCmd prepares `claude auth login` for the account a.ID.
func (s *Store) buildSignInCmd(a core.Action) (*exec.Cmd, core.Account, error) {
	s.mu.Lock()
	acct, _, ok := s.findAccountLocked(a.ID)
	claudePath := s.claudePath
	s.mu.Unlock()
	if !ok {
		return nil, core.Account{}, fmt.Errorf("unknown account: %s", a.ID)
	}
	if claudePath == "" {
		return nil, acct, fmt.Errorf("claude executable not found; set prefs.claudePath")
	}
	env, err := control.ChildEnv(os.Environ(), acct.ConfigDir)
	if err != nil {
		return nil, acct, fmt.Errorf("sign-in: %w", err)
	}
	home, _ := os.UserHomeDir()
	cmd := &exec.Cmd{
		Path: claudePath,
		Args: []string{claudePath, "auth", "login"},
		Env:  env,
		Dir:  home,
	}
	return cmd, acct, nil
}

// signInCmd runs the official `claude auth login` flow in the foreground
// (the TUI is suspended). It spends no tokens and never reads credentials.
func (s *Store) signInCmd(a core.Action) tea.Cmd {
	cmd, acct, err := s.buildSignInCmd(a)
	if err != nil {
		return func() tea.Msg { return core.ErrMsg{Text: err.Error()} }
	}
	return tea.ExecProcess(cmd, func(err error) tea.Msg {
		return s.signInDone(acct.ID, err)
	})
}

func (s *Store) signInDone(id core.AccountID, err error) tea.Msg {
	s.reloadDisplay(id)
	if err != nil {
		return core.ErrMsg{Text: "sign-in failed: " + err.Error()}
	}
	return core.ChangedMsg{}
}

// reloadDisplay re-reads email / org / signed-in state of one account.
func (s *Store) reloadDisplay(id core.AccountID) {
	s.mu.Lock()
	var configDir string
	for _, a := range s.accounts {
		if a.ID == id {
			configDir = a.ConfigDir
			break
		}
	}
	s.mu.Unlock()
	if configDir == "" {
		return
	}
	home, _ := os.UserHomeDir()
	d := accounts.ReadDisplay(configDir, home) // file I/O outside the lock

	s.mu.Lock()
	defer s.mu.Unlock()
	apply := func(a *core.Account) {
		a.Email, a.Org, a.SignedIn = d.Email, d.Org, d.SignedIn
	}
	for i := range s.accounts {
		if s.accounts[i].ID == id {
			apply(&s.accounts[i])
		}
	}
	if s.account.ID == id {
		apply(&s.account)
	}
}

// --- "always use" marker, cached for one second ---

type alwaysEntry struct {
	at time.Time
	id string
}

var (
	alwaysMu    sync.Mutex
	alwaysCache = map[string]alwaysEntry{}
)

func invalidateAlwaysCache(path string) {
	alwaysMu.Lock()
	delete(alwaysCache, path)
	alwaysMu.Unlock()
}

// alwaysUseID returns State.AlwaysUse, reading the state file at most once per second.
func (s *Store) alwaysUseID() string {
	path := s.statePath()
	alwaysMu.Lock()
	e, ok := alwaysCache[path]
	alwaysMu.Unlock()
	if ok && time.Since(e.at) < time.Second {
		return e.id
	}
	var st accounts.State
	_ = statefile.ReadJSON(path, &st)
	alwaysMu.Lock()
	alwaysCache[path] = alwaysEntry{at: time.Now(), id: st.AlwaysUse}
	alwaysMu.Unlock()
	return st.AlwaysUse
}

// withAlwaysUse returns a copy of list with AlwaysUse set on the account that
// State.AlwaysUse names. Store.Accounts() calls it (without holding s.mu).
func (s *Store) withAlwaysUse(list []core.Account) []core.Account {
	id := s.alwaysUseID()
	for i := range list {
		list[i].AlwaysUse = id != "" && string(list[i].ID) == id
	}
	return list
}
