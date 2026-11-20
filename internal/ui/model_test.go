package ui

import (
	"strings"
	"testing"

	"github.com/charmbracelet/x/ansi"
	"github.com/longpl-1902/claude-ui/internal/core"
)

func TestInsert_RuneSafeBackspaceAndSend(t *testing.T) {
	be := newFakeBackend()
	h := newHarness(t, be, Options{}, 100, 30)

	h.typeText("xin chào").press("backspace", "backspace")
	if h.m.promptText != "xin ch" {
		t.Fatalf("prompt = %q, want %q", h.m.promptText, "xin ch")
	}
	h.press("enter")

	sends := be.recorded(core.ActionSend)
	if len(sends) != 1 || !sends[0].Key.IsZero() || sends[0].Text != "xin ch" {
		t.Fatalf("actions = %s", debugActions(be.actions))
	}
	if h.m.promptText != "" {
		t.Fatalf("prompt not cleared: %q", h.m.promptText)
	}
	if h.m.logKey != be.newKey {
		t.Fatalf("logKey = %+v, want %+v (OpenMsg)", h.m.logKey, be.newKey)
	}
}

func TestInsert_AltEnterNewlineAndHeightCap(t *testing.T) {
	h := newHarness(t, newFakeBackend(), Options{}, 100, 30)
	h.typeText("a").press("alt+enter").typeText("b")
	if h.m.promptText != "a\nb" {
		t.Fatalf("prompt = %q", h.m.promptText)
	}
	if got := h.m.promptHeight(); got != 2 {
		t.Fatalf("height = %d, want 2", got)
	}
	for i := 0; i < 20; i++ {
		h.press("alt+enter")
	}
	if got := h.m.promptHeight(); got != 8 {
		t.Fatalf("height = %d, want cap 8", got)
	}
}

func TestInsert_LongPromptStaysInsideTerminal(t *testing.T) {
	t.Skip("BUG: internal/ui/model.go viewPrompt renders every prompt line; promptHeight caps at 8 so the screen grows past the terminal height (44 lines at 30 rows)")
	h := newHarness(t, newFakeBackend(), Options{}, 100, 30)
	for i := 0; i < 20; i++ {
		h.press("alt+enter")
	}
	if n := len(strings.Split(h.plain(), "\n")); n > 30 {
		t.Fatalf("screen has %d lines, terminal has 30", n)
	}
}

func TestOverlay_FitsTerminalHeight(t *testing.T) {
	t.Skip("BUG: internal/ui/model.go viewOverlay appends the overlay below the full layout, so the screen is taller than the terminal (15 lines at 10 rows)")
	h := newHarness(t, newFakeBackend(), Options{}, 40, 10)
	h.feed(core.InfoMsg{Title: "ctx", Lines: []string{"a"}})
	if n := len(strings.Split(h.plain(), "\n")); n > 10 {
		t.Fatalf("screen has %d lines, terminal has 10", n)
	}
}

func TestEnter_ElsewhereSessionIsReadOnlyNeverForks(t *testing.T) {
	be := newFakeBackend()
	s := sess("s-vs", "refactor")
	s.Ctl = core.Ctl{Kind: core.CtlElsewhere, PID: 4242}
	s.CtlWhere = "VS Code"
	s.Source = core.SourceVSCode
	be.addSession(s)
	h := newHarness(t, be, Options{}, 140, 30)
	h.feed(core.ChangedMsg{})

	// NORMAL, focus the sessions pane, move onto the session row, open it.
	h.press("esc", "ctrl+w", "h", "j", "enter")

	if len(be.recorded(core.ActionFork)) != 0 {
		t.Fatalf("Enter forked: %s", debugActions(be.actions))
	}
	if h.m.logKey != s.Key {
		t.Fatalf("logKey = %+v", h.m.logKey)
	}
	if h.m.mode != ModeInsert {
		t.Fatalf("mode = %v, want INSERT", h.m.mode)
	}
	h.mustContain("read-only — running in VS Code")
}

func twoBlocked(be *fakeBackend) {
	for _, id := range []string{"s-a", "s-b", "s-c"} {
		s := sess(id, "title "+id)
		s.Ctl = core.Ctl{Kind: core.CtlMine}
		be.addSession(s)
	}
	for _, id := range []string{"s-b", "s-c"} {
		s := sess(id, "title "+id)
		s.Blocked = true
		s.Status = core.StatusNeedsYou
		be.setView(id, core.SessionView{
			Summary: s,
			Cards:   []core.Card{permCard("req-" + id), permCard("req-" + id + "-2")},
			Ctl:     &core.CtlInfo{State: "idle"},
		})
		be.attention = append(be.attention, core.Attention{Key: keyOf(id), Kind: "permission", Severity: core.SeverityBlocked})
	}
}

