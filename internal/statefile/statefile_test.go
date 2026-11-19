package statefile

import (
	"encoding/json"
	"errors"
	"os"
	"path/filepath"
	"sync"
	"testing"
)

func TestWriteJSONAtomic(t *testing.T) {
	dir := t.TempDir()
	path := filepath.Join(dir, "test.json")

	type data struct {
		Name  string `json:"name"`
		Count int    `json:"count"`
	}

	err := WriteJSONAtomic(path, &data{Name: "acme", Count: 42})
	if err != nil {
		t.Fatal(err)
	}

	raw, err := os.ReadFile(path)
	if err != nil {
		t.Fatal(err)
	}
	var got data
	if err := json.Unmarshal(raw, &got); err != nil {
		t.Fatal(err)
	}
	if got.Name != "acme" || got.Count != 42 {
		t.Errorf("got %+v", got)
	}
}

func TestReadJSONMissing(t *testing.T) {
	var v struct{ X int }
	err := ReadJSON("/nonexistent/path.json", &v)
	if !os.IsNotExist(err) {
		t.Errorf("expected not-exist, got %v", err)
	}
}

func TestReadJSONEmpty(t *testing.T) {
	dir := t.TempDir()
	path := filepath.Join(dir, "empty.json")
	os.WriteFile(path, []byte{}, 0644)

	var v struct{ X int }
	err := ReadJSON(path, &v)
	if err != nil {
		t.Errorf("empty file should not error, got %v", err)
	}
}

func TestUpdate(t *testing.T) {
	dir := t.TempDir()
	path := filepath.Join(dir, "counter.json")

	type counter struct {
		N int `json:"n"`
	}

	for range 5 {
		err := Update(path, func(c *counter) error {
			c.N++
			return nil
		})
		if err != nil {
			t.Fatal(err)
		}
	}

	var c counter
	if err := ReadJSON(path, &c); err != nil {
		t.Fatal(err)
	}
	if c.N != 5 {
		t.Errorf("counter = %d, want 5", c.N)
	}
}

func TestUpdateConcurrent(t *testing.T) {
	dir := t.TempDir()
	path := filepath.Join(dir, "counter.json")

	type counter struct {
		N int `json:"n"`
	}

	var wg sync.WaitGroup
	for range 8 {
		wg.Add(1)
		go func() {
			defer wg.Done()
			for range 10 {
				_ = Update(path, func(c *counter) error {
					c.N++
					return nil
				})
			}
		}()
	}
	wg.Wait()

	var c counter
	if err := ReadJSON(path, &c); err != nil {
		t.Fatal(err)
	}
	if c.N != 80 {
		t.Errorf("concurrent counter = %d, want 80", c.N)
	}
}

func TestAcquireSession(t *testing.T) {
	dir := t.TempDir()
	locksDir := filepath.Join(dir, "locks")

	fakeProcInfo := func(pid int) (int64, bool) {
		if pid == 1000 {
			return 500, true
		}
		return 0, false
	}

	lock, err := AcquireSession(locksDir, "sess-1", 1000, 500, "work", fakeProcInfo)
	if err != nil {
		t.Fatal(err)
	}

	// Second acquire should fail
	_, err = AcquireSession(locksDir, "sess-1", 2000, 600, "personal", fakeProcInfo)
	if !errors.Is(err, ErrLocked) {
		t.Errorf("second acquire: got %v, want ErrLocked", err)
	}

	// Check owner
	pid, live, err := SessionOwner(locksDir, "sess-1", fakeProcInfo)
	if err != nil {
		t.Fatal(err)
	}
	if pid != 1000 || !live {
		t.Errorf("owner = pid %d live %v, want 1000 true", pid, live)
	}

	// Release
	if err := lock.Release(); err != nil {
		t.Fatal(err)
	}

	// Now acquire should succeed again
	lock2, err := AcquireSession(locksDir, "sess-1", 2000, 600, "personal", fakeProcInfo)
	if err != nil {
		t.Fatal(err)
	}
	lock2.Release()
}

func TestAcquireSessionStalePid(t *testing.T) {
	dir := t.TempDir()
	locksDir := filepath.Join(dir, "locks")

	deadProc := func(pid int) (int64, bool) {
		return 0, false
	}
	aliveProc := func(pid int) (int64, bool) {
		return 700, true
	}

	// Create a lock with pid 999
	lock, err := AcquireSession(locksDir, "sess-2", 999, 400, "work", aliveProc)
	if err != nil {
		t.Fatal(err)
	}
	_ = lock

	// Pid 999 is now dead; new process should take over
	lock2, err := AcquireSession(locksDir, "sess-2", 2000, 700, "work", deadProc)
	if err != nil {
		t.Fatalf("stale lock takeover failed: %v", err)
	}
	lock2.Release()
}

func TestAcquireSessionStalePidReuse(t *testing.T) {
	dir := t.TempDir()
	locksDir := filepath.Join(dir, "locks")

	// Lock was for pid 1000 created at time 500
	// Now pid 1000 is alive but created at time 900 (reused PID)
	reusedProc := func(pid int) (int64, bool) {
		return 900, true
	}

	os.MkdirAll(locksDir, 0755)
	lockPath := filepath.Join(locksDir, "sess-3.lock")
	os.WriteFile(lockPath, []byte(`{"pid":1000,"created":500,"account":"work"}`), 0644)

	lock, err := AcquireSession(locksDir, "sess-3", 2000, 700, "personal", reusedProc)
	if err != nil {
		t.Fatalf("pid-reuse stale lock takeover failed: %v", err)
	}
	lock.Release()
}

func TestAcquireSessionRace(t *testing.T) {
	dir := t.TempDir()
	locksDir := filepath.Join(dir, "locks")

	os.MkdirAll(locksDir, 0755)
	lockPath := filepath.Join(locksDir, "sess-race.lock")
	os.WriteFile(lockPath, []byte(`{"pid":999,"created":100,"account":"old"}`), 0644)

	deadProc := func(pid int) (int64, bool) {
		if pid == 999 {
			return 0, false
		}
		return int64(pid), true
	}

	var wg sync.WaitGroup
	wins := make(chan int, 20)
	for i := range 20 {
		wg.Add(1)
		go func(id int) {
			defer wg.Done()
			lock, err := AcquireSession(locksDir, "sess-race", 2000+id, int64(2000+id), "test", deadProc)
			if err == nil {
				wins <- id
				lock.Release()
			}
		}(i)
	}
	wg.Wait()
	close(wins)

	count := 0
	for range wins {
		count++
	}
	// At least one winner, but not necessarily exactly one due to release+reacquire
	if count < 1 {
		t.Errorf("expected at least 1 winner, got %d", count)
	}
}
