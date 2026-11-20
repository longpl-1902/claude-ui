package app

import (
	"context"
	"encoding/json"
	"fmt"
	"os"
	"path/filepath"
	"strings"
	"sync"
	"testing"
	"time"

	"github.com/longpl-1902/claude-ui/internal/accounts"
	"github.com/longpl-1902/claude-ui/internal/control"
	"github.com/longpl-1902/claude-ui/internal/core"
	"github.com/longpl-1902/claude-ui/internal/statefile"
)

type answerRec struct {
	ReqID string
	A     ctlAnswer
}

// fakeCtl is an in-memory controller. Tests feed Events and inspect calls.
type fakeCtl struct {
	mu         sync.Mutex
	Launch     control.Launch
	events     chan control.Event
	Sends      []string
	Answers    []answerRec
	Interrupts int
	Stops      int
	Closes     int
	Requests   []control.ReqKind
	SendErr    error
	AnswerErr  error
	IntErr     error
	InfoVal    ctlInfo
	OnSend     func(f *fakeCtl, text string)
	closed     bool
}

func (f *fakeCtl) Send(text string) error {
	f.mu.Lock()
	hook := f.OnSend
	f.mu.Unlock()
	if hook != nil {
		hook(f, text)
	}
	f.mu.Lock()
	defer f.mu.Unlock()
	if f.SendErr != nil {
		return f.SendErr
	}
	f.Sends = append(f.Sends, text)
	f.InfoVal.Spawns++
	return nil
}

func (f *fakeCtl) Answer(id string, a ctlAnswer) error {
	f.mu.Lock()
	defer f.mu.Unlock()
	f.Answers = append(f.Answers, answerRec{id, a})
	return f.AnswerErr
}

func (f *fakeCtl) Interrupt() error {
	f.mu.Lock()
	defer f.mu.Unlock()
	f.Interrupts++
	return f.IntErr
}
func (f *fakeCtl) SetModel(string) error { return nil }
func (f *fakeCtl) SetMode(string) error  { return nil }
func (f *fakeCtl) Request(_ context.Context, k control.ReqKind, _ map[string]any) (json.RawMessage, error) {
	f.mu.Lock()
	defer f.mu.Unlock()
	f.Requests = append(f.Requests, k)
	return json.RawMessage(`{"percentage":12}`), nil
}
func (f *fakeCtl) Stop(context.Context) error {
	f.mu.Lock()
	defer f.mu.Unlock()
	f.Stops++
	return nil
}
func (f *fakeCtl) Close() {
	f.mu.Lock()
	defer f.mu.Unlock()
	f.Closes++
	if !f.closed {
		f.closed = true
		close(f.events)
	}
}
func (f *fakeCtl) Info() ctlInfo {
	f.mu.Lock()
	defer f.mu.Unlock()
	return f.InfoVal
}
func (f *fakeCtl) Pending() []core.Card         { return nil }
func (f *fakeCtl) Events() <-chan control.Event { return f.events }

func (f *fakeCtl) feed(ev control.Event) { f.events <- ev }

func (f *fakeCtl) sends() []string {
	f.mu.Lock()
	defer f.mu.Unlock()
	return append([]string(nil), f.Sends...)
}

func (f *fakeCtl) answers() []answerRec {
	f.mu.Lock()
	defer f.mu.Unlock()
	return append([]answerRec(nil), f.Answers...)
}

type fakeCtlFactory struct {
	mu   sync.Mutex
	made []*fakeCtl
	// Hook is installed on every new fake (OnSend).
	Hook func(f *fakeCtl, text string)
}

func (ff *fakeCtlFactory) New(l control.Launch) controller {
	f := &fakeCtl{Launch: l, events: make(chan control.Event, 256), OnSend: ff.Hook}
	ff.mu.Lock()
	ff.made = append(ff.made, f)
	ff.mu.Unlock()
	return f
}

func (ff *fakeCtlFactory) all() []*fakeCtl {
	ff.mu.Lock()
	defer ff.mu.Unlock()
	return append([]*fakeCtl(nil), ff.made...)
}

func (ff *fakeCtlFactory) last(t *testing.T) *fakeCtl {
	t.Helper()
	l := ff.all()
	if len(l) == 0 {
		t.Fatal("no controller was created")
	}
	return l[len(l)-1]
}

func (ff *fakeCtlFactory) totalSends() int {
	n := 0
	for _, f := range ff.all() {
		n += len(f.sends())
	}
	return n
}

type testEnv struct {
	Acct    core.Account
	Dirs    statefile.AppDirs
	Project string
}

// newTestStore builds a Store with one signed-in account "acme" and a fake
// controller factory. No real process is ever started.
func newTestStore(t *testing.T, opt ...func(*Options)) (*Store, *fakeCtlFactory) {
	s, ff, _ := newTestStoreEnv(t, opt...)
	return s, ff
}

