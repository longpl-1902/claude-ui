package app

import (
	"bufio"
	"encoding/json"
	"errors"
	"fmt"
	"os"
	"os/exec"
	"path/filepath"
	"slices"
	"strings"
	"sync"
	"testing"
	"time"

	"github.com/longpl-1902/claude-ui/internal/accounts"
	"github.com/longpl-1902/claude-ui/internal/control"
	"github.com/longpl-1902/claude-ui/internal/control/fakeclaude"
	"github.com/longpl-1902/claude-ui/internal/core"
)

// ---- harness: the real control runtime driving the scripted fake claude ----

// guardSpawner is the CI guard (spec 5.3): the only executable that may ever
// be started is this test binary, with AC_FAKE_CLAUDE naming a script under
// testdata. Anything else fails the test.
type guardSpawner struct {
	t     *testing.T
	inner control.Spawner
	mu    sync.Mutex
	n     int
}

func (g *guardSpawner) check(path string, env []string) error {
	if path != os.Args[0] {
		return fmt.Errorf("guard: refusing to spawn %q (only the test binary may run)", path)
	}
	script := ""
	for _, e := range env {
		if v, ok := strings.CutPrefix(e, fakeclaude.EnvScript+"="); ok {
			script = v
		}
	}
	if script == "" {
		return errors.New("guard: " + fakeclaude.EnvScript + " is not set")
	}
	abs, _ := filepath.Abs("testdata")
	if !strings.HasPrefix(script, abs+string(filepath.Separator)) {
		return fmt.Errorf("guard: script %q is not under testdata/", script)
	}
	return nil
}

func (g *guardSpawner) Start(path string, args, env []string, cwd string) (control.Proc, error) {
	if err := g.check(path, env); err != nil {
		g.t.Errorf("%v", err)
		return nil, err
	}
	g.mu.Lock()
	g.n++
	g.mu.Unlock()
	return g.inner.Start(path, args, env, cwd)
}

func (g *guardSpawner) starts() int {
	g.mu.Lock()
	defer g.mu.Unlock()
	return g.n
}

// fakeRun wires a Store to the fake claude. The n-th controller created runs
// scripts[n] (the last one repeats).
type fakeRun struct {
	t       *testing.T
	log     string
	scripts []string
	guard   *guardSpawner
	mu      sync.Mutex
	created int
}

func scriptPath(t *testing.T, name string) string {
	t.Helper()
	p, err := filepath.Abs(filepath.Join("testdata", name+".script"))
	if err != nil {
		t.Fatal(err)
	}
	if _, err := os.Stat(p); err != nil {
		t.Fatal(err)
	}
	return p
}

func newFakeRun(t *testing.T, scripts ...string) *fakeRun {
	t.Helper()
	if len(scripts) == 0 {
		t.Fatal("no script")
	}
	fr := &fakeRun{
		t:     t,
		log:   filepath.Join(t.TempDir(), "fake.log"),
		guard: &guardSpawner{t: t, inner: control.DefaultSpawner},
	}
	for _, s := range scripts {
		fr.scripts = append(fr.scripts, scriptPath(t, s))
	}
	return fr
}

func (fr *fakeRun) newController(l control.Launch) controller {
	fr.mu.Lock()
	script := fr.scripts[min(fr.created, len(fr.scripts)-1)]
	fr.created++
	fr.mu.Unlock()
	env := append(os.Environ(), fakeclaude.EnvScript+"="+script, fakeclaude.EnvLog+"="+fr.log)
	return control.New(l, control.Deps{
		Spawner:   fr.guard,
		BaseEnv:   env,
		StopGrace: 200 * time.Millisecond,
	})
}

func (fr *fakeRun) option(o *Options) {
	o.ClaudePath = os.Args[0]
	o.Env = os.Environ()
	o.NewController = fr.newController
}

// newE2E builds a Store (one account, acme) using the real runtime.
func newE2E(t *testing.T, scripts ...string) (*Store, testEnv, *fakeRun) {
	t.Helper()
	fr := newFakeRun(t, scripts...)
	s, _, env := newTestStoreEnv(t, fr.option)
	return s, env, fr
}

