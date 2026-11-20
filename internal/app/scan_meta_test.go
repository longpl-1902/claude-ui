package app

import (
	"os"
	"path/filepath"
	"strings"
	"testing"
	"time"

	"github.com/longpl-1902/claude-ui/internal/core"
)

func realUserLine(cwdJSON, text string) string {
	return `{"parentUuid":null,"isSidechain":false,"cwd":` + cwdJSON + `,"sessionId":"s","version":"2.0.0","gitBranch":"main","type":"user","message":{"role":"user","content":"` + text + `"},"uuid":"u1","timestamp":"2026-03-01T10:00:00.000Z"}`
}

func writeRaw(t *testing.T, acct core.Account, dir, id string, lines ...string) string {
	t.Helper()
	d := filepath.Join(acct.ConfigDir, "projects", dir)
	if err := os.MkdirAll(d, 0o755); err != nil {
		t.Fatal(err)
	}
	p := filepath.Join(d, id+".jsonl")
	if err := os.WriteFile(p, []byte(strings.Join(lines, "\r\n")+"\r\n"), 0o644); err != nil {
		t.Fatal(err)
	}
	now := time.Now()
	_ = os.Chtimes(p, now, now)
	return p
}

func byID(list []core.SessionSummary) map[string]core.SessionSummary {
	m := map[string]core.SessionSummary{}
	for _, s := range list {
		m[s.Key.SessionID] = s
	}
	return m
}

func TestScan_RealShapedTranscripts(t *testing.T) {
	s, _, env := newTestStoreEnv(t)
	dir := "C--Users-u-work-acme"
	winCwd := `"C:\\Users\\u\\work\\acme"`

	// cwd top-level, no title records: title falls back to the first prompt.
	writeRaw(t, env.Acct, dir, "s-prompt",
		`{"type":"file-history-snapshot","messageId":"m","snapshot":{},"isSnapshotUpdate":false}`,
		realUserLine(winCwd, "Fix the login redirect bug"))
	// ai title wins over the prompt.
	writeRaw(t, env.Acct, dir, "s-ai",
		realUserLine(`"c:\\users\\u\\work\\acme\\"`, "something else"),
		`{"type":"ai-title","sessionId":"s-ai","aiTitle":"Login work"}`)
	// only snapshots and titles: not a session.
	writeRaw(t, env.Acct, dir, "s-empty",
		`{"type":"file-history-snapshot","messageId":"m","snapshot":{},"isSnapshotUpdate":false}`,
		`{"type":"ai-title","sessionId":"s-empty","aiTitle":"Ghost"}`)
	// oversized first line (beyond the old 64 KiB head window).
	writeRaw(t, env.Acct, "other-dir", "s-big",
		`{"type":"file-history-snapshot","messageId":"m","snapshot":{"x":"`+strings.Repeat("z", 200*1024)+`"}}`,
		realUserLine(winCwd, "Big first line"))
	// no cwd anywhere: project comes from the dir name, never ".".
	writeRaw(t, env.Acct, "C--Users-u-work-nocwd", "s-nocwd",
		`{"type":"user","message":{"role":"user","content":"hello there"},"uuid":"u1","timestamp":"2026-03-01T10:00:00.000Z"}`)

	got := byID(s.Sessions(true))
	if _, ok := got["s-empty"]; ok {
		t.Error("empty session must not be listed")
	}
	if len(got) != 4 {
		t.Fatalf("got %d sessions: %v", len(got), got)
	}
	if g := got["s-prompt"]; g.Title != "Fix the login redirect bug" || g.Cwd != `C:\Users\u\work\acme` {
		t.Errorf("s-prompt: title=%q cwd=%q", g.Title, g.Cwd)
	}
	if g := got["s-ai"]; g.Title != "Login work" {
		t.Errorf("s-ai title=%q", g.Title)
	}
	if got["s-big"].Title != "Big first line" || got["s-big"].Cwd == "" {
		t.Errorf("s-big: %+v", got["s-big"])
	}
	// drive-letter case and trailing slash must not split the project.
	if a, b := got["s-prompt"].ProjectKey, got["s-ai"].ProjectKey; a != b || a == "" {
		t.Errorf("project keys differ: %q vs %q", a, b)
	}
	if got["s-prompt"].ProjectKey != got["s-big"].ProjectKey {
		t.Errorf("s-big project %q", got["s-big"].ProjectKey)
	}
	if n := got["s-prompt"].ProjectName; n != "acme" {
		t.Errorf("project name = %q", n)
	}
	nc := got["s-nocwd"]
	if nc.Title != "hello there" || nc.ProjectName != "nocwd" || nc.ProjectName == "." || !strings.HasPrefix(nc.ProjectKey, "dir:") {
		t.Errorf("s-nocwd: %+v", nc)
	}
}

func TestScan_EmptySessionAppearsOncePromptIsWritten(t *testing.T) {
	s, _, env := newTestStoreEnv(t)
	p := writeRaw(t, env.Acct, "proj", "s1", `{"type":"file-history-snapshot","messageId":"m","snapshot":{}}`)
	if _, ok := byID(s.Sessions(true))["s1"]; ok {
		t.Fatal("listed while empty")
	}
	if err := os.WriteFile(p, []byte(realUserLine(`"/w/acme"`, "now real")+"\n"), 0o644); err != nil {
		t.Fatal(err)
	}
	now := time.Now().Add(time.Second)
	_ = os.Chtimes(p, now, now)
	g, ok := byID(s.Sessions(true))["s1"]
	if !ok || g.Title != "now real" {
		t.Fatalf("got %+v ok=%v", g, ok)
	}
}
