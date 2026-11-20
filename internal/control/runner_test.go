package control

import (
	"bufio"
	"context"
	"encoding/json"
	"errors"
	"os"
	"path/filepath"
	"strings"
	"testing"
	"time"

	"github.com/longpl-1902/claude-ui/internal/control/fakeclaude"
	"github.com/longpl-1902/claude-ui/internal/core"
)

type harness struct {
	t      *testing.T
	s      *Session
	log    string
	events []Event
}

type hopts struct {
	launch Launch
	deps   Deps
}

// newHarness builds a session whose child is the fake claude running the
// named script from testdata.
func newHarness(t *testing.T, script string, o hopts) *harness {
	t.Helper()
	script, err := filepath.Abs(filepath.Join("testdata", script+".script"))
	if err != nil {
		t.Fatal(err)
	}
	log := filepath.Join(t.TempDir(), "fake.log")
	l := o.launch
	l.ClaudePath = os.Args[0]
	l.ConfigDir = t.TempDir()
	if l.Cwd == "" {
		l.Cwd = t.TempDir()
	}
	d := o.deps
	d.BaseEnv = append(os.Environ(),
		fakeclaude.EnvScript+"="+script,
		fakeclaude.EnvLog+"="+log,
		"ELECTRON_RUN_AS_NODE=1",
		"GORACE=atexit_sleep_ms=0", // the race runtime sleeps 1s at exit by default
	)
	if d.StopGrace == 0 {
		d.StopGrace = 200 * time.Millisecond
	}
	s := New(l, d)
	t.Cleanup(s.Close)
	return &harness{t: t, s: s, log: log}
}

// until reads events until pred matches (returning it) or the timeout hits.
func (h *harness) until(pred func(Event) bool) Event {
	h.t.Helper()
	timeout := time.After(10 * time.Second)
	for {
		select {
		case ev, ok := <-h.s.Events():
			if !ok {
				h.t.Fatal("events closed before the expected event")
			}
			h.events = append(h.events, ev)
			if pred(ev) {
				return ev
			}
		case <-timeout:
			h.t.Fatalf("timed out waiting for event; saw %d events: %+v", len(h.events), kinds(h.events))
		}
	}
}

func (h *harness) kind(k EventKind) Event {
	h.t.Helper()
	return h.until(func(e Event) bool { return e.Kind == k })
}

func (h *harness) state(st State) Event {
	h.t.Helper()
	return h.until(func(e Event) bool { return e.Kind == EvState && e.Text == st.String() })
}

func (h *harness) details(which string) Event {
	h.t.Helper()
	return h.until(func(e Event) bool { return e.Kind == EvDetails && e.Text == which })
}

func (h *harness) send(text string) {
	h.t.Helper()
	if err := h.s.Send(text); err != nil {
		h.t.Fatalf("Send: %v", err)
	}
}

func kinds(evs []Event) []int {
	out := make([]int, len(evs))
	for i, e := range evs {
		out[i] = int(e.Kind)
	}
	return out
}

func (h *harness) logLines() []map[string]any {
	h.t.Helper()
	f, err := os.Open(h.log)
	if errors.Is(err, os.ErrNotExist) {
		return nil
	}
	if err != nil {
		h.t.Fatal(err)
	}
	defer f.Close()
	var out []map[string]any
	sc := bufio.NewScanner(f)
	sc.Buffer(make([]byte, 1<<20), 1<<20)
	for sc.Scan() {
		var m map[string]any
		if err := json.Unmarshal(sc.Bytes(), &m); err != nil {
			h.t.Fatalf("bad log line %q: %v", sc.Text(), err)
		}
		out = append(out, m)
	}
	return out
}

func (h *harness) argvLines() [][]string {
	var out [][]string
	for _, m := range h.logLines() {
		if a, ok := m["argv"].([]any); ok {
			var argv []string
			for _, x := range a {
				argv = append(argv, x.(string))
			}
			out = append(out, argv)
		}
	}
	return out
}

func (h *harness) frames() []map[string]any {
	var out []map[string]any
	for _, m := range h.logLines() {
		if f, ok := m["frame"].(map[string]any); ok {
			out = append(out, f)
		}
	}
	return out
}

