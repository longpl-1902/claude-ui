package app

import (
	"errors"
	"fmt"
	"os"
	"strings"
	"sync/atomic"
	"testing"
	"time"

	"github.com/longpl-1902/claude-ui/internal/control"
	"github.com/longpl-1902/claude-ui/internal/core"
)

const otherSessionID = "22222222-aaaa-4bbb-8ccc-000000000002"

func sessionByID(s *Store, id string) (core.SessionSummary, bool) {
	for _, x := range s.Sessions(true) {
		if x.Key.SessionID == id {
			return x, true
		}
	}
	return core.SessionSummary{}, false
}

func TestR19NothingSpawnsWithoutSend(t *testing.T) {
	s, ff, env := newTestStoreEnv(t)
	writeTranscript(t, env.Acct, env.Project, testSessionID)
	sum, ok := sessionByID(s, testSessionID)
	if !ok {
		t.Fatal("session not listed")
	}
	if v, ok := s.View(sum.Key, ""); !ok || len(v.Items) == 0 {
		t.Fatalf("view should load the transcript, got %v %d items", ok, len(v.Items))
	}
	run(s, core.Action{Kind: core.ActionNewDraft})
	run(s, core.Action{Kind: core.ActionFork, Key: sum.Key})
	run(s, core.Action{Kind: core.ActionCtx, Key: sum.Key})
	run(s, core.Action{Kind: core.ActionMcp, Key: sum.Key})
	if n := ff.totalSends(); n != 0 {
		t.Fatalf("Send called %d times", n)
	}
	for _, f := range ff.all() {
		if len(f.Requests) != 0 {
			t.Fatal("request issued before the first send")
		}
	}
}

func TestSendNewSessionAndInit(t *testing.T) {
	s, ff, env := newTestStoreEnv(t)
	msg := run(s, core.Action{Kind: core.ActionSend, Text: "hello"})
	open, ok := msg.(core.OpenMsg)
	if !ok || open.Key.DraftID == "" {
		t.Fatalf("want OpenMsg with draft key, got %#v", msg)
	}
	f := ff.last(t)
	if got := f.sends(); len(got) != 1 || got[0] != "hello" {
		t.Fatalf("sends = %v", got)
	}
	if f.Launch.Cwd != env.Project || f.Launch.ConfigDir != env.Acct.ConfigDir || f.Launch.SessionID != "" {
		t.Fatalf("launch = %+v", f.Launch)
	}
	f.feed(control.Event{Kind: control.EvInit, SessionID: testSessionID, Model: "m1"})
	eventually(t, "view resolves", func() bool {
		v, ok := s.View(open.Key, "")
		return ok && v.Summary.Key.SessionID == testSessionID
	})
	li, ok := readLockFile(t, env.Dirs.Locks, testSessionID)
	if !ok || li.PID != os.Getpid() || li.Account != "acme" {
		t.Fatalf("lock = %+v ok=%v", li, ok)
	}
	v, _ := s.View(open.Key, "")
	if v.Ctl == nil || v.Ctl.Model != "m1" {
		t.Fatalf("ctl = %+v", v.Ctl)
	}
	// the optimistic echo is visible
	if len(v.Items) == 0 || v.Items[len(v.Items)-1].Text != "hello" {
		t.Fatalf("items = %+v", v.Items)
	}
}

func TestResumeIdleTranscriptSession(t *testing.T) {
	s, ff, env := newTestStoreEnv(t)
	writeTranscript(t, env.Acct, env.Project, testSessionID)
	sum, _ := sessionByID(s, testSessionID)
	ff.Hook = func(f *fakeCtl, _ string) {
		if _, ok := readLockFile(t, env.Dirs.Locks, testSessionID); !ok {
			t.Error("lock must exist before Send")
		}
	}
	msg := run(s, core.Action{Kind: core.ActionSend, Key: sum.Key, Text: "more"})
	if _, ok := msg.(core.ChangedMsg); !ok {
		t.Fatalf("msg = %#v", msg)
	}
	f := ff.last(t)
	if f.Launch.SessionID != testSessionID || f.Launch.Fork || f.Launch.Cwd != env.Project {
		t.Fatalf("launch = %+v", f.Launch)
	}
}

