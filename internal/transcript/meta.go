package transcript

import (
	"bytes"
	"encoding/json"
	"regexp"
	"strings"
	"time"
	"unicode/utf8"
)

// MaxTitleRunes is the length a first-prompt fallback title is cut to.
const MaxTitleRunes = 60

// Title kinds, strongest first.
const (
	TitleCustom    = "custom"
	TitleAI        = "ai"
	TitleAgentName = "agent-name"
	TitleSummary   = "summary"
	TitlePrompt    = "prompt"
)

// Meta is what the session list needs from a transcript: where it ran, what
// it is called and when it last moved.
type Meta struct {
	Cwd         string
	Branch      string
	Entrypoint  string
	Title       string // best available: custom > ai > agent-name > summary > first prompt
	TitleKind   string
	FirstPrompt string // first real user prompt, as written (capped)
	HasPrompt   bool   // the transcript holds at least one real user prompt
	LastTs      time.Time
}

// metaLine is the union of the top-level fields ScanMeta cares about. In real
// transcripts cwd, gitBranch, entrypoint and isMeta sit at the top level of
// user/assistant lines; titles are their own record types without uuid.
type metaLine struct {
	Type        string          `json:"type"`
	Timestamp   string          `json:"timestamp"`
	Cwd         string          `json:"cwd"`
	GitBranch   string          `json:"gitBranch"`
	Entrypoint  string          `json:"entrypoint"`
	IsMeta      bool            `json:"isMeta"`
	IsSidechain bool            `json:"isSidechain"`
	IsCompact   bool            `json:"isCompactSummary"`
	AITitle     string          `json:"aiTitle"`
	CustomTitle string          `json:"customTitle"`
	AgentName   string          `json:"agentName"`
	Summary     string          `json:"summary"`
	Message     json.RawMessage `json:"message"`
}

// legacyMessage covers the older envelope shapes this package's own fixtures
// use: system/init records and "title" records carrying their data in message.
type legacyMessage struct {
	Subtype    string `json:"subtype"`
	Cwd        string `json:"cwd"`
	Entrypoint string `json:"entrypoint"`
	AgentName  string `json:"agentName"`
	Title      string `json:"title"`
	TitleType  string `json:"titleType"`
}

type userMessage struct {
	Content json.RawMessage `json:"content"`
}

type metaScan struct {
	m      Meta
	titles map[string]string
}

// ScanMeta reads the head and the tail of a transcript. Lines cut by either
// window fail to parse and are ignored (or, for user lines, still counted as
// a prompt); an oversized line costs nothing beyond its own bytes.
func ScanMeta(head, tail []byte) Meta {
	sc := &metaScan{titles: map[string]string{}}
	sc.scan(head)
	sc.scan(tail)

	m := sc.m
	for _, k := range []string{TitleCustom, TitleAI, TitleAgentName, TitleSummary} {
		if t := sc.titles[k]; t != "" {
			m.Title, m.TitleKind = t, k
			break
		}
	}
	if m.Title == "" && m.FirstPrompt != "" {
		m.Title, m.TitleKind = OneLine(m.FirstPrompt, MaxTitleRunes), TitlePrompt
	}
	return m
}

func (sc *metaScan) scan(data []byte) {
	for len(data) > 0 {
		var line []byte
		if i := bytes.IndexByte(data, '\n'); i >= 0 {
			line, data = data[:i], data[i+1:]
		} else {
			line, data = data, nil
		}
		line = bytes.TrimSpace(line) // also drops the CR of CRLF
		if len(line) == 0 || line[0] != '{' {
			continue
		}
		sc.line(line)
	}
}

func (sc *metaScan) line(line []byte) {
	var l metaLine
	if err := json.Unmarshal(line, &l); err != nil {
		sc.truncated(line)
		return
	}
	m := &sc.m
	if l.Timestamp != "" {
		if ts, err := time.Parse(time.RFC3339Nano, l.Timestamp); err == nil && ts.After(m.LastTs) {
			m.LastTs = ts
		}
	}
	if m.Cwd == "" && l.Cwd != "" {
		m.Cwd = l.Cwd
	}
	if m.Branch == "" && l.GitBranch != "" {
		m.Branch = l.GitBranch
	}
	if m.Entrypoint == "" && l.Entrypoint != "" {
		m.Entrypoint = l.Entrypoint
	}

	switch l.Type {
	case "ai-title":
		sc.setTitle(TitleAI, l.AITitle)
	case "custom-title":
		sc.setTitle(TitleCustom, l.CustomTitle)
	case "agent-name":
		sc.setTitle(TitleAgentName, l.AgentName)
	case "summary":
		sc.setTitle(TitleSummary, l.Summary)
	case "user":
		if l.IsMeta || l.IsSidechain || l.IsCompact {
			return
		}
		if text, ok := userPromptText(l.Message); ok {
			m.HasPrompt = true
			if m.FirstPrompt == "" {
				m.FirstPrompt = truncate(text, capSummary)
			}
		}
	case "system", "title":
		var lm legacyMessage
		if len(l.Message) == 0 || json.Unmarshal(l.Message, &lm) != nil {
			return
		}
		if m.Cwd == "" && lm.Cwd != "" {
			m.Cwd = lm.Cwd
		}
		if m.Entrypoint == "" && lm.Entrypoint != "" {
			m.Entrypoint = lm.Entrypoint
		}
		if l.Type == "system" {
			if lm.Subtype == "init" {
				sc.setTitle(TitleAgentName, lm.AgentName)
			}
			return
		}
		switch lm.TitleType {
		case "custom-title":
			sc.setTitle(TitleCustom, lm.Title)
		case "ai-title":
			sc.setTitle(TitleAI, lm.Title)
		case "agent-name":
			sc.setTitle(TitleAgentName, lm.Title)
		}
	}
}

