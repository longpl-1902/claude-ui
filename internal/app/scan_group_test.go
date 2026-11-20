package app

import (
	"encoding/json"
	"os"
	"os/exec"
	"path/filepath"
	"testing"
	"time"
)

func TestScan_GroupsByGitRoot(t *testing.T) {
	if _, err := exec.LookPath("git"); err != nil {
		t.Skip("git not installed")
	}
	s, _, env := newTestStoreEnv(t)
	repo := filepath.Join(t.TempDir(), "acme")
	sub := filepath.Join(repo, "pkg", "api")
	if err := os.MkdirAll(sub, 0o755); err != nil {
		t.Fatal(err)
	}
	if out, err := exec.Command("git", "init", "-q", repo).CombinedOutput(); err != nil {
		t.Skipf("init: %v %s", err, out)
	}
	j := func(p string) string { b, _ := json.Marshal(p); return string(b) }
	writeRaw(t, env.Acct, "d1", "s-root", realUserLine(j(repo), "root"))
	writeRaw(t, env.Acct, "d2", "s-sub", realUserLine(j(sub), "sub"))

	deadline := time.Now().Add(10 * time.Second)
	for {
		got := byID(s.Sessions(true))
		a, b := got["s-root"], got["s-sub"]
		if a.ProjectKey != "" && a.ProjectKey == b.ProjectKey && a.ProjectName == "acme" {
			return
		}
		if time.Now().After(deadline) {
			t.Fatalf("not grouped: %q/%q vs %q/%q", a.ProjectKey, a.ProjectName, b.ProjectKey, b.ProjectName)
		}
		time.Sleep(50 * time.Millisecond)
	}
}