func TestAutoForkWhenRunningInVSCode(t *testing.T) {
	s, ff, env := newTestStoreEnv(t)
	writeTranscript(t, env.Acct, env.Project, testSessionID)
	writeRegistry(t, env.Acct, os.Getppid(), testSessionID, "vscode", "idle")
	sum, _ := sessionByID(s, testSessionID)
	if sum.Ctl.Kind != core.CtlElsewhere || sum.CtlWhere != "VS Code" {
		t.Fatalf("summary = %+v", sum)
	}
	msg := run(s, core.Action{Kind: core.ActionSend, Key: sum.Key, Text: "hi"})
	open, ok := msg.(core.OpenMsg)
	if !ok || open.Key.DraftID == "" || open.Key.SessionID == testSessionID {
		t.Fatalf("msg = %#v", msg)
	}
	f := ff.last(t)
	if f.Launch.SessionID != testSessionID || !f.Launch.Fork {
		t.Fatalf("launch = %+v", f.Launch)
	}
	v, _ := s.View(open.Key, "")
	want := "↳ forked from " + testSessionID[:8] + " because it is running in VS Code"
	found := false
	for _, it := range v.Items {
		if it.Kind == core.ItemNotice && it.Text == want {
			found = true
		}
	}
	if !found {
		t.Fatalf("notice missing: %+v", v.Items)
	}
	orig, _ := sessionByID(s, testSessionID)
	if orig.Ctl.Kind != core.CtlElsewhere {
		t.Fatalf("original changed: %+v", orig)
	}
	if _, ok := readLockFile(t, env.Dirs.Locks, testSessionID); ok {
		t.Fatal("must not lock the parent when forking")
	}
}

func TestAutoForkWhenLockedByOtherAC(t *testing.T) {
	s, ff, env := newTestStoreEnv(t)
	writeTranscript(t, env.Acct, env.Project, testSessionID)
	writeForeignLock(t, env.Dirs.Locks, testSessionID, os.Getppid(), "acme")
	sum, _ := sessionByID(s, testSessionID)
	if sum.Ctl.Kind != core.CtlOtherAC {
		t.Fatalf("ctl = %+v", sum.Ctl)
	}
	run(s, core.Action{Kind: core.ActionSend, Key: sum.Key, Text: "hi"})
	if !ff.last(t).Launch.Fork {
		t.Fatal("expected a fork")
	}
	want := fmt.Sprintf("another ac (pid %d, acme)", os.Getppid())
	if sum.CtlWhere != want {
		t.Fatalf("where = %q want %q", sum.CtlWhere, want)
	}
}

func TestStaleLockResumes(t *testing.T) {
	s, ff, env := newTestStoreEnv(t)
	writeTranscript(t, env.Acct, env.Project, testSessionID)
	writeForeignLock(t, env.Dirs.Locks, testSessionID, 999999999, "acme")
	sum, _ := sessionByID(s, testSessionID)
	run(s, core.Action{Kind: core.ActionSend, Key: sum.Key, Text: "hi"})
	if l := ff.last(t).Launch; l.Fork || l.SessionID != testSessionID {
		t.Fatalf("launch = %+v", l)
	}
}

func TestOwnChildInRegistryStaysMine(t *testing.T) {
	s, ff, env := newTestStoreEnv(t)
	writeTranscript(t, env.Acct, env.Project, testSessionID)
	sum, _ := sessionByID(s, testSessionID)
	run(s, core.Action{Kind: core.ActionSend, Key: sum.Key, Text: "hi"})
	f := ff.last(t)
	f.mu.Lock()
	f.InfoVal.PID = os.Getppid() // a live pid standing in for our child
	f.mu.Unlock()
	writeRegistry(t, env.Acct, os.Getppid(), testSessionID, "sdk-cli", "busy")
	got, _ := sessionByID(s, testSessionID)
	if got.Ctl.Kind != core.CtlMine || got.CtlWhere != "" {
		t.Fatalf("got %+v", got)
	}
}

func startControlled(t *testing.T, s *Store, ff *fakeCtlFactory) (core.SessionKey, *fakeCtl) {
	t.Helper()
	msg := run(s, core.Action{Kind: core.ActionSend, Text: "go"})
	open := msg.(core.OpenMsg)
	f := ff.last(t)
	f.feed(control.Event{Kind: control.EvInit, SessionID: testSessionID})
	eventually(t, "init", func() bool {
		v, ok := s.View(open.Key, "")
		return ok && v.Summary.Key.SessionID != ""
	})
	return open.Key, f
}