func contains(ss []string, v string) bool {
	for _, s := range ss {
		if s == v {
			return true
		}
	}
	return false
}

func TestDraftNeverSpawns(t *testing.T) {
	h := newHarness(t, "basic", hopts{})
	if got := h.s.Info().State; got != StateDraft {
		t.Fatalf("state = %v, want draft", got)
	}
	if len(h.s.Pending()) != 0 {
		t.Fatal("draft has pending cards")
	}
	if err := h.s.Send("   "); err == nil {
		t.Fatal("empty send must fail")
	}
	if err := h.s.Interrupt(); !errors.Is(err, ErrNotBusy) {
		t.Fatalf("Interrupt on draft = %v, want ErrNotBusy", err)
	}
	if _, err := h.s.Request(context.Background(), ReqMcpStatus, nil); !errors.Is(err, ErrNotLive) {
		t.Fatalf("Request on draft = %v, want ErrNotLive", err)
	}
	time.Sleep(100 * time.Millisecond)
	if lines := h.logLines(); len(lines) != 0 {
		t.Fatalf("draft wrote to the fake: %v", lines)
	}
	if err := h.s.Stop(context.Background()); err != nil {
		t.Fatal(err)
	}
	h.s.Close()
	for range h.s.Events() { // must be closed by Close
	}
	if err := h.s.Send("x"); !errors.Is(err, ErrClosed) {
		t.Fatalf("Send after Close = %v, want ErrClosed", err)
	}
}

func TestSendHandshakeAndTurn(t *testing.T) {
	h := newHarness(t, "basic", hopts{deps: Deps{BatchWindow: 5 * time.Millisecond}})
	h.send("hello")

	init := h.kind(EvInit)
	if init.SessionID != fakeclaude.SessionUUID || init.Model != "claude-test" || init.Version != "9.9.9" {
		t.Fatalf("init = %+v", init)
	}
	h.kind(EvThinking)
	typ := h.until(func(e Event) bool { return e.Kind == EvTyping && e.Text == "Hello" })
	if typ.Text != "Hello" {
		t.Fatal("typing text must accumulate")
	}
	end := h.kind(EvTurnEnd)
	if end.Cost != 0.5 || end.Text != "end_turn" {
		t.Fatalf("turn end = %+v", end)
	}
	h.details("get_context_usage")
	info := h.s.Info()
	if info.CtxPct != 0.25 {
		t.Fatalf("CtxPct = %v, want 0.25", info.CtxPct)
	}
	if info.CostUSD != 0.5 || info.Spawns != 1 || info.SessionID != fakeclaude.SessionUUID || info.PID == 0 {
		t.Fatalf("info = %+v", info)
	}
	if len(info.Commands) == 0 {
		t.Fatalf("commands = %v", info.Commands)
	}
	if info.State != StateIdle {
		t.Fatalf("state = %v, want idle", info.State)
	}

	// Frame order: initialize strictly before the user frame.
	fr := h.frames()
	if len(fr) < 2 {
		t.Fatalf("frames = %v", fr)
	}
	body0, _ := fr[0]["body"].(map[string]any)
	if fr[0]["type"] != "control_request" || body0["type"] != "initialize" {
		t.Fatalf("first frame = %v", fr[0])
	}
	if fr[1]["type"] != "user" || fr[1]["message"] != "hello" {
		t.Fatalf("second frame = %v", fr[1])
	}

	// Spawn details: args, env, cwd.
	argvs := h.argvLines()
	if len(argvs) != 1 {
		t.Fatalf("spawns = %d", len(argvs))
	}
	for _, bad := range []string{"--dangerously-skip-permissions", "bypassPermissions"} {
		if contains(argvs[0], bad) {
			t.Fatalf("argv has %s", bad)
		}
	}
	if !contains(argvs[0], "--permission-mode") || !contains(argvs[0], "stream-json") {
		t.Fatalf("argv = %v", argvs[0])
	}
	first := h.logLines()[0]
	if first["has_electron"] != false {
		t.Fatal("ELECTRON_RUN_AS_NODE leaked into the child")
	}
	if first["env_config_dir"] == "" {
		t.Fatal("CLAUDE_CONFIG_DIR missing in the child")
	}

	// Second send on a live child writes only a user frame.
	if err := h.s.Send("again"); err != nil {
		t.Fatal(err)
	}
	if h.s.Info().Spawns != 1 {
		t.Fatal("second send respawned a live child")
	}
}