// newE2EPeer builds a second Store (a second `ac`) over the same account and
// lock directory but its own state directories.
func newE2EPeer(t *testing.T, env testEnv, scripts ...string) (*Store, *fakeRun) {
	t.Helper()
	fr := newFakeRun(t, scripts...)
	root := t.TempDir()
	o := Options{
		Dirs: env.Dirs,
		Home: root,
		// own state dir, shared locks
		LaunchDir:   env.Project,
		NotifyDelay: 10 * time.Millisecond,
	}
	o.Dirs.Config = filepath.Join(root, "config")
	o.Dirs.Local = filepath.Join(root, "local")
	fr.option(&o)
	s := NewWithOptions(env.Acct, []core.Account{env.Acct}, accounts.Config{}, o)
	t.Cleanup(s.Close)
	return s, fr
}

const e2eTimeout = 10 * time.Second

func waitUntil(t *testing.T, what string, cond func() bool) {
	t.Helper()
	deadline := time.Now().Add(e2eTimeout)
	for time.Now().Before(deadline) {
		if cond() {
			return
		}
		time.Sleep(2 * time.Millisecond)
	}
	t.Fatalf("timeout waiting for %s", what)
}

func waitView(t *testing.T, s *Store, key core.SessionKey, what string, cond func(core.SessionView) bool) core.SessionView {
	t.Helper()
	var last core.SessionView
	waitUntil(t, what, func() bool {
		v, ok := s.View(key, "")
		if !ok {
			return false
		}
		last = v
		return cond(v)
	})
	return last
}

func state(v core.SessionView) string {
	if v.Ctl == nil {
		return ""
	}
	return v.Ctl.State
}

func hasNotice(v core.SessionView, sub string) bool {
	for _, it := range v.Items {
		if it.Kind == core.ItemNotice && strings.Contains(it.Text, sub) {
			return true
		}
	}
	return false
}

// send runs a send action and returns the key to follow (the OpenMsg key, or
// the given key).
func send(t *testing.T, s *Store, key core.SessionKey, text string) core.SessionKey {
	t.Helper()
	msg := run(s, core.Action{Kind: core.ActionSend, Key: key, Text: text})
	switch m := msg.(type) {
	case core.OpenMsg:
		return m.Key
	case core.ChangedMsg:
		return key
	default:
		t.Fatalf("send: unexpected %T %+v", msg, msg)
		return key
	}
}

// ---- the fake's log ----

type fakeLog struct {
	argvs  [][]string
	cwds   []string
	cfgs   []string
	pids   []int
	frames []map[string]any
}

func readFakeLog(t *testing.T, path string) fakeLog {
	t.Helper()
	var fl fakeLog
	f, err := os.Open(path)
	if err != nil {
		if errors.Is(err, os.ErrNotExist) {
			return fl
		}
		t.Fatal(err)
	}
	defer f.Close()
	sc := bufio.NewScanner(f)
	sc.Buffer(make([]byte, 1<<20), 1<<20)
	for sc.Scan() {
		var m map[string]any
		if json.Unmarshal(sc.Bytes(), &m) != nil {
			continue
		}
		if a, ok := m["argv"].([]any); ok {
			var argv []string
			for _, x := range a {
				argv = append(argv, fmt.Sprint(x))
			}
			fl.argvs = append(fl.argvs, argv)
			fl.cwds = append(fl.cwds, fmt.Sprint(m["cwd"]))
			fl.cfgs = append(fl.cfgs, fmt.Sprint(m["env_config_dir"]))
			pid, _ := m["pid"].(float64)
			fl.pids = append(fl.pids, int(pid))
		}
		if fr, ok := m["frame"].(map[string]any); ok {
			fl.frames = append(fl.frames, fr)
		}
	}
	return fl
}

func (fl fakeLog) hasFrame(typ, bodyType string) bool {
	for _, f := range fl.frames {
		if f["type"] != typ {
			continue
		}
		if bodyType == "" {
			return true
		}
		if b, ok := f["body"].(map[string]any); ok && b["type"] == bodyType {
			return true
		}
	}
	return false
}

func waitSpawns(t *testing.T, fr *fakeRun, n int) fakeLog {
	t.Helper()
	var fl fakeLog
	waitUntil(t, fmt.Sprintf("%d spawn(s) in the fake log", n), func() bool {
		fl = readFakeLog(t, fr.log)
		return len(fl.argvs) >= n
	})
	return fl
}

func waitLock(t *testing.T, env testEnv, id string) LockInfo {
	t.Helper()
	var li LockInfo
	waitUntil(t, "lock for "+id, func() bool {
		var ok bool
		li, ok = readLockFile(t, env.Dirs.Locks, id)
		return ok
	})
	return li
}

func waitDead(t *testing.T, pid int) {
	t.Helper()
	waitUntil(t, fmt.Sprintf("pid %d to be gone", pid), func() bool { return !isProcessAlive(pid) })
}