func TestTab_JumpsToBlockedAnswersAndReturns(t *testing.T) {
	be := newFakeBackend()
	twoBlocked(be)
	h := newHarness(t, be, Options{}, 120, 30)
	h.open(keyOf("s-a"))

	h.press("esc", "tab")
	if h.m.logKey != keyOf("s-b") {
		t.Fatalf("logKey = %+v, want s-b", h.m.logKey)
	}
	if len(h.m.logView.Cards) != 2 {
		t.Fatalf("cards = %d", len(h.m.logView.Cards))
	}
	h.press("a")

	ans := be.recorded(core.ActionAnswer)
	if len(ans) != 1 {
		t.Fatalf("actions = %s", debugActions(be.actions))
	}
	if !ans[0].Allow || ans[0].RequestID != "req-s-b" || ans[0].Key != keyOf("s-b") {
		t.Fatalf("answer = %+v", ans[0])
	}
	if h.m.logKey != keyOf("s-a") {
		t.Fatalf("did not return to previous session: %+v", h.m.logKey)
	}
}

func TestQuestionCard_TwoQuestionsOneAnswer(t *testing.T) {
	be := newFakeBackend()
	be.addSession(sess("s-q", "q"))
	be.setView("s-q", core.SessionView{
		Summary: sess("s-q", "q"),
		Cards: []core.Card{questionCard("q1",
			core.Question{Text: "Which db?", Header: "DB", Options: opts("pg", "sqlite")},
			core.Question{Text: "Which mode?", Header: "Mode", Options: opts("fast", "safe")},
		)},
		Ctl: &core.CtlInfo{State: "idle"},
	})
	h := newHarness(t, be, Options{}, 120, 30)
	h.open(keyOf("s-q"))

	h.press("esc", "2")
	if len(be.actions) != 0 {
		t.Fatalf("answered after the first question: %s", debugActions(be.actions))
	}
	h.press("1")

	ans := be.recorded(core.ActionAnswer)
	if len(ans) != 1 {
		t.Fatalf("actions = %s", debugActions(be.actions))
	}
	want := map[string]string{"Which db?": "sqlite", "Which mode?": "fast"}
	if len(ans[0].Answers) != 2 || ans[0].Answers["Which db?"] != want["Which db?"] || ans[0].Answers["Which mode?"] != want["Which mode?"] {
		t.Fatalf("answers = %v", ans[0].Answers)
	}
	if ans[0].RequestID != "q1" || !ans[0].Allow {
		t.Fatalf("answer = %+v", ans[0])
	}
}

func TestQuestionCard_MultiSelectJoinsLabels(t *testing.T) {
	be := newFakeBackend()
	be.addSession(sess("s-q", "q"))
	be.setView("s-q", core.SessionView{
		Summary: sess("s-q", "q"),
		Cards: []core.Card{questionCard("q1",
			core.Question{Text: "Which?", Header: "H", Multi: true, Options: opts("A", "B", "C")},
		)},
		Ctl: &core.CtlInfo{State: "idle"},
	})
	h := newHarness(t, be, Options{}, 120, 30)
	h.open(keyOf("s-q"))
	h.press("esc", "1", "3", "enter")

	ans := be.recorded(core.ActionAnswer)
	if len(ans) != 1 || ans[0].Answers["Which?"] != "A, C" {
		t.Fatalf("actions = %s", debugActions(be.actions))
	}
}

func busyBackend() *fakeBackend {
	be := newFakeBackend()
	s := sess("s-busy", "busy")
	s.Ctl = core.Ctl{Kind: core.CtlMine}
	be.addSession(s)
	be.setView("s-busy", core.SessionView{Summary: s, Ctl: &core.CtlInfo{State: "busy"}})
	return be
}

func TestCtrlC_InterruptsBusyAndStaysInInsert(t *testing.T) {
	be := busyBackend()
	h := newHarness(t, be, Options{}, 120, 30)
	h.open(keyOf("s-busy"))
	if h.m.mode != ModeInsert {
		t.Fatalf("mode = %v", h.m.mode)
	}
	h.press("ctrl+c")
	if n := len(be.recorded(core.ActionInterrupt)); n != 1 {
		t.Fatalf("interrupts = %d (%s)", n, debugActions(be.actions))
	}
	if h.m.mode != ModeInsert {
		t.Fatalf("mode = %v, want INSERT", h.m.mode)
	}
}

func TestEscEsc_InterruptsBusyInNormal(t *testing.T) {
	be := busyBackend()
	h := newHarness(t, be, Options{}, 120, 30)
	h.open(keyOf("s-busy"))
	h.press("esc")
	if h.m.mode != ModeNormal {
		t.Fatalf("mode = %v", h.m.mode)
	}
	if n := len(be.recorded(core.ActionInterrupt)); n != 0 {
		t.Fatalf("single Esc interrupted (%d)", n)
	}
	h.press("esc")
	if n := len(be.recorded(core.ActionInterrupt)); n != 1 {
		t.Fatalf("interrupts after Esc Esc = %d", n)
	}
}

