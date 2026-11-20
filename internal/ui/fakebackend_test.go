package ui

import (
	"fmt"
	"strings"
	"testing"
	"time"

	"github.com/charmbracelet/x/ansi"
	"github.com/longpl-1902/claude-ui/internal/core"

	tea "charm.land/bubbletea/v2"
)

// fakeBackend is an in-memory Backend. Do records the action and returns a
// command that applies simple effects.
type fakeBackend struct {
	acct      core.Account
	accts     []core.Account
	sessions  []core.SessionSummary
	views     map[string]core.SessionView // by key id
	attention []core.Attention
	actions   []core.Action
	newKey    core.SessionKey // returned as OpenMsg by a send with a zero key
}

func kid(k core.SessionKey) string {
	if k.SessionID != "" {
		return k.SessionID
	}
	return k.DraftID
}

func newFakeBackend() *fakeBackend {
	a := core.Account{ID: "acme", Name: "acme", Email: "u@example.com", SignedIn: true}
	b := core.Account{ID: "beta", Name: "beta", Email: "b@example.com", SignedIn: true}
	return &fakeBackend{
		acct:   a,
		accts:  []core.Account{a, b},
		views:  map[string]core.SessionView{},
		newKey: core.SessionKey{Account: "acme", SessionID: "s-new"},
	}
}

func (f *fakeBackend) Account() core.Account    { return f.acct }
func (f *fakeBackend) Accounts() []core.Account { return append([]core.Account(nil), f.accts...) }
func (f *fakeBackend) Sessions(bool) []core.SessionSummary {
	return append([]core.SessionSummary(nil), f.sessions...)
}

func (f *fakeBackend) View(k core.SessionKey, _ string) (core.SessionView, bool) {
	if v, ok := f.views[kid(k)]; ok {
		return v, true
	}
	for _, s := range f.sessions {
		if kid(s.Key) == kid(k) {
			return core.SessionView{Summary: s}, true
		}
	}
	return core.SessionView{}, false
}

func (f *fakeBackend) Attention() (int, int, []core.Attention) {
	return len(f.attention), 0, append([]core.Attention(nil), f.attention...)
}
func (f *fakeBackend) UsageToday() int64                   { return 0 }
func (f *fakeBackend) Completions(string, string) []string { return nil }
func (f *fakeBackend) SetNotify(func())                    {}

func (f *fakeBackend) Do(a core.Action) tea.Cmd {
	f.actions = append(f.actions, a)
	return func() tea.Msg {
		switch a.Kind {
		case core.ActionSwitchAccount:
			for _, x := range f.accts {
				if string(x.ID) == a.ID {
					f.acct = x
				}
			}
		case core.ActionSend:
			if a.Key.IsZero() {
				return core.OpenMsg{Key: f.newKey}
			}
		}
		return core.ChangedMsg{}
	}
}

// recorded returns the actions of one kind.
func (f *fakeBackend) recorded(k core.ActionKind) []core.Action {
	var out []core.Action
	for _, a := range f.actions {
		if a.Kind == k {
			out = append(out, a)
		}
	}
	return out
}

// harness drives a Model against a fakeBackend.
type harness struct {
	t    *testing.T
	m    Model
	be   *fakeBackend
	quit bool
}

func newHarness(t *testing.T, be *fakeBackend, o Options, w, h int) *harness {
	t.Helper()
	hs := &harness{t: t, be: be, m: NewModel(be, o)}
	hs.feed(tea.WindowSizeMsg{Width: w, Height: h})
	return hs
}

// feed sends msg to Update and executes the returned commands (depth <= 5).
func (h *harness) feed(msg tea.Msg) {
	h.t.Helper()
	next, cmd := h.m.Update(msg)
	h.m = next.(Model)
	h.run(cmd, 0)
}