// ---- 1. R-19 end to end ----

func TestE2E_NothingSpawnsBeforeFirstSend(t *testing.T) {
	s, env, fr := newE2E(t, "new_session")
	id := "aaaaaaaa-1111-4222-8333-bbbbbbbbbbbb"
	writeTranscript(t, env.Acct, env.Project, id)

	list := s.Sessions(true)
	if len(list) != 1 {
		t.Fatalf("sessions = %d", len(list))
	}
	if _, ok := s.View(list[0].Key, ""); !ok {
		t.Fatal("no view")
	}
	msg := run(s, core.Action{Kind: core.ActionNewDraft, Dir: env.Project})
	open, ok := msg.(core.OpenMsg)
	if !ok {
		t.Fatalf(":new returned %T %+v", msg, msg)
	}
	if _, ok := s.View(open.Key, ""); !ok {
		t.Fatal("draft has no view")
	}
	msg = run(s, core.Action{Kind: core.ActionFork, Key: list[0].Key})
	if _, ok := msg.(core.OpenMsg); !ok {
		t.Fatalf(":fork returned %T %+v", msg, msg)
	}
	// details need a prompt first
	if m := run(s, core.Action{Kind: core.ActionCtx, Key: open.Key}); fmt.Sprintf("%T", m) != "core.ErrMsg" {
		t.Fatalf(":ctx on a draft returned %T", m)
	}
	run(s, core.Action{Kind: core.ActionRefresh})

	time.Sleep(150 * time.Millisecond) // a spawn would show up in the log by now
	s.Close()
	if _, err := os.Stat(fr.log); !errors.Is(err, os.ErrNotExist) {
		t.Fatalf("fake log exists (err=%v): something was spawned", err)
	}
	if n := fr.guard.starts(); n != 0 {
		t.Fatalf("%d process(es) started", n)
	}
}

// ---- 2. new session ----

func TestE2E_NewSession(t *testing.T) {
	s, env, fr := newE2E(t, "new_session")
	key := send(t, s, core.SessionKey{}, "hello")
	if key.DraftID == "" {
		t.Fatalf("OpenMsg key = %+v, want a draft", key)
	}

	waitView(t, s, key, "typing text", func(v core.SessionView) bool { return v.Typing != "" })
	v := waitView(t, s, key, "idle with cost", func(v core.SessionView) bool {
		return state(v) == "idle" && v.Ctl.CostUSD > 0 && v.Typing == ""
	})
	if v.Ctl.CostUSD != 0.5 || v.Ctl.Model != "claude-test" {
		t.Fatalf("ctl = %+v", *v.Ctl)
	}
	if v.Summary.Key.SessionID != fakeclaude.SessionUUID {
		t.Fatalf("session id = %q", v.Summary.Key.SessionID)
	}
	waitView(t, s, key, "ctx percentage", func(v core.SessionView) bool { return v.Ctl.CtxPct > 0.2 && v.Ctl.CtxPct < 0.3 })

	li := waitLock(t, env, fakeclaude.SessionUUID)
	if li.PID != os.Getpid() || li.Account != "acme" {
		t.Fatalf("lock = %+v", li)
	}

	fl := readFakeLog(t, fr.log)
	if len(fl.argvs) != 1 {
		t.Fatalf("spawns = %d", len(fl.argvs))
	}
	if slices.Contains(fl.argvs[0], "--resume") || slices.Contains(fl.argvs[0], "--fork-session") {
		t.Fatalf("argv = %v", fl.argvs[0])
	}
	wantCwd, _ := filepath.EvalSymlinks(env.Project)
	gotCwd, _ := filepath.EvalSymlinks(fl.cwds[0])
	if gotCwd != wantCwd {
		t.Fatalf("cwd = %q, want %q", gotCwd, wantCwd)
	}
	if fl.cfgs[0] != env.Acct.ConfigDir {
		t.Fatalf("CLAUDE_CONFIG_DIR = %q, want %q", fl.cfgs[0], env.Acct.ConfigDir)
	}
	if len(fl.frames) < 2 || fl.frames[0]["type"] != "control_request" || fl.frames[1]["type"] != "user" {
		t.Fatalf("frames = %v", fl.frames)
	}
	if b, _ := json.Marshal(fl.frames[1]); !strings.Contains(string(b), "hello") {
		t.Fatalf("user frame = %s", b)
	}
}

// ---- 3-5. permission round trips ----