func TestPermissionCardAnswerFlow(t *testing.T) {
	s, ff := newTestStore(t)
	key, f := startControlled(t, s, ff)
	card := core.Card{RequestID: "r1", ToolName: "Bash", DisplayName: "Bash", Since: time.Now()}
	f.feed(control.Event{Kind: control.EvPermission, Card: &card, RequestID: "r1"})
	eventually(t, "card", func() bool {
		v, _ := s.View(key, "")
		return len(v.Cards) == 1
	})
	v, _ := s.View(key, "")
	if !v.Summary.Blocked || v.Summary.Status != core.StatusNeedsYou {
		t.Fatalf("summary = %+v", v.Summary)
	}
	if mine, _, items := s.Attention(); mine != 1 || len(items) != 1 || items[0].Kind != "permission" {
		t.Fatalf("attention %d %+v", mine, items)
	}
	run(s, core.Action{Kind: core.ActionAnswer, Key: key, RequestID: "r1", Allow: true})
	got := f.answers()
	if len(got) != 1 || got[0].ReqID != "r1" || !got[0].A.Allow {
		t.Fatalf("answers = %+v", got)
	}
	f.feed(control.Event{Kind: control.EvPermissionResolved, RequestID: "r1"})
	eventually(t, "resolved", func() bool {
		v, _ := s.View(key, "")
		return len(v.Cards) == 0
	})
	if mine, _, _ := s.Attention(); mine != 0 {
		t.Fatalf("attention mine = %d", mine)
	}
}

func TestAnswerUnknownRequest(t *testing.T) {
	s, ff := newTestStore(t)
	key, _ := startControlled(t, s, ff)
	if _, ok := run(s, core.Action{Kind: core.ActionAnswer, Key: key, RequestID: "nope"}).(core.ErrMsg); !ok {
		t.Fatal("want ErrMsg")
	}
	if _, ok := run(s, core.Action{Kind: core.ActionAnswer, Key: core.SessionKey{SessionID: "x"}, RequestID: "nope"}).(core.ErrMsg); !ok {
		t.Fatal("want ErrMsg for uncontrolled session")
	}
}

func TestQuestionTextBecomesOtherAnswer(t *testing.T) {
	s, ff := newTestStore(t)
	key, f := startControlled(t, s, ff)
	card := core.Card{Kind: core.CardQuestion, RequestID: "q1", Questions: []core.Question{{Text: "Which?", Options: []core.Option{{Label: "a"}}}}}
	f.feed(control.Event{Kind: control.EvPermission, Card: &card, RequestID: "q1"})
	eventually(t, "card", func() bool { v, _ := s.View(key, ""); return len(v.Cards) == 1 })
	before := len(f.sends())
	run(s, core.Action{Kind: core.ActionSend, Key: key, Text: "something else"})
	got := f.answers()
	if len(got) != 1 || got[0].A.Answers["Which?"] != "something else" {
		t.Fatalf("answers = %+v", got)
	}
	if len(f.sends()) != before {
		t.Fatal("text must not be sent as a prompt")
	}
}

func TestInterruptNotBusy(t *testing.T) {
	s, ff := newTestStore(t)
	key, f := startControlled(t, s, ff)
	f.mu.Lock()
	f.IntErr = errNotBusy
	f.mu.Unlock()
	m, ok := run(s, core.Action{Kind: core.ActionInterrupt, Key: key}).(core.ErrMsg)
	if !ok || m.Text != "not running" {
		t.Fatalf("msg = %#v", m)
	}
}

func TestStopReleasesLock(t *testing.T) {
	s, ff, env := newTestStoreEnv(t)
	key, f := startControlled(t, s, ff)
	if _, ok := readLockFile(t, env.Dirs.Locks, testSessionID); !ok {
		t.Fatal("lock missing")
	}
	run(s, core.Action{Kind: core.ActionStop, Key: key})
	if f.Stops != 1 || f.Closes < 1 {
		t.Fatalf("stops=%d closes=%d", f.Stops, f.Closes)
	}
	if _, ok := readLockFile(t, env.Dirs.Locks, testSessionID); ok {
		t.Fatal("lock not released")
	}
	v, _ := s.View(key, "")
	if v.Summary.Ctl.Kind != core.CtlNone || v.Ctl != nil {
		t.Fatalf("still controlled: %+v", v.Summary.Ctl)
	}
}

func TestExitedNotice(t *testing.T) {
	s, ff := newTestStore(t)
	key, f := startControlled(t, s, ff)
	f.feed(control.Event{Kind: control.EvExited, Code: 1, Error: "boom"})
	eventually(t, "exit", func() bool { v, _ := s.View(key, ""); return v.Ctl != nil && v.Ctl.State == "exited" })
	v, _ := s.View(key, "")
	if v.Ctl.Error != "boom" {
		t.Fatalf("ctl error = %q", v.Ctl.Error)
	}
	found := false
	for _, it := range v.Items {
		if it.Text == "claude exited (code 1): boom" {
			found = true
		}
	}
	if !found {
		t.Fatalf("items = %+v", v.Items)
	}
}

