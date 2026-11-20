package app

import (
	"os"
	"path/filepath"
	"sync"
	"testing"
	"time"

	"github.com/longpl-1902/claude-ui/internal/statefile"
)

const (
	deadPID = 999999999
	sid1    = "11111111-1111-4111-8111-111111111111"
	sid2    = "22222222-2222-4222-8222-222222222222"
)

func writeTestLock(t *testing.T, dir, id string, pid int) {
	t.Helper()
	writeTestLockInfo(t, dir, id, LockInfo{PID: pid, Account: "acme", Since: time.Now().UTC()})
}

func writeTestLockInfo(t *testing.T, dir, id string, info LockInfo) {
	t.Helper()
	if err := statefile.WriteJSONAtomic(lockPath(dir, id), info); err != nil {
		t.Fatal(err)
	}
}

func TestAcquireAndRelease(t *testing.T) {
	dir := t.TempDir()
	ok, info, err := AcquireLock(dir, sid1, "acme")
	if err != nil || !ok || info == nil || info.PID != os.Getpid() || info.Account != "acme" {
		t.Fatalf("acquire: ok=%v info=%v err=%v", ok, info, err)
	}
	if got := CheckLock(dir, sid1); got == nil || got.PID != os.Getpid() {
		t.Fatalf("CheckLock = %v", got)
	}
	if err := ReleaseLock(dir, sid1); err != nil {
		t.Fatal(err)
	}
	if got := CheckLock(dir, sid1); got != nil {
		t.Fatalf("expected no lock, got %v", got)
	}
	if err := ReleaseLock(dir, sid1); err != nil {
		t.Fatalf("double release: %v", err)
	}
}

func TestAcquireReentrant(t *testing.T) {
	dir := t.TempDir()
	for i := 0; i < 2; i++ {
		ok, _, err := AcquireLock(dir, sid1, "acme")
		if err != nil || !ok {
			t.Fatalf("attempt %d: ok=%v err=%v", i, ok, err)
		}
	}
}

func TestInvalidSessionID(t *testing.T) {
	dir := t.TempDir()
	for _, id := range []string{"s1", "../x", "", "11111111-1111-4111-8111-11111111111g"} {
		if ok, _, err := AcquireLock(dir, id, "acme"); err == nil || ok {
			t.Errorf("AcquireLock(%q) should fail", id)
		}
		if err := ReleaseLock(dir, id); err == nil {
			t.Errorf("ReleaseLock(%q) should fail", id)
		}
		if CheckLock(dir, id) != nil {
			t.Errorf("CheckLock(%q) should be nil", id)
		}
	}
}

func TestAcquireStaleLock(t *testing.T) {
	dir := t.TempDir()
	writeTestLock(t, dir, sid1, deadPID)
	ok, info, err := AcquireLock(dir, sid1, "acme")
	if err != nil || !ok || info.PID != os.Getpid() {
		t.Fatalf("ok=%v info=%v err=%v", ok, info, err)
	}
	if got := CheckLock(dir, sid1); got == nil || got.PID != os.Getpid() {
		t.Fatalf("lock not replaced: %v", got)
	}
}

func TestAcquireCorruptLock(t *testing.T) {
	dir := t.TempDir()
	if err := os.WriteFile(lockPath(dir, sid1), []byte("{not json"), 0644); err != nil {
		t.Fatal(err)
	}
	ok, _, err := AcquireLock(dir, sid1, "acme")
	if err != nil || !ok {
		t.Fatalf("ok=%v err=%v", ok, err)
	}
}

func TestAcquireHeldByOtherLiveProcess(t *testing.T) {
	dir := t.TempDir()
	ppid := os.Getppid()
	if ppid <= 1 || !isProcessAlive(ppid) {
		t.Skip("no live parent process to use")
	}
	writeTestLock(t, dir, sid1, ppid)
	ok, info, err := AcquireLock(dir, sid1, "other")
	if err != nil || ok {
		t.Fatalf("expected not acquired: ok=%v err=%v", ok, err)
	}
	if info == nil || info.PID != ppid || info.Account != "acme" {
		t.Fatalf("info = %v", info)
	}
}