func TestE2E_PermissionAllow(t *testing.T) {
	s, _, fr := newE2E(t, "perm_allow")
	key := send(t, s, core.SessionKey{}, "go")
	v := waitView(t, s, key, "permission card", func(v core.SessionView) bool { return len(v.Cards) == 1 })
	c := v.Cards[0]
	if c.RequestID != "r1" || c.ToolName != "Bash" || c.Preview != "ls" || !c.CanAllowSession {
		t.Fatalf("card = %+v", c)
	}
	if !v.Summary.Blocked || v.Summary.Status != core.StatusNeedsYou {
		t.Fatalf("summary = %+v", v.Summary)
	}
	if mine, _, items := s.Attention(); mine != 1 || len(items) != 1 || items[0].Kind != "permission" {
		t.Fatalf("attention = %d %+v", mine, items)
	}

	run(s, core.Action{Kind: core.ActionAnswer, Key: key, RequestID: "r1", Allow: true})
	v = waitView(t, s, key, "idle after answer", func(v core.SessionView) bool {
		return state(v) == "idle" && len(v.Cards) == 0
	})
	if hasNotice(v, "claude exited") {
		t.Fatalf("fake rejected the frame: %+v", v.Items)
	}
	if !readFakeLog(t, fr.log).hasFrame("control_response", "") {
		t.Fatal("no control_response frame reached the child")
	}
	// a second answer is refused politely
	if m, ok := run(s, core.Action{Kind: core.ActionAnswer, Key: key, RequestID: "r1", Allow: true}).(core.ErrMsg); !ok || m.Text != "already answered" {
		t.Fatalf("second answer = %+v", m)
	}
}

func TestE2E_PermissionAllowForSession(t *testing.T) {
	s, _, _ := newE2E(t, "perm_session")
	key := send(t, s, core.SessionKey{}, "go")
	waitView(t, s, key, "card", func(v core.SessionView) bool { return len(v.Cards) == 1 })
	run(s, core.Action{Kind: core.ActionAnswer, Key: key, RequestID: "r2", Allow: true, ForSession: true})
	v := waitView(t, s, key, "idle", func(v core.SessionView) bool { return state(v) == "idle" && len(v.Cards) == 0 })
	if hasNotice(v, "claude exited") { // the script expects destination "session"
		t.Fatalf("fake rejected the frame: %+v", v.Items)
	}
}

func TestE2E_AskUserQuestion(t *testing.T) {
	s, _, _ := newE2E(t, "question")
	key := send(t, s, core.SessionKey{}, "go")
	v := waitView(t, s, key, "question card", func(v core.SessionView) bool { return len(v.Cards) == 1 })
	c := v.Cards[0]
	if !c.IsQuestion() || c.Kind != core.CardQuestion || len(c.Questions) != 1 || c.Questions[0].Options[0].Label != "A" {
		t.Fatalf("card = %+v", c)
	}
	run(s, core.Action{Kind: core.ActionAnswer, Key: key, RequestID: "q1", Allow: true, Answers: map[string]string{"Which?": "A"}})
	v = waitView(t, s, key, "idle", func(v core.SessionView) bool { return state(v) == "idle" && len(v.Cards) == 0 })
	if hasNotice(v, "claude exited") {
		t.Fatalf("fake rejected the answers frame: %+v", v.Items)
	}
}

// ---- 6. auto-fork of a session running in VS Code ----

func TestE2E_AutoForkOfVSCodeSession(t *testing.T) {
	s, env, fr := newE2E(t, "fork_session")
	id := "aaaaaaaa-1111-4222-8333-bbbbbbbbbbbb"
	writeTranscript(t, env.Acct, env.Project, id)
	writeRegistry(t, env.Acct, os.Getppid(), id, "vscode", "busy")

	var parent core.SessionSummary
	for _, ss := range s.Sessions(true) {
		if ss.Key.SessionID == id {
			parent = ss
		}
	}
	if parent.Ctl.Kind != core.CtlElsewhere || parent.CtlWhere != "VS Code" {
		t.Fatalf("parent = ctl %+v where %q", parent.Ctl, parent.CtlWhere)
	}

	key := send(t, s, parent.Key, "continue")
	if key.DraftID == "" {
		t.Fatalf("open key = %+v, want the fork draft", key)
	}
	v := waitView(t, s, key, "fork id", func(v core.SessionView) bool { return v.Summary.Key.SessionID == fakeclaude.ForkUUID })
	if !hasNotice(v, "forked from") || !hasNotice(v, "VS Code") {
		t.Fatalf("items = %+v", v.Items)
	}

	fl := readFakeLog(t, fr.log)
	if len(fl.argvs) != 1 {
		t.Fatalf("spawns = %d", len(fl.argvs))
	}
	argv := strings.Join(fl.argvs[0], " ")
	if !strings.Contains(argv, "--resume "+id) || !strings.Contains(argv, "--fork-session") {
		t.Fatalf("argv = %s", argv)
	}
	waitLock(t, env, fakeclaude.ForkUUID)
	if _, ok := readLockFile(t, env.Dirs.Locks, id); ok {
		t.Fatal("the parent session must not be locked by a fork")
	}
}