func answerWhenCard(t *testing.T, h *harness, id string) core.Card {
	t.Helper()
	ev := h.until(func(e Event) bool { return e.Kind == EvPermission && e.RequestID == id })
	if ev.Card == nil || ev.Card.RequestID != id {
		t.Fatalf("permission event without card: %+v", ev)
	}
	return *ev.Card
}

func TestAllowAndAllowForSession(t *testing.T) {
	h := newHarness(t, "perm_allow", hopts{})
	h.send("go")

	c := answerWhenCard(t, h, "r1")
	if c.Kind != core.CardPermission || c.Preview != "ls" || !c.CanAllowSession || c.Description != "list files" {
		t.Fatalf("card = %+v", c)
	}
	if got := h.s.Pending(); len(got) != 1 || got[0].RequestID != "r1" {
		t.Fatalf("pending = %+v", got)
	}
	if err := h.s.Answer("r1", Answer{Allow: true}); err != nil {
		t.Fatal(err)
	}
	h.until(func(e Event) bool { return e.Kind == EvPermissionResolved && e.RequestID == "r1" })

	answerWhenCard(t, h, "r2")
	if err := h.s.Answer("r2", Answer{Allow: true, ForSession: true}); err != nil {
		t.Fatal(err)
	}
	h.kind(EvTurnEnd)
	if len(h.s.Pending()) != 0 {
		t.Fatal("pending not cleared")
	}
	if err := h.s.Answer("r2", Answer{Allow: true}); !errors.Is(err, ErrUnknownRequest) {
		t.Fatalf("second answer = %v, want ErrUnknownRequest", err)
	}
	// r1 (not for session) must not carry updatedPermissions.
	for _, f := range h.frames() {
		if f["request_id"] == "r1" {
			body := f["body"].(map[string]any)
			if _, has := body["updatedPermissions"]; has {
				t.Fatal("r1 carried session rules")
			}
		}
	}
}

func TestDenyDefaultsAndPlan(t *testing.T) {
	h := newHarness(t, "perm_deny", hopts{})
	h.send("go")

	c := answerWhenCard(t, h, "d1")
	if c.Preview != "C:/Users/u/a.txt" {
		t.Fatalf("preview = %q", c.Preview)
	}
	if err := h.s.Answer("d1", Answer{}); err != nil {
		t.Fatal(err)
	}
	answerWhenCard(t, h, "d2")
	if err := h.s.Answer("d2", Answer{Message: "not now"}); err != nil {
		t.Fatal(err)
	}
	plan := answerWhenCard(t, h, "d3")
	if plan.Kind != core.CardPlan || plan.Preview != "step 1" || !plan.IsPlan() || !plan.IsPermission() {
		t.Fatalf("plan card = %+v", plan)
	}
	if err := h.s.Answer("d3", Answer{}); err != nil {
		t.Fatal(err)
	}
	answerWhenCard(t, h, "d4")
	if err := h.s.Answer("d4", Answer{Allow: true}); err != nil {
		t.Fatal(err)
	}
	// Script exits 3 if any frame mismatched; wait for the child to finish.
	ev := h.kind(EvExited)
	if ev.Code != 0 {
		t.Fatalf("fake exited %d: %s", ev.Code, ev.Error)
	}
}

func TestQuestionAnswers(t *testing.T) {
	h := newHarness(t, "perm_question", hopts{})
	h.send("go")
	c := answerWhenCard(t, h, "q1")
	if c.Kind != core.CardQuestion || len(c.Questions) != 1 || c.Questions[0].Text != "Which?" ||
		len(c.Questions[0].Options) != 2 || c.Questions[0].Options[0].Description != "first" {
		t.Fatalf("card = %+v", c)
	}
	if err := h.s.Answer("q1", Answer{Allow: true, Answers: map[string]string{"Which?": "A"}}); err != nil {
		t.Fatal(err)
	}
	if ev := h.kind(EvExited); ev.Code != 0 {
		t.Fatalf("fake exited %d: %s", ev.Code, ev.Error)
	}
}