func (sc *metaScan) setTitle(kind, v string) {
	if v = strings.TrimSpace(v); v != "" {
		sc.titles[kind] = v // later records win within a kind
	}
}

// truncated handles a line a window cut in the middle (a huge pasted prompt,
// a big snapshot): it cannot be parsed, but its prefix still tells whether it
// opens a real user prompt and where the session ran.
func (sc *metaScan) truncated(line []byte) {
	prefix := line
	if len(prefix) > 4096 {
		prefix = prefix[:4096]
	}
	if sc.m.Cwd == "" {
		sc.m.Cwd = rawString(prefix, `"cwd":"`)
	}
	if bytes.Contains(prefix, []byte(`"type":"user"`)) &&
		!bytes.Contains(prefix, []byte(`"isMeta":true`)) &&
		!bytes.Contains(prefix, []byte(`"isSidechain":true`)) &&
		!bytes.Contains(prefix, []byte(`tool_result`)) {
		sc.m.HasPrompt = true
	}
}

// rawString decodes the JSON string that follows key in b, if it is complete.
func rawString(b []byte, key string) string {
	i := bytes.Index(b, []byte(key))
	if i < 0 {
		return ""
	}
	b = b[i+len(key)-1:] // at the opening quote
	for j := 1; j < len(b); j++ {
		switch b[j] {
		case '\\':
			j++
		case '"':
			var s string
			if json.Unmarshal(b[:j+1], &s) == nil {
				return s
			}
			return ""
		}
	}
	return ""
}

var (
	reminderRe = regexp.MustCompile(`(?s)<system-reminder>.*?</system-reminder>`)
	cmdNameRe  = regexp.MustCompile(`(?s)<command-name>(.*?)</command-name>`)
	cmdMsgRe   = regexp.MustCompile(`(?s)<command-message>(.*?)</command-message>`)
	cmdArgsRe  = regexp.MustCompile(`(?s)<command-args>(.*?)</command-args>`)
	anyTagRe   = regexp.MustCompile(`<[^>]+>`)
)

// userPromptText returns the text a human typed in a user line, or false for
// tool results, system injections and interruptions.
func userPromptText(msg json.RawMessage) (string, bool) {
	if len(msg) == 0 {
		return "", false
	}
	var um userMessage
	if json.Unmarshal(msg, &um) != nil || len(um.Content) == 0 {
		return "", false
	}
	var text string
	if json.Unmarshal(um.Content, &text) != nil {
		var blocks []struct {
			Type string `json:"type"`
			Text string `json:"text"`
		}
		if json.Unmarshal(um.Content, &blocks) != nil {
			return "", false
		}
		var parts []string
		for _, b := range blocks {
			switch b.Type {
			case "tool_result":
				return "", false
			case "text":
				parts = append(parts, b.Text)
			}
		}
		text = strings.Join(parts, "\n")
	}
	text = strings.TrimSpace(reminderRe.ReplaceAllString(text, ""))
	switch {
	case text == "",
		strings.HasPrefix(text, "[Request interrupted"),
		strings.HasPrefix(text, "<task-notification>"),
		strings.HasPrefix(text, "<local-command-"):
		return "", false
	case strings.HasPrefix(text, "<command-name>"), strings.HasPrefix(text, "<command-message>"):
		return stripCommand(text), true
	}
	return text, true
}

func stripCommand(text string) string {
	tag := func(re *regexp.Regexp) string {
		if m := re.FindStringSubmatch(text); m != nil {
			return strings.TrimSpace(m[1])
		}
		return ""
	}
	name := tag(cmdNameRe)
	if name == "" {
		name = tag(cmdMsgRe)
	}
	args := tag(cmdArgsRe)
	if name == "" {
		return strings.TrimSpace(anyTagRe.ReplaceAllString(text, ""))
	}
	if !strings.HasPrefix(name, "/") {
		name = "/" + name
	}
	if args != "" {
		return name + " " + args
	}
	return name
}

// OneLine collapses all whitespace runs to single spaces and cuts the result
// to max runes, ending in an ellipsis when it was cut.
func OneLine(s string, max int) string {
	s = strings.Join(strings.Fields(s), " ")
	if utf8.RuneCountInString(s) <= max {
		return s
	}
	r := []rune(s)
	return strings.TrimSpace(string(r[:max-1])) + "…"
}
