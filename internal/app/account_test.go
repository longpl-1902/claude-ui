package app

import (
	"errors"
	"os"
	"path/filepath"
	"runtime"
	"strings"
	"sync"
	"testing"

	"github.com/longpl-1902/claude-ui/internal/accounts"
	"github.com/longpl-1902/claude-ui/internal/core"
	"github.com/longpl-1902/claude-ui/internal/statefile"
)

func newAccountStore(t *testing.T, cfgDir string) *Store {
	t.Helper()
	root := t.TempDir()
	list := []core.Account{
		{ID: "acme", Name: "Acme", ConfigDir: filepath.Join(root, ".claude-acme")},
		{ID: "home", Name: "Home", ConfigDir: filepath.Join(root, ".claude-home")},
	}
	return &Store{
		account:  list[0],
		accounts: list,
		dirs:     statefile.AppDirs{Config: cfgDir},
	}
}

func readState(t *testing.T, dir string) accounts.State {
	t.Helper()
	var st accounts.State
	if err := statefile.ReadJSON(filepath.Join(dir, "state.json"), &st); err != nil {
		t.Fatal(err)
	}
	return st
}

func TestSwitchAccountPersists(t *testing.T) {
	cfg := t.TempDir()
	s := newAccountStore(t, cfg)
	msg := s.doSwitchAccount(core.Action{Kind: core.ActionSwitchAccount, ID: "home"})
	if _, ok := msg.(core.ChangedMsg); !ok {
		t.Fatalf("msg = %#v", msg)
	}
	if got := s.Account().ID; got != "home" {
		t.Fatalf("Account() = %q", got)
	}
	st := readState(t, cfg)
	if st.LastAccount != "home" || st.LastAccountAt == 0 {
		t.Fatalf("state = %+v", st)
	}
	// By name, case-insensitive.
	s.doSwitchAccount(core.Action{ID: "ACME"})
	if got := s.Account().ID; got != "acme" {
		t.Fatalf("Account() = %q", got)
	}
}

func TestSwitchAccountUnknown(t *testing.T) {
	cfg := t.TempDir()
	s := newAccountStore(t, cfg)
	msg := s.doSwitchAccount(core.Action{ID: "nope"})
	em, ok := msg.(core.ErrMsg)
	if !ok || em.Text != "unknown account: nope" {
		t.Fatalf("msg = %#v", msg)
	}
	if s.Account().ID != "acme" {
		t.Fatal("account changed")
	}
	if _, err := os.Stat(filepath.Join(cfg, "state.json")); !os.IsNotExist(err) {
		t.Fatalf("state written: %v", err)
	}
}

func TestSwitchAccountSaveFailureKeepsSwitch(t *testing.T) {
	file := filepath.Join(t.TempDir(), "afile")
	if err := os.WriteFile(file, []byte("x"), 0644); err != nil {
		t.Fatal(err)
	}
	s := newAccountStore(t, file) // config "dir" is a file: save must fail
	msg := s.doSwitchAccount(core.Action{ID: "home"})
	em, ok := msg.(core.ErrMsg)
	if !ok || !strings.HasPrefix(em.Text, "could not save last account: ") {
		t.Fatalf("msg = %#v", msg)
	}
	if s.Account().ID != "home" {
		t.Fatal("switch should stay")
	}
}

func TestSwitchAlwaysNever(t *testing.T) {
	cfg := t.TempDir()
	s := newAccountStore(t, cfg)
	s.doSwitchAccount(core.Action{ID: "home", Text: "always"})
	if st := readState(t, cfg); st.AlwaysUse != "home" || st.LastAccount != "home" {
		t.Fatalf("state = %+v", st)
	}
	list := s.withAlwaysUse(s.Accounts())
	if list[0].AlwaysUse || !list[1].AlwaysUse {
		t.Fatalf("AlwaysUse flags = %+v", list)
	}
	s.doSwitchAccount(core.Action{ID: "home", Text: "never"})
	if st := readState(t, cfg); st.AlwaysUse != "" {
		t.Fatalf("state = %+v", st)
	}
	list = s.withAlwaysUse(s.Accounts())
	if list[0].AlwaysUse || list[1].AlwaysUse {
		t.Fatalf("AlwaysUse flags = %+v", list)
	}
}