func TestUnknownControlRequestGetsUnsupported(t *testing.T) {
	h := newHarness(t, "unsupported", hopts{})
	h.send("go")
	n := h.kind(EvNotice)
	if !strings.Contains(n.Text, "set_foo") {
		t.Fatalf("notice = %q", n.Text)
	}
	if ev := h.kind(EvExited); ev.Code != 0 {
		t.Fatalf("fake exited %d: %s", ev.Code, ev.Error)
	}
}

func TestCancelDropsCard(t *testing.T) {
	h := newHarness(t, "cancel", hopts{})
	h.send("go")
	answerWhenCard(t, h, "r1")
	h.until(func(e Event) bool { return e.Kind == EvPermissionResolved && e.RequestID == "r1" })
	if len(h.s.Pending()) != 0 {
		t.Fatal("card not dropped")
	}
}

func TestInterruptDeniesPendingFirst(t *testing.T) {
	h := newHarness(t, "interrupt", hopts{})
	h.send("go")
	answerWhenCard(t, h, "r1")
	if err := h.s.Interrupt(); err != nil {
		t.Fatal(err)
	}
	h.until(func(e Event) bool { return e.Kind == EvPermissionResolved && e.RequestID == "r1" })
	h.kind(EvTurnEnd)
	if ev := h.kind(EvExited); ev.Code != 0 {
		t.Fatalf("fake exited %d (frame order wrong?): %s", ev.Code, ev.Error)
	}
}

func TestInterruptWhenIdleIsNotBusy(t *testing.T) {
	h := newHarness(t, "basic", hopts{})
	h.send("hello")
	h.state(StateIdle)
	if err := h.s.Interrupt(); !errors.Is(err, ErrNotBusy) {
		t.Fatalf("Interrupt idle = %v, want ErrNotBusy", err)
	}
}

func TestStopDeniesPendingAndInterrupts(t *testing.T) {
	h := newHarness(t, "stop_pending", hopts{})
	h.send("go")
	answerWhenCard(t, h, "r1")
	if err := h.s.Stop(context.Background()); err != nil {
		t.Fatal(err)
	}
	if ev := h.kind(EvExited); ev.Code != 0 {
		t.Fatalf("fake exited %d: %s", ev.Code, ev.Error)
	}
	if got := h.s.Info().State; got != StateExited {
		t.Fatalf("state = %v", got)
	}
	if err := h.s.Stop(context.Background()); err != nil { // idempotent
		t.Fatal(err)
	}
}

func TestStopKillsHungChildAfterGrace(t *testing.T) {
	h := newHarness(t, "hang", hopts{deps: Deps{StopGrace: 200 * time.Millisecond}})
	h.send("go")
	h.state(StateBusy)
	time.Sleep(100 * time.Millisecond) // let the fake reach `hang`
	start := time.Now()
	if err := h.s.Stop(context.Background()); err != nil {
		t.Fatal(err)
	}
	el := time.Since(start)
	if el < 150*time.Millisecond || el > 4*time.Second {
		t.Fatalf("stop took %v, want about the 200ms grace", el)
	}
	ev := h.kind(EvExited)
	if ev.Code == 0 {
		t.Fatal("killed child reported code 0")
	}
	if h.s.Info().State != StateExited {
		t.Fatal("not exited")
	}
}

func TestNonZeroExitCarriesStderr(t *testing.T) {
	h := newHarness(t, "crash", hopts{})
	h.send("go")
	ev := h.kind(EvExited)
	if ev.Code != 2 || !strings.Contains(ev.Error, "boom: bad thing") {
		t.Fatalf("exit = %+v", ev)
	}
	if strings.Contains(ev.Error, "\x1b") {
		t.Fatal("ANSI not stripped")
	}
	if h.s.Info().Error == "" {
		t.Fatal("Info.Error empty")
	}
}

