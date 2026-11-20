package control

import (
	"encoding/json"
	"strings"
	"testing"
	"time"

	"github.com/longpl-1902/claude-ui/internal/core"
)

func cardFor(t *testing.T, tool, input string, mut func(*Msg)) core.Card {
	t.Helper()
	m := Msg{Kind: MsgCanUseTool, RequestID: "r", ToolName: tool, DisplayName: tool, Input: json.RawMessage(input)}
	if mut != nil {
		mut(&m)
	}
	return CardFromMsg(m, time.Unix(100, 0))
}

func TestCardPreviews(t *testing.T) {
	cases := []struct {
		tool, input, want string
	}{
		{"Bash", `{"command":"go test ./..."}`, "go test ./..."},
		{"Edit", `{"file_path":"C:/Users/u/a.go","old_string":"x"}`, "C:/Users/u/a.go"},
		{"Write", `{"file_path":"C:/Users/u/b.go"}`, "C:/Users/u/b.go"},
		{"Read", `{"file_path":"C:/Users/u/c.go"}`, "C:/Users/u/c.go"},
		{"NotebookEdit", `{"file_path":"C:/Users/u/n.ipynb"}`, "C:/Users/u/n.ipynb"},
		{"WebFetch", `{"url":"https://example.com/x"}`, "https://example.com/x"},
		{"ExitPlanMode", `{"plan":"1. do it"}`, "1. do it"},
		{"Grep", `{"pattern":"acme"}`, `{"pattern":"acme"}`},
	}
	for _, c := range cases {
		got := cardFor(t, c.tool, c.input, nil)
		if got.Preview != c.want {
			t.Errorf("%s preview = %q, want %q", c.tool, got.Preview, c.want)
		}
	}
}

func TestCardKindsAndFields(t *testing.T) {
	p := cardFor(t, "Bash", `{"command":"ls"}`, func(m *Msg) {
		m.Description = "d"
		m.Reason = "r"
		m.BlockedPath = "C:/Users/u"
		m.CanAllowSession = true
	})
	if p.Kind != core.CardPermission || p.Description != "d" || p.Reason != "r" || p.BlockedPath != "C:/Users/u" ||
		!p.CanAllowSession || p.RequestID != "r" || !p.Since.Equal(time.Unix(100, 0)) {
		t.Fatalf("permission card = %+v", p)
	}
	if got := cardFor(t, "ExitPlanMode", `{"plan":"x"}`, nil); got.Kind != core.CardPlan || !got.IsPermission() {
		t.Fatalf("plan card = %+v", got)
	}
	q := cardFor(t, "AskUserQuestion",
		`{"questions":[{"question":"Which?","header":"H","options":[{"label":"A","description":"a"}],"multiSelect":true}]}`, nil)
	if q.Kind != core.CardQuestion || len(q.Questions) != 1 || !q.Questions[0].Multi ||
		q.Questions[0].Options[0].Label != "A" || q.Questions[0].Options[0].Description != "a" {
		t.Fatalf("question card = %+v", q)
	}
	env := cardFor(t, "Other", `{}`, func(m *Msg) {
		m.Questions = []QuestionData{{Text: "Q", Options: []OptionData{{Label: "x"}}}}
	})
	if env.Kind != core.CardQuestion || env.Questions[0].Text != "Q" {
		t.Fatalf("envelope questions = %+v", env)
	}
}

func TestCardPreviewCapsAndStripsANSI(t *testing.T) {
	long := strings.Repeat("é", 3000)
	in, _ := json.Marshal(map[string]string{"command": "\x1b[31m" + long})
	got := cardFor(t, "Bash", string(in), nil)
	if strings.Contains(got.Preview, "\x1b") {
		t.Fatal("ANSI kept")
	}
	if n := len([]rune(got.Preview)); n > 2001 {
		t.Fatalf("preview has %d runes", n)
	}
	big, _ := json.Marshal(map[string]string{"x": strings.Repeat("y", 1000)})
	if n := len([]rune(cardFor(t, "Grep", string(big), nil).Preview)); n > 301 {
		t.Fatalf("json preview has %d runes", n)
	}
	if got := cardFor(t, "Bash", ``, nil).Preview; got != "" {
		t.Fatalf("empty input preview = %q", got)
	}
}