func (h *harness) run(cmd tea.Cmd, depth int) {
	h.t.Helper()
	if cmd == nil || depth > 5 {
		return
	}
	done := make(chan tea.Msg, 1)
	go func() { done <- cmd() }()
	var msg tea.Msg
	select {
	case msg = <-done:
	case <-time.After(2 * time.Second):
		h.t.Fatal("command did not return (a tick?)")
	}
	switch v := msg.(type) {
	case nil:
	case tea.QuitMsg:
		h.quit = true
	case tea.BatchMsg:
		for _, c := range v {
			h.run(c, depth+1)
		}
	case tickMsg:
	default:
		next, c := h.m.Update(msg)
		h.m = next.(Model)
		h.run(c, depth+1)
	}
}

var keyNames = map[string]tea.Key{
	"enter":     {Code: tea.KeyEnter},
	"esc":       {Code: tea.KeyEscape},
	"tab":       {Code: tea.KeyTab},
	"backspace": {Code: tea.KeyBackspace},
	"up":        {Code: tea.KeyUp},
	"down":      {Code: tea.KeyDown},
	"left":      {Code: tea.KeyLeft},
	"right":     {Code: tea.KeyRight},
	"space":     {Code: ' ', Text: " "},
	"ctrl+c":    {Code: 'c', Mod: tea.ModCtrl},
	"ctrl+w":    {Code: 'w', Mod: tea.ModCtrl},
	"alt+enter": {Code: tea.KeyEnter, Mod: tea.ModAlt},
}

// press sends each named key (or one rune) and runs the resulting commands.
func (h *harness) press(keys ...string) *harness {
	h.t.Helper()
	for _, k := range keys {
		key, ok := keyNames[k]
		if !ok {
			r := []rune(k)
			if len(r) != 1 {
				h.t.Fatalf("press: unknown key name %q (use typeText for text)", k)
			}
			key = tea.Key{Code: r[0], Text: k}
		}
		h.feed(tea.KeyPressMsg(key))
	}
	return h
}

// typeText sends every rune of s as a key press.
func (h *harness) typeText(s string) *harness {
	h.t.Helper()
	for _, r := range s {
		if r == ' ' {
			h.press("space")
			continue
		}
		h.press(string(r))
	}
	return h
}

// plain is the rendered screen without styling.
func (h *harness) plain() string { return ansi.Strip(h.m.View().Content) }

// open shows key in the log pane, as the backend's OpenMsg does.
func (h *harness) open(k core.SessionKey) *harness {
	h.feed(core.OpenMsg{Key: k})
	return h
}

func sess(id, title string) core.SessionSummary {
	return core.SessionSummary{
		Key:         core.SessionKey{Account: "acme", SessionID: id},
		Title:       title,
		ProjectKey:  "p1",
		ProjectName: "proj",
		Status:      core.StatusWaiting,
	}
}

func keyOf(id string) core.SessionKey { return core.SessionKey{Account: "acme", SessionID: id} }

func (f *fakeBackend) addSession(s core.SessionSummary) {
	f.sessions = append(f.sessions, s)
}

func (f *fakeBackend) setView(id string, v core.SessionView) { f.views[id] = v }

func permCard(id string) core.Card {
	return core.Card{Kind: core.CardPermission, RequestID: id, ToolName: "Bash", DisplayName: "Bash", Preview: "ls", CanAllowSession: true}
}

func questionCard(id string, qs ...core.Question) core.Card {
	return core.Card{Kind: core.CardQuestion, RequestID: id, ToolName: "AskUserQuestion", DisplayName: "Question", Questions: qs}
}

func opts(labels ...string) []core.Option {
	var o []core.Option
	for _, l := range labels {
		o = append(o, core.Option{Label: l})
	}
	return o
}

func (h *harness) mustContain(sub string) {
	h.t.Helper()
	if s := h.plain(); !strings.Contains(s, sub) {
		h.t.Fatalf("screen does not contain %q:\n%s", sub, s)
	}
}

func debugActions(as []core.Action) string {
	var b strings.Builder
	for _, a := range as {
		fmt.Fprintf(&b, "%d:%+v ", a.Kind, a)
	}
	return b.String()
}
