package control

import (
	"encoding/json"
	"strings"
	"time"

	"github.com/longpl-1902/claude-ui/internal/core"
)

const (
	previewMaxRunes  = 2000
	previewJSONRunes = 300
)

// CardFromMsg builds the UI card for a can_use_tool message.
func CardFromMsg(m Msg, now time.Time) core.Card {
	c := core.Card{
		RequestID:       m.RequestID,
		ToolName:        m.ToolName,
		DisplayName:     m.DisplayName,
		Description:     m.Description,
		Reason:          m.Reason,
		BlockedPath:     m.BlockedPath,
		CanAllowSession: m.CanAllowSession,
		Since:           now,
	}
	if c.DisplayName == "" {
		c.DisplayName = m.ToolName
	}

	var qs []QuestionData
	if len(m.Input) > 0 {
		var in struct {
			Questions []QuestionData `json:"questions"`
		}
		if json.Unmarshal(m.Input, &in) == nil {
			qs = in.Questions
		}
	}
	for _, q := range qs {
		cq := core.Question{Text: q.Text, Header: q.Header, Multi: q.Multi}
		for _, o := range q.Options {
			cq.Options = append(cq.Options, core.Option{Label: o.Label, Description: o.Description})
		}
		c.Questions = append(c.Questions, cq)
	}

	switch {
	case m.ToolName == "AskUserQuestion":
		c.Kind = core.CardQuestion
	case m.ToolName == "ExitPlanMode":
		c.Kind = core.CardPlan
	default:
		c.Kind = core.CardPermission
	}

	c.Preview = previewFor(m.ToolName, m.Input)
	return c
}

func previewFor(tool string, input json.RawMessage) string {
	if len(input) == 0 {
		return ""
	}
	var in map[string]any
	if err := json.Unmarshal(input, &in); err != nil {
		return capPreview(string(input), previewJSONRunes)
	}
	str := func(k string) string {
		s, _ := in[k].(string)
		return s
	}
	var s string
	switch tool {
	case "Bash":
		s = str("command")
	case "Edit", "Write", "Read", "NotebookEdit":
		s = str("file_path")
	case "WebFetch":
		s = str("url")
	case "ExitPlanMode":
		s = str("plan")
	}
	if s != "" {
		return capPreview(s, previewMaxRunes)
	}
	b, err := json.Marshal(in)
	if err != nil {
		return ""
	}
	return capPreview(string(b), previewJSONRunes)
}

func capPreview(s string, max int) string {
	s = strings.TrimSpace(stripANSI(s))
	return capString(s, max)
}
