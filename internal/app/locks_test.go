package app

import (
	"os"
	"sync"
	"testing"
	"time"

	"github.com/longpl-1902/claude-ui/internal/statefile"
)

const deadPID = 999999999

func writeTestLock(t *testing.T, dir, id string, pid int) {
	t.Helper()
	err := statefile.WriteJSONAtomic(lockPath(dir, id), LockInfo{PID: pid, Account: "acme", Since: time.Now().UTC()})
	if err != nil {
		t.Fatal(err)
	}
}

func TestAcquireAndRelease(t *testing.T) {
	dir := t.TempDir()
	ok, info, err := AcquireLock(dir, "s1")
	if err != nil || !ok || info == nil || info.PID != os.Getpid() {
		t.Fatalf("acquire: ok=%v info=%v err=%v", ok, info, err)
	}
	if got := CheckLock(dir, "s1"); got == nil || got.PID != os.Getpid() {
		t.Fatalf("CheckLock = %v", got)
	}
	if err := ReleaseLock(dir, "s1"); err != nil {
		t.Fatal(err)
	}
	if got := CheckLock(dir, "s1"); got != nil {
		t.Fatalf("expected no lock, got %v", got)
	}
	if err := ReleaseLock(dir, "s1"); err != nil {
		t.Fatalf("double release: %v", err)
	}
}

func TestAcquireReentrant(t *testing.T) {
	dir := t.TempDir()
	for i := 0; i < 2; i++ {
		ok, _, err := AcquireLock(dir, "s1")
		if err != nil || !ok {
			t.Fatalf("attempt %d: ok=%v err=%v", i, ok, err)
		}
	}
}

func TestAcquireStaleLock(t *testing.T) {
	dir := t.TempDir()
	writeTestLock(t, dir, "s1", deadPID)
	ok, info, err := AcquireLock(dir, "s1")
	if err != nil || !ok || info.PID != os.Getpid() {
		t.Fatalf("ok=%v info=%v err=%v", ok, info, err)
	}
	if got := CheckLock(dir, "s1"); got == nil || got.PID != os.Getpid() {
		t.Fatalf("lock not replaced: %v", got)
	}
}

func TestAcquireHeldByOtherLiveProcess(t *testing.T) {
	dir := t.TempDir()
	ppid := os.Getppid()
	if ppid <= 1 || !isProcessAlive(ppid) {
		t.Skip("no live parent process to use")
	}
	writeTestLock(t, dir, "s1", ppid)
	ok, info, err := AcquireLock(dir, "s1")
	if err != nil || ok {
		t.Fatalf("expected not acquired: ok=%v err=%v", ok, err)
	}
	if info == nil || info.PID != ppid || info.Account != "acme" {
		t.Fatalf("info = %v", info)
	}
}

func TestCheckLockMissing(t *testing.T) {
	if got := CheckLock(t.TempDir(), "nope"); got != nil {
		t.Fatalf("got %v", got)
	}
}

func TestCheckLockStaleCleaned(t *testing.T) {
	dir := t.TempDir()
	writeTestLock(t, dir, "s1", deadPID)
	if got := CheckLock(dir, "s1"); got != nil {
		t.Fatalf("got %v", got)
	}
	if _, err := os.Stat(lockPath(dir, "s1")); !os.IsNotExist(err) {
		t.Fatalf("stale lock not removed: %v", err)
	}
}

func TestAcquireRace(t *testing.T) {
	dir := t.TempDir()
	var wg sync.WaitGroup
	results := make([]bool, 8)
	errs := make([]error, 8)
	for i := range results {
		wg.Add(1)
		go func() {
			defer wg.Done()
			results[i], _, errs[i] = AcquireLock(dir, "s1")
		}()
	}
	wg.Wait()
	for i := range results {
		if errs[i] != nil || !results[i] {
			t.Fatalf("goroutine %d: ok=%v err=%v", i, results[i], errs[i])
		}
	}
	if got := CheckLock(dir, "s1"); got == nil || got.PID != os.Getpid() {
		t.Fatalf("CheckLock = %v", got)
	}
}