func newTestStoreEnv(t *testing.T, opt ...func(*Options)) (*Store, *fakeCtlFactory, testEnv) {
	t.Helper()
	root := t.TempDir()
	dirs := statefile.AppDirs{
		Config: filepath.Join(root, "config"),
		Local:  filepath.Join(root, "local"),
		Locks:  filepath.Join(root, "locks"),
	}
	cfgDir := filepath.Join(root, "acme")
	if err := os.MkdirAll(cfgDir, 0o755); err != nil {
		t.Fatal(err)
	}
	if err := os.WriteFile(filepath.Join(cfgDir, ".claude.json"),
		[]byte(`{"oauthAccount":{"emailAddress":"u@example.com"}}`), 0o644); err != nil {
		t.Fatal(err)
	}
	project := filepath.Join(root, "project")
	if err := os.MkdirAll(project, 0o755); err != nil {
		t.Fatal(err)
	}
	acct := core.Account{ID: "acme", Name: "acme", ConfigDir: cfgDir, Email: "u@example.com", SignedIn: true}
	ff := &fakeCtlFactory{}
	o := Options{
		Dirs:          dirs,
		ClaudePath:    "fake",
		Env:           []string{},
		NewController: ff.New,
		LaunchDir:     project,
		Home:          root,
		NotifyDelay:   10 * time.Millisecond,
	}
	for _, f := range opt {
		f(&o)
	}
	s := NewWithOptions(acct, []core.Account{acct}, accounts.Config{}, o)
	t.Cleanup(s.Close)
	return s, ff, testEnv{Acct: acct, Dirs: dirs, Project: project}
}

const testSessionID = "11111111-aaaa-4bbb-8ccc-000000000001"

// writeTranscript copies the lead_basic fixture into the account's projects
// dir under id, with its cwd rewritten.
func writeTranscript(t *testing.T, acct core.Account, cwd, id string) string {
	t.Helper()
	data, err := os.ReadFile(filepath.Join("..", "transcript", "testdata", "lead_basic.jsonl"))
	if err != nil {
		t.Fatal(err)
	}
	esc, _ := json.Marshal(cwd)
	text := strings.ReplaceAll(string(data), `"d:\\work\\demo"`, string(esc))
	text = strings.ReplaceAll(text, "11111111-aaaa-4bbb-8ccc-000000000001", id)
	dir := filepath.Join(acct.ConfigDir, "projects", "proj")
	if err := os.MkdirAll(dir, 0o755); err != nil {
		t.Fatal(err)
	}
	p := filepath.Join(dir, id+".jsonl")
	if err := os.WriteFile(p, []byte(text), 0o644); err != nil {
		t.Fatal(err)
	}
	// keep the fixture inside the listing window
	now := time.Now()
	_ = os.Chtimes(p, now, now)
	return p
}

func writeRegistry(t *testing.T, acct core.Account, pid int, id, entrypoint, status string) {
	t.Helper()
	dir := filepath.Join(acct.ConfigDir, "sessions")
	if err := os.MkdirAll(dir, 0o755); err != nil {
		t.Fatal(err)
	}
	data := fmt.Sprintf(`{"pid":%d,"sessionId":%q,"cwd":"x","status":%q,"entrypoint":%q}`, pid, id, status, entrypoint)
	if err := os.WriteFile(filepath.Join(dir, fmt.Sprintf("%d.json", pid)), []byte(data), 0o644); err != nil {
		t.Fatal(err)
	}
}

func writeForeignLock(t *testing.T, dir, id string, pid int, account string) {
	t.Helper()
	if err := os.MkdirAll(dir, 0o755); err != nil {
		t.Fatal(err)
	}
	data, _ := json.Marshal(LockInfo{PID: pid, Account: account, Since: time.Now().UTC()})
	if err := os.WriteFile(filepath.Join(dir, id+".lock"), data, 0o644); err != nil {
		t.Fatal(err)
	}
}

func readLockFile(t *testing.T, dir, id string) (LockInfo, bool) {
	t.Helper()
	data, err := os.ReadFile(filepath.Join(dir, id+".lock"))
	if err != nil {
		return LockInfo{}, false
	}
	var li LockInfo
	if err := json.Unmarshal(data, &li); err != nil {
		t.Fatal(err)
	}
	return li, true
}

// run executes a store action synchronously and returns its message.
func run(s *Store, a core.Action) any {
	return s.Do(a)()
}

func eventually(t *testing.T, what string, cond func() bool) {
	t.Helper()
	deadline := time.Now().Add(2 * time.Second)
	for time.Now().Before(deadline) {
		if cond() {
			return
		}
		time.Sleep(5 * time.Millisecond)
	}
	t.Fatalf("timeout waiting for %s", what)
}