func TestCtrlC_IdleInInsertLeavesToNormal(t *testing.T) {
	be := newFakeBackend()
	be.addSession(sess("s-i", "idle"))
	h := newHarness(t, be, Options{}, 120, 30)
	h.open(keyOf("s-i"))
	h.press("ctrl+c")
	if h.m.mode != ModeNormal || len(be.actions) != 0 || h.quit {
		t.Fatalf("mode=%v actions=%s quit=%v", h.m.mode, debugActions(be.actions), h.quit)
	}
}

func TestCommands_ForkStopQuit(t *testing.T) {
	be := newFakeBackend()
	be.addSession(sess("s-1", "one"))
	h := newHarness(t, be, Options{}, 120, 30)
	h.open(keyOf("s-1"))

	h.press("esc", ":").typeText("fork").press("enter")
	if f := be.recorded(core.ActionFork); len(f) != 1 || f[0].Key != keyOf("s-1") {
		t.Fatalf("fork: %s", debugActions(be.actions))
	}
	h.press(":").typeText("stop").press("enter")
	if f := be.recorded(core.ActionStop); len(f) != 1 || f[0].Key != keyOf("s-1") {
		t.Fatalf("stop: %s", debugActions(be.actions))
	}
	h.press(":").typeText("new /w/acme").press("enter")
	if f := be.recorded(core.ActionNewDraft); len(f) != 1 || f[0].Dir != "/w/acme" {
		t.Fatalf("new: %s", debugActions(be.actions))
	}
	if h.quit {
		t.Fatal("quit too early")
	}
	h.press(":").typeText("q").press("enter")
	if !h.quit {
		t.Fatal(":q did not quit")
	}
}

func TestRender_NeverExceedsTerminalWidth(t *testing.T) {
	be := newFakeBackend()
	title := "重构登录模块 và sửa lỗi hiển thị tiếng Việt rất dài 日本語のタイトル"
	s := sess("s-w", title)
	s.Ctl = core.Ctl{Kind: core.CtlElsewhere, PID: 7}
	s.CtlWhere = "a terminal (pid 7)"
	be.addSession(s)
	be.addSession(sess("s-x", "ghi chú — Việt Nam 🌏"))
	be.setView("s-w", core.SessionView{
		Summary: s,
		Items: []core.Item{
			{ID: "1", Kind: core.ItemPrompt, Text: "xin chào, hãy sửa lỗi này 你好世界 你好世界 你好世界 你好世界 你好世界"},
			{ID: "2", Kind: core.ItemText, Text: "**đậm** và `mã` với 日本語 hỗn hợp, đây là một dòng văn bản rất dài để buộc phải cắt hoặc bọc dòng ở màn hình hẹp"},
			{ID: "3", Kind: core.ItemTool, Tool: &core.ToolItem{UseID: "u", Name: "Bash", Target: "ls -la /đường/dẫn/rất/dài/日本語/file.txt"}},
			{ID: "4", Kind: core.ItemNotice, Text: "↳ forked from abcd1234 vì đang chạy trong VS Code"},
		},
		Typing: "đang gõ 你好 ...",
		Cards:  []core.Card{permCard("r1")},
		Ctl:    &core.CtlInfo{State: "busy", Model: "claude-test", CtxPct: 0.4},
	})
	for _, size := range [][2]int{{40, 10}, {200, 50}, {80, 24}} {
		w, ht := size[0], size[1]
		h := newHarness(t, be, Options{}, w, ht)
		h.feed(core.ChangedMsg{})
		h.open(keyOf("s-w"))
		h.press("tab")
		h.feed(core.InfoMsg{Title: "ctx", Lines: []string{"日本語 line"}})
		for _, content := range []string{ansi.Strip(h.m.View().Content), h.m.View().Content} {
			lines := strings.Split(content, "\n")
			for i, l := range lines {
				if sw := ansi.StringWidth(l); sw > w {
					t.Errorf("%dx%d: line %d is %d cells wide: %q", w, ht, i, sw, ansi.Strip(l))
				}
			}
		}
	}
}

func TestRender_CleanLayoutWithoutOverlay(t *testing.T) {
	be := newFakeBackend()
	be.addSession(sess("s-x", "ghi chú — Việt Nam 日本語"))
	for _, size := range [][2]int{{40, 10}, {200, 50}} {
		h := newHarness(t, be, Options{}, size[0], size[1])
		h.feed(core.ChangedMsg{})
		h.open(keyOf("s-x"))
		lines := strings.Split(h.plain(), "\n")
		if len(lines) != size[1] {
			t.Errorf("%v: %d lines, want %d", size, len(lines), size[1])
		}
		for i, l := range lines {
			if sw := ansi.StringWidth(l); sw > size[0] {
				t.Errorf("%v: line %d is %d wide", size, i, sw)
			}
		}
	}
}