func TestRespawnResumesWithInitID(t *testing.T) {
	parent := "aaaaaaaa-bbbb-4ccc-8ddd-eeeeeeeeeeee"
	h := newHarness(t, "respawn", hopts{launch: Launch{SessionID: parent, Fork: true}})
	h.send("one")
	h.kind(EvInit)
	h.kind(EvExited)
	if err := h.s.Send("two"); err != nil {
		t.Fatal(err)
	}
	h.until(func(e Event) bool { return e.Kind == EvExited })
	argvs := h.argvLines()
	if len(argvs) != 2 || h.s.Info().Spawns != 2 {
		t.Fatalf("spawns: argv=%d info=%d", len(argvs), h.s.Info().Spawns)
	}
	if !contains(argvs[0], "--fork-session") || !contains(argvs[0], parent) {
		t.Fatalf("first argv = %v", argvs[0])
	}
	if contains(argvs[1], "--fork-session") || !contains(argvs[1], "--resume") || !contains(argvs[1], fakeclaude.SessionUUID) || contains(argvs[1], parent) {
		t.Fatalf("second argv = %v", argvs[1])
	}
}

func TestRequestCorrelationAndTimeout(t *testing.T) {
	h := newHarness(t, "request", hopts{deps: Deps{RequestTimeout: 300 * time.Millisecond}})
	h.send("go")
	h.details("mcp_status")

	body, err := h.s.Request(context.Background(), ReqRenameSession, map[string]any{"title": "x"})
	if err != nil || !strings.Contains(string(body), `"ok":true`) {
		t.Fatalf("rename = %s, %v", body, err)
	}
	if err := h.s.SetModel("sonnet"); err != nil {
		t.Fatal(err)
	}
	if h.s.Info().Model != "sonnet" {
		t.Fatal("model not updated")
	}
	if err := h.s.SetModel("--bad"); err == nil {
		t.Fatal("invalid model accepted")
	}
	if err := h.s.SetMode("nope"); err == nil {
		t.Fatal("invalid mode accepted")
	}
	_, err = h.s.Request(context.Background(), ReqGetContextUsage, nil)
	if err == nil || !strings.Contains(err.Error(), "timed out") {
		t.Fatalf("want timeout, got %v", err)
	}
	// Stop fails waiters with ErrNotLive.
	errc := make(chan error, 1)
	go func() {
		_, e := h.s.Request(context.Background(), ReqMcpStatus, nil)
		errc <- e
	}()
	time.Sleep(50 * time.Millisecond)
	_ = h.s.Stop(context.Background())
	select {
	case e := <-errc:
		if !errors.Is(e, ErrNotLive) {
			t.Fatalf("waiter error = %v, want ErrNotLive", e)
		}
	case <-time.After(5 * time.Second):
		t.Fatal("waiter not released")
	}
}

func TestSetModelAndModeStoredBeforeSpawn(t *testing.T) {
	h := newHarness(t, "respawn", hopts{})
	if err := h.s.SetModel("sonnet"); err != nil {
		t.Fatal(err)
	}
	if err := h.s.SetMode("plan"); err != nil {
		t.Fatal(err)
	}
	h.send("go")
	h.kind(EvExited)
	argv := h.argvLines()[0]
	if !contains(argv, "sonnet") || !contains(argv, "plan") {
		t.Fatalf("argv = %v", argv)
	}
}

func TestTypingEventsCollapse(t *testing.T) {
	h := newHarness(t, "typing", hopts{deps: Deps{BatchWindow: 400 * time.Millisecond}})
	h.send("go")
	h.kind(EvTurnEnd)
	n, last := 0, ""
	for _, e := range h.events {
		if e.Kind == EvTyping {
			n++
			last = e.Text
		}
	}
	if last != "abcdef" {
		t.Fatalf("last typing = %q", last)
	}
	if n > 3 {
		t.Fatalf("%d typing events, want them collapsed", n)
	}
}

func TestSpawnFailureReturnsError(t *testing.T) {
	h := newHarness(t, "basic", hopts{launch: Launch{Cwd: filepath.Join(t.TempDir(), "missing")}})
	err := h.s.Send("hi")
	if err == nil || !strings.Contains(err.Error(), "missing") {
		t.Fatalf("err = %v, want cwd named", err)
	}
	if h.s.Info().Spawns != 0 || h.s.Info().State != StateDraft {
		t.Fatalf("info = %+v", h.s.Info())
	}
}