func TestSwitchAccountConcurrentInstances(t *testing.T) {
	cfg := t.TempDir()
	a := newAccountStore(t, cfg)
	b := newAccountStore(t, cfg)
	var wg sync.WaitGroup
	for i := range 10 {
		wg.Add(2)
		go func() { defer wg.Done(); a.doSwitchAccount(core.Action{ID: "acme"}) }()
		go func() { defer wg.Done(); b.doSwitchAccount(core.Action{ID: "home"}) }()
		_ = i
	}
	wg.Wait()
	st := readState(t, cfg) // must be valid JSON
	if st.LastAccount != "acme" && st.LastAccount != "home" {
		t.Fatalf("state = %+v", st)
	}
}

func TestBuildSignInCmd(t *testing.T) {
	s := newAccountStore(t, t.TempDir())
	if _, _, err := s.buildSignInCmd(core.Action{ID: "acme"}); err == nil {
		t.Fatal("expected error when claude path is missing")
	}
	s.claudePath = filepath.Join(t.TempDir(), "claude-fake")
	cmd, acct, err := s.buildSignInCmd(core.Action{ID: "home"})
	if err != nil {
		t.Fatal(err)
	}
	if acct.ID != "home" || cmd.Path != s.claudePath {
		t.Fatalf("acct=%v path=%q", acct.ID, cmd.Path)
	}
	if got := strings.Join(cmd.Args[1:], " "); got != "auth login" {
		t.Fatalf("args = %q", got)
	}
	want := "CLAUDE_CONFIG_DIR=" + acct.ConfigDir
	found := false
	for _, e := range cmd.Env {
		if e == want {
			found = true
		}
	}
	if !found {
		t.Fatalf("env lacks %s", want)
	}
	if _, _, err := s.buildSignInCmd(core.Action{ID: "zzz"}); err == nil {
		t.Fatal("expected unknown account error")
	}
}

func TestSignInFakeBinaryAndReload(t *testing.T) {
	if runtime.GOOS == "windows" {
		t.Skip("shell script fake")
	}
	s := newAccountStore(t, t.TempDir())
	dir := s.accounts[1].ConfigDir
	if err := os.MkdirAll(dir, 0755); err != nil {
		t.Fatal(err)
	}
	// The fake "claude" writes a signed-in .claude.json into CLAUDE_CONFIG_DIR.
	bin := filepath.Join(t.TempDir(), "claude")
	script := "#!/bin/sh\n[ \"$1 $2\" = \"auth login\" ] || exit 3\n" +
		`printf '{"oauthAccount":{"emailAddress":"u@example.com","organizationName":"acme"}}' > "$CLAUDE_CONFIG_DIR/.claude.json"` + "\n"
	if err := os.WriteFile(bin, []byte(script), 0755); err != nil {
		t.Fatal(err)
	}
	s.claudePath = bin

	cmd, acct, err := s.buildSignInCmd(core.Action{ID: "home"})
	if err != nil {
		t.Fatal(err)
	}
	if err := cmd.Run(); err != nil {
		t.Fatal(err)
	}
	msg := s.signInDone(acct.ID, nil)
	if _, ok := msg.(core.ChangedMsg); !ok {
		t.Fatalf("msg = %#v", msg)
	}
	got := s.Accounts()[1]
	if !got.SignedIn || got.Email != "u@example.com" || got.Org != "acme" {
		t.Fatalf("account = %+v", got)
	}

	em, ok := s.signInDone(acct.ID, errors.New("exit status 1")).(core.ErrMsg)
	if !ok || em.Text != "sign-in failed: exit status 1" {
		t.Fatalf("msg = %#v", em)
	}
}