func TestStartedMismatchIsStale(t *testing.T) {
	dir := t.TempDir()
	ppid := os.Getppid()
	if ppid <= 1 || !isProcessAlive(ppid) || processStart(ppid) == 0 {
		t.Skip("process start time not available")
	}
	writeTestLockInfo(t, dir, sid1, LockInfo{
		PID: ppid, Account: "acme", Since: time.Now().UTC(),
		Started: processStart(ppid) - 60_000,
	})
	if got := CheckLock(dir, sid1); got != nil {
		t.Fatalf("pid-reuse lock should be stale, got %v", got)
	}
	// A matching start time keeps it alive.
	writeTestLockInfo(t, dir, sid1, LockInfo{
		PID: ppid, Account: "acme", Since: time.Now().UTC(), Started: processStart(ppid),
	})
	if got := CheckLock(dir, sid1); got == nil {
		t.Fatal("matching start time should be alive")
	}
}

func TestProcessStartOwn(t *testing.T) {
	if processStart(os.Getpid()) == 0 {
		t.Skip("process start time not available on this platform")
	}
	st := processStart(os.Getpid())
	if d := time.Now().UnixMilli() - st; d < -2000 || d > 24*3600*1000 {
		t.Fatalf("implausible start time %d (now-start=%dms)", st, d)
	}
}

func TestReleaseLeavesForeignLock(t *testing.T) {
	dir := t.TempDir()
	ppid := os.Getppid()
	if ppid <= 1 {
		t.Skip("no parent process")
	}
	writeTestLock(t, dir, sid1, ppid)
	if err := ReleaseLock(dir, sid1); err != nil {
		t.Fatal(err)
	}
	if _, err := os.Stat(lockPath(dir, sid1)); err != nil {
		t.Fatalf("foreign lock was removed: %v", err)
	}
}

func TestCheckLockMissing(t *testing.T) {
	if got := CheckLock(t.TempDir(), sid1); got != nil {
		t.Fatalf("got %v", got)
	}
}

func TestCheckLockStaleCleaned(t *testing.T) {
	dir := t.TempDir()
	writeTestLock(t, dir, sid1, deadPID)
	if got := CheckLock(dir, sid1); got != nil {
		t.Fatalf("got %v", got)
	}
	if _, err := os.Stat(lockPath(dir, sid1)); !os.IsNotExist(err) {
		t.Fatalf("stale lock not removed: %v", err)
	}
}

func TestListLocks(t *testing.T) {
	dir := t.TempDir()
	if got := ListLocks(filepath.Join(dir, "missing")); len(got) != 0 {
		t.Fatalf("missing dir: %v", got)
	}
	if ok, _, err := AcquireLock(dir, sid1, "acme"); err != nil || !ok {
		t.Fatal(err)
	}
	writeTestLock(t, dir, sid2, deadPID)
	tmp := lockPath(dir, sid2) + ".tmp-1-2"
	if err := os.WriteFile(tmp, []byte("{}"), 0644); err != nil {
		t.Fatal(err)
	}
	got := ListLocks(dir)
	if len(got) != 1 || got[sid1].PID != os.Getpid() {
		t.Fatalf("ListLocks = %v", got)
	}
	if _, err := os.Stat(lockPath(dir, sid2)); !os.IsNotExist(err) {
		t.Fatalf("stale lock not cleaned: %v", err)
	}
	if _, err := os.Stat(tmp); err != nil {
		t.Fatalf("temp file must be left alone: %v", err)
	}
}

// All goroutines share one pid, so every acquire reports success (re-entrant),
// but exactly one lock file must result and it must be valid and ours.
func TestAcquireRace(t *testing.T) {
	dir := t.TempDir()
	writeTestLock(t, dir, sid1, deadPID) // start from a stale lock to race the reclaim
	var wg sync.WaitGroup
	results := make([]bool, 20)
	errs := make([]error, 20)
	for i := range results {
		wg.Add(1)
		go func() {
			defer wg.Done()
			results[i], _, errs[i] = AcquireLock(dir, sid1, "acme")
		}()
	}
	wg.Wait()
	for i := range results {
		if errs[i] != nil || !results[i] {
			t.Fatalf("goroutine %d: ok=%v err=%v", i, results[i], errs[i])
		}
	}
	if got := CheckLock(dir, sid1); got == nil || got.PID != os.Getpid() {
		t.Fatalf("CheckLock = %v", got)
	}
	entries, _ := os.ReadDir(dir)
	if len(entries) != 1 {
		t.Fatalf("expected exactly one file, got %d", len(entries))
	}
}