func TestNotSignedInNeverSpawns(t *testing.T) {
	s, ff, env := newTestStoreEnv(t)
	s.mu.Lock()
	s.account.SignedIn = false
	s.accounts[0].SignedIn = false
	s.mu.Unlock()
	_ = env
	if _, ok := run(s, core.Action{Kind: core.ActionSend, Text: "hi"}).(core.ErrMsg); !ok {
		t.Fatal("want ErrMsg")
	}
	if len(ff.all()) != 0 {
		t.Fatal("factory must not be called")
	}
}

func TestSendFailureCleansUp(t *testing.T) {
	s, ff, env := newTestStoreEnv(t)
	ff.Hook = func(f *fakeCtl, _ string) {
		f.mu.Lock()
		f.SendErr = errors.New("spawn failed")
		f.mu.Unlock()
	}
	m, ok := run(s, core.Action{Kind: core.ActionSend, Text: "hi"}).(core.ErrMsg)
	if !ok || !strings.HasPrefix(m.Text, "send failed:") {
		t.Fatalf("msg = %#v", m)
	}
	if len(s.Sessions(true)) != 0 {
		t.Fatal("draft row should be removed")
	}
	_ = env
}

func TestNotifyIsCoalescedAndNeverUnderLock(t *testing.T) {
	s, ff := newTestStore(t)
	key, f := startControlled(t, s, ff)
	var calls atomic.Int32
	done := make(chan struct{}, 64)
	s.SetNotify(func() {
		_ = s.Account() // deadlocks if notify were called with mu held
		calls.Add(1)
		done <- struct{}{}
	})
	for i := 0; i < 200; i++ {
		f.feed(control.Event{Kind: control.EvTyping, Text: fmt.Sprintf("t%d", i)})
	}
	eventually(t, "typing", func() bool { v, _ := s.View(key, ""); return v.Typing == "t199" })
	time.Sleep(100 * time.Millisecond)
	if n := calls.Load(); n < 1 || n > 3 {
		t.Fatalf("notify calls = %d", n)
	}
}

func TestCloseStopsEverything(t *testing.T) {
	s, ff, env := newTestStoreEnv(t)
	startControlled(t, s, ff)
	writeTranscript(t, env.Acct, env.Project, otherSessionID)
	sum, _ := sessionByID(s, otherSessionID)
	run(s, core.Action{Kind: core.ActionSend, Key: sum.Key, Text: "x"})
	s.Close()
	for _, f := range ff.all() {
		if f.Stops != 1 || f.Closes < 1 {
			t.Fatalf("fake not stopped: stops=%d closes=%d", f.Stops, f.Closes)
		}
	}
	for _, id := range []string{testSessionID, otherSessionID} {
		if _, ok := readLockFile(t, env.Dirs.Locks, id); ok {
			t.Fatalf("lock %s left behind", id)
		}
	}
	s.Close() // idempotent
}

func TestToolUseAndResultAreOneItem(t *testing.T) {
	s, _, env := newTestStoreEnv(t)
	writeTranscript(t, env.Acct, env.Project, testSessionID)
	sum, _ := sessionByID(s, testSessionID)
	v, ok := s.View(sum.Key, "")
	if !ok {
		t.Fatal("no view")
	}
	n := 0
	for _, it := range v.Items {
		if it.Kind == core.ItemTool && it.Tool.UseID == "tu_001" {
			n++
			if it.Tool.Result == "" || it.Tool.Open || it.Tool.Name != "Read" {
				t.Fatalf("tool item not merged: %+v", it.Tool)
			}
		}
	}
	if n != 1 {
		t.Fatalf("tool_001 items = %d", n)
	}
}

func TestSessionsRescanResetsEndedProcess(t *testing.T) {
	s, _, env := newTestStoreEnv(t)
	writeTranscript(t, env.Acct, env.Project, testSessionID)
	writeRegistry(t, env.Acct, os.Getppid(), testSessionID, "cli", "busy")
	if sum, _ := sessionByID(s, testSessionID); sum.Ctl.Kind != core.CtlElsewhere || sum.Status != core.StatusRunning {
		t.Fatalf("sum = %+v", sum)
	}
	// the process ends: registry names a dead pid now
	writeRegistry(t, env.Acct, os.Getppid(), testSessionID, "cli", "busy")
	if err := os.Remove(env.Acct.ConfigDir + "/sessions/" + fmt.Sprint(os.Getppid()) + ".json"); err != nil {
		t.Fatal(err)
	}
	writeRegistry(t, env.Acct, 999999999, testSessionID, "cli", "busy")
	if sum, _ := sessionByID(s, testSessionID); sum.Ctl.Kind != core.CtlNone || sum.Status != core.StatusDone {
		t.Fatalf("not reset: %+v", sum)
	}
}