// ---- 7. interrupt ----

func TestE2E_Interrupt(t *testing.T) {
	s, _, fr := newE2E(t, "interrupt")
	key := send(t, s, core.SessionKey{}, "long task")
	if st := state(waitView(t, s, key, "busy", func(v core.SessionView) bool { return state(v) == "busy" })); st != "busy" {
		t.Fatalf("state = %q", st)
	}
	if m := run(s, core.Action{Kind: core.ActionInterrupt, Key: key}); m != (core.ChangedMsg{}) {
		t.Fatalf("interrupt returned %+v", m)
	}
	v := waitView(t, s, key, "idle again", func(v core.SessionView) bool { return state(v) == "idle" })
	if hasNotice(v, "claude exited") {
		t.Fatalf("fake rejected a frame: %+v", v.Items)
	}
	if !readFakeLog(t, fr.log).hasFrame("control_request", "interrupt") {
		t.Fatal("the child never saw the interrupt request")
	}
	// idle now: nothing to interrupt
	if m, ok := run(s, core.Action{Kind: core.ActionInterrupt, Key: key}).(core.ErrMsg); !ok || m.Text != "not running" {
		t.Fatalf("second interrupt = %+v", m)
	}
}

// ---- 8. stop ----

func TestE2E_StopKillsChildAndReleasesLock(t *testing.T) {
	s, env, fr := newE2E(t, "hang_a")
	key := send(t, s, core.SessionKey{}, "go")
	waitLock(t, env, fakeclaude.SessionUUID)
	fl := waitSpawns(t, fr, 1)

	start := time.Now()
	run(s, core.Action{Kind: core.ActionStop, Key: key})
	waitDead(t, fl.pids[0])
	if d := time.Since(start); d > 2*time.Second {
		t.Fatalf("stop took %v", d)
	}
	if _, ok := readLockFile(t, env.Dirs.Locks, fakeclaude.SessionUUID); ok {
		t.Fatal("lock still present after :stop")
	}
	v, ok := s.View(key, "")
	if !ok || v.Ctl != nil {
		t.Fatalf("view after stop: ok=%v ctl=%+v", ok, v.Ctl)
	}
}

// ---- 9. crash and respawn ----

func TestE2E_CrashThenRespawnResumes(t *testing.T) {
	s, _, fr := newE2E(t, "crash")
	key := send(t, s, core.SessionKey{}, "first")
	v := waitView(t, s, key, "exit notice", func(v core.SessionView) bool {
		return state(v) == "exited" && hasNotice(v, "code 2")
	})
	if !hasNotice(v, "boom") || v.Ctl.Error == "" {
		t.Fatalf("notice/error missing: %+v / %q", v.Items, v.Ctl.Error)
	}

	send(t, s, key, "second")
	fl := waitSpawns(t, fr, 2)
	second := strings.Join(fl.argvs[1], " ")
	if !strings.Contains(second, "--resume "+fakeclaude.SessionUUID) || strings.Contains(second, "--fork-session") {
		t.Fatalf("second argv = %s", second)
	}
	if strings.Contains(strings.Join(fl.argvs[0], " "), "--resume") {
		t.Fatalf("first argv = %v", fl.argvs[0])
	}
}

// ---- 10. Close ----

func TestE2E_CloseStopsEveryChildAndReleasesLocks(t *testing.T) {
	s, env, fr := newE2E(t, "hang_a", "hang_b")
	send(t, s, core.SessionKey{}, "one")
	send(t, s, core.SessionKey{}, "two")
	waitLock(t, env, fakeclaude.SessionUUID)
	waitLock(t, env, fakeclaude.ForkUUID)
	fl := waitSpawns(t, fr, 2)

	s.Close()
	for _, pid := range fl.pids {
		waitDead(t, pid)
	}
	for _, id := range []string{fakeclaude.SessionUUID, fakeclaude.ForkUUID} {
		if _, ok := readLockFile(t, env.Dirs.Locks, id); ok {
			t.Fatalf("lock %s survived Close", id)
		}
	}
	s.Close() // idempotent
}

