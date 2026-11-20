package control

import (
	"context"
	"fmt"
	"os"
	"path/filepath"
	"runtime"
	"strings"
	"syscall"
	"testing"
	"time"

	"github.com/longpl-1902/claude-ui/internal/control/fakeclaude"
)

// pidAlive reports whether pid is a live (non-zombie) process.
func pidAlive(pid int) bool {
	if b, err := os.ReadFile(fmt.Sprintf("/proc/%d/stat", pid)); err == nil {
		s := string(b)
		if i := strings.LastIndex(s, ")"); i >= 0 && len(s) > i+2 {
			return s[i+2] != 'Z'
		}
	}
	p, err := os.FindProcess(pid)
	if err != nil {
		return false
	}
	return p.Signal(syscall.Signal(0)) == nil
}

func TestSpawnerNamesMissingCwd(t *testing.T) {
	missing := t.TempDir() + "/nope"
	_, err := DefaultSpawner.Start(os.Args[0], nil, os.Environ(), missing)
	if err == nil || !strings.Contains(err.Error(), missing) {
		t.Fatalf("err = %v, want it to name %s", err, missing)
	}
}

func TestGrandchildDiesWithKillTree(t *testing.T) {
	if runtime.GOOS == "windows" {
		t.Skip("job object behaviour is verified on a Windows host")
	}
	h := newHarness(t, "grandchild", hopts{deps: Deps{StopGrace: 100 * time.Millisecond}})
	h.send("go")

	var gpid int
	deadline := time.Now().Add(10 * time.Second)
	for gpid == 0 && time.Now().Before(deadline) {
		for _, m := range h.logLines() {
			if v, ok := m["grandchild_pid"].(float64); ok {
				gpid = int(v)
			}
		}
		time.Sleep(20 * time.Millisecond)
	}
	if gpid == 0 {
		t.Fatal("grandchild never started")
	}
	// Give the grandchild a moment to boot, then confirm it lives.
	time.Sleep(100 * time.Millisecond)
	if !pidAlive(gpid) {
		t.Fatalf("grandchild %d not running before the kill", gpid)
	}

	if err := h.s.Stop(context.Background()); err != nil {
		t.Fatal(err)
	}
	for i := 0; i < 100 && pidAlive(gpid); i++ {
		time.Sleep(50 * time.Millisecond)
	}
	if pidAlive(gpid) {
		t.Fatalf("grandchild %d survived KillTree", gpid)
	}
}

func TestProcExposesPidAndWait(t *testing.T) {
	script, _ := filepath.Abs("testdata/crash.script")
	env := append(os.Environ(), fakeclaude.EnvScript+"="+script, "GORACE=atexit_sleep_ms=0")
	p, err := DefaultSpawner.Start(os.Args[0], nil, env, t.TempDir())
	if err != nil {
		t.Fatal(err)
	}
	if p.Pid() <= 0 {
		t.Fatal("no pid")
	}
	_, _ = p.Stdin().Write([]byte(`{"type":"control_request","request_id":"a","body":{"type":"initialize"}}` + "\n"))
	_, _ = p.Stdin().Write([]byte(`{"type":"user","message":"x"}` + "\n"))
	code, _ := p.Wait()
	if code != 2 {
		t.Fatalf("code = %d, want 2", code)
	}
	if code2, _ := p.Wait(); code2 != 2 {
		t.Fatal("second Wait must return the same result")
	}
}