// ---- 11. two stores, one lock directory ----

func TestE2E_SecondACSeesForeignLockAndForks(t *testing.T) {
	a, env, _ := newE2E(t, "hang_a")
	b, frB := newE2EPeer(t, env, "fork_session")

	// A controls the session.
	send(t, a, core.SessionKey{}, "go")
	waitLock(t, env, fakeclaude.SessionUUID)
	id := fakeclaude.SessionUUID
	writeTranscript(t, env.Acct, env.Project, id)

	// Both stores live in this process, so make A's lock look foreign: it
	// now belongs to another live process (our parent).
	foreign := os.Getppid()
	writeForeignLock(t, env.Dirs.Locks, id, foreign, "acme")

	var row core.SessionSummary
	for _, ss := range b.Sessions(true) {
		if ss.Key.SessionID == id {
			row = ss
		}
	}
	if row.Ctl.Kind != core.CtlOtherAC || row.Ctl.PID != foreign || !strings.Contains(row.CtlWhere, "another ac") {
		t.Fatalf("B sees ctl %+v where %q", row.Ctl, row.CtlWhere)
	}

	key := send(t, b, row.Key, "mine now")
	v := waitView(t, b, key, "fork id", func(v core.SessionView) bool { return v.Summary.Key.SessionID == fakeclaude.ForkUUID })
	if !hasNotice(v, "forked from") || !hasNotice(v, "another ac") {
		t.Fatalf("items = %+v", v.Items)
	}
	fl := waitSpawns(t, frB, 1)
	argv := strings.Join(fl.argvs[0], " ")
	if !strings.Contains(argv, "--resume "+id) || !strings.Contains(argv, "--fork-session") {
		t.Fatalf("argv = %s", argv)
	}
	// the foreign lock was left alone
	if li, ok := readLockFile(t, env.Dirs.Locks, id); !ok || li.PID != foreign {
		t.Fatalf("lock = %+v ok=%v", li, ok)
	}
}

// ---- 5.3 CI guard ----

func TestGuard_OnlyTheTestBinaryMayBeSpawned(t *testing.T) {
	fr := newFakeRun(t, "new_session")
	script := fr.scripts[0]
	okEnv := []string{fakeclaude.EnvScript + "=" + script}

	if err := fr.guard.check(os.Args[0], okEnv); err != nil {
		t.Fatalf("guard rejects the test binary: %v", err)
	}
	bad := []struct {
		name, path string
		env        []string
	}{
		{"real claude", "claude", okEnv},
		{"claude exe", filepath.Join("C:/Users/u", ".local", "bin", "claude.exe"), okEnv},
		{"test binary without script", os.Args[0], nil},
		{"script outside testdata", os.Args[0], []string{fakeclaude.EnvScript + "=" + filepath.Join(os.TempDir(), "x.script")}},
	}
	if p, err := exec.LookPath("claude"); err == nil {
		bad = append(bad, struct {
			name, path string
			env        []string
		}{"claude on PATH", p, okEnv})
	}
	for _, c := range bad {
		if err := fr.guard.check(c.path, c.env); err == nil {
			t.Errorf("%s: guard accepted %q", c.name, c.path)
		}
	}
}

func TestGuard_StoresNeverPointAtARealClaude(t *testing.T) {
	// e2e stores run the test binary itself.
	s, _, _ := newE2E(t, "new_session")
	if s.claudePath != os.Args[0] {
		t.Fatalf("e2e ClaudePath = %q, want the test binary", s.claudePath)
	}
	// in-package fake-controller stores never reach a process at all.
	s2, _ := newTestStore(t)
	if s2.opts.NewController == nil {
		t.Fatal("newTestStore must inject a fake controller factory")
	}
	if p, err := exec.LookPath("claude"); err == nil && (s.claudePath == p || s2.claudePath == p) {
		t.Fatalf("a test store resolves to the real claude at %s", p)
	}
	// the spawner a default store would use must not be reachable from tests
	// unless AC_FAKE_CLAUDE is set: the child env of this process has no script.
	if os.Getenv(fakeclaude.EnvScript) != "" {
		t.Fatal(fakeclaude.EnvScript + " is set in the test process; it would turn it into the fake")
	}
}
