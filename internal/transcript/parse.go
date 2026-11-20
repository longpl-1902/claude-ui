package transcript

import (
	"bytes"
	"encoding/json"
	"strings"
	"time"
	"unicode/utf8"
)

const (
	capText        = 12000
	capPrompt      = 8000
	capAgentResult = 4000
	capSummary     = 200
	capTarget      = 160
	capBashLine    = 120
	capInput       = 2000
	capResultText  = 8192
)

func ShouldSkipRaw(line []byte) bool {
	line = bytes.TrimSpace(line)
	if len(line) == 0 {
		return true
	}
	if line[0] != '{' {
		return true
	}
	return false
}

func ParseLine(line []byte) (rec Record, ok bool) {
	defer func() {
		if r := recover(); r != nil {
			ok = false
		}
	}()

	line = bytes.TrimSpace(line)
	if len(line) == 0 || line[0] != '{' {
		return Record{}, false
	}

	var env envelope
	if err := json.Unmarshal(line, &env); err != nil {
		return Record{}, false
	}
	if env.UUID == "" {
		return Record{}, false
	}
	ts, err := time.Parse(time.RFC3339Nano, env.Timestamp)
	if err != nil {
		ts, err = time.Parse(time.RFC3339, env.Timestamp)
		if err != nil {
			return Record{}, false
		}
	}

	rec.UUID = env.UUID
	rec.Timestamp = ts

	switch env.Type {
	case "assistant":
		return parseAssistant(rec, env.Message)
	case "tool_use":
		return parseToolUse(rec, env.Message)
	case "tool_result":
		return parseToolResult(rec, env.Message)
	case "user":
		return parsePrompt(rec, env.Message)
	case "system":
		return parseSystem(rec, env.Message)
	case "title":
		return parseTitle(rec, env.Message)
	case "interrupted":
		rec.T = RecInterrupted
		if env.Message != nil {
			var m struct {
				Text string `json:"text"`
			}
			_ = json.Unmarshal(env.Message, &m)
			rec.Text = truncate(m.Text, capText)
		}
		return rec, true
	default:
		return Record{}, false
	}
}

type envelope struct {
	UUID      string          `json:"uuid"`
	Timestamp string          `json:"timestamp"`
	Type      string          `json:"type"`
	Message   json.RawMessage `json:"message"`
}

func parseAssistant(rec Record, msg json.RawMessage) (Record, bool) {
	rec.T = RecAssistant
	if msg == nil {
		return Record{}, false
	}

	var m assistantMsg
	if err := json.Unmarshal(msg, &m); err != nil {
		return Record{}, false
	}
	if m.ID == "" {
		return Record{}, false
	}
	rec.MessageID = m.ID
	rec.Model = m.Model

	var textParts []string
	for _, c := range m.Content {
		switch c.Type {
		case "text":
			textParts = append(textParts, c.Text)
		case "thinking":
			// never kept
		case "tool_use":
			// handled separately
		}
	}
	rec.Text = truncate(strings.Join(textParts, ""), capText)

	isSynthetic := strings.Contains(rec.Text, "<synthetic>")
	isAPIError := false
	if m.StopReason == "api_error" {
		isAPIError = true
	}

	if !isSynthetic && !isAPIError && m.Usage != nil {
		rec.Usage = &TokenUsage{
			Input:         m.Usage.InputTokens,
			Output:        m.Usage.OutputTokens,
			CacheCreation: m.Usage.CacheCreationInputTokens,
			CacheRead:     m.Usage.CacheReadInputTokens,
		}
	}

	// Extract tool_use from content
	for _, c := range m.Content {
		if c.Type == "tool_use" && c.ID != "" {
			tu := ToolUse{
				UseID: c.ID,
				Name:  c.Name,
			}
			tu.Target = targetFor(c.Name, c.Input)
			tu.FilePath = filePathFrom(c.Name, c.Input)
			tu.InputPreview = inputPreview(c.Name, c.Input)
			rec.Tools = append(rec.Tools, tu)
		}
	}

	return rec, true
}

type assistantMsg struct {
	ID         string         `json:"id"`
	Model      string         `json:"model"`
	Content    []contentBlock `json:"content"`
	Usage      *usageBlock    `json:"usage"`
	StopReason string         `json:"stop_reason"`
}

type contentBlock struct {
	Type  string          `json:"type"`
	Text  string          `json:"text"`
	ID    string          `json:"id"`
	Name  string          `json:"name"`
	Input json.RawMessage `json:"input"`
}

type usageBlock struct {
	InputTokens              int64 `json:"input_tokens"`
	OutputTokens             int64 `json:"output_tokens"`
	CacheCreationInputTokens int64 `json:"cache_creation_input_tokens"`
	CacheReadInputTokens     int64 `json:"cache_read_input_tokens"`
}

func parseToolUse(rec Record, msg json.RawMessage) (Record, bool) {
	rec.T = RecAssistant
	if msg == nil {
		return Record{}, false
	}

	var items []json.RawMessage
	if err := json.Unmarshal(msg, &items); err != nil {
		var single struct {
			ID    string          `json:"id"`
			Name  string          `json:"name"`
			Input json.RawMessage `json:"input"`
		}
		if err := json.Unmarshal(msg, &single); err != nil {
			return Record{}, false
		}
		if single.ID == "" {
			return Record{}, false
		}
		tu := ToolUse{
			UseID: single.ID,
			Name:  single.Name,
		}
		tu.Target = targetFor(single.Name, single.Input)
		tu.FilePath = filePathFrom(single.Name, single.Input)
		tu.InputPreview = inputPreview(single.Name, single.Input)
		rec.Tools = append(rec.Tools, tu)
		return rec, true
	}

	for _, raw := range items {
		var item struct {
			ID    string          `json:"id"`
			Name  string          `json:"name"`
			Input json.RawMessage `json:"input"`
		}
		if err := json.Unmarshal(raw, &item); err != nil || item.ID == "" {
			continue
		}
		tu := ToolUse{
			UseID: item.ID,
			Name:  item.Name,
		}
		tu.Target = targetFor(item.Name, item.Input)
		tu.FilePath = filePathFrom(item.Name, item.Input)
		tu.InputPreview = inputPreview(item.Name, item.Input)
		rec.Tools = append(rec.Tools, tu)
	}
	if len(rec.Tools) == 0 {
		return Record{}, false
	}
	return rec, true
}

func parseToolResult(rec Record, msg json.RawMessage) (Record, bool) {
	rec.T = RecToolResults
	if msg == nil {
		return Record{}, false
	}

	var items []json.RawMessage
	if err := json.Unmarshal(msg, &items); err != nil {
		var single toolResultRaw
		if err := json.Unmarshal(msg, &single); err != nil {
			return Record{}, false
		}
		rec.Results = append(rec.Results, convertToolResult(single))
		return rec, true
	}

	for _, raw := range items {
		var item toolResultRaw
		if err := json.Unmarshal(raw, &item); err != nil {
			continue
		}
		rec.Results = append(rec.Results, convertToolResult(item))
	}
	return rec, true
}

type toolResultRaw struct {
	ToolUseID       string          `json:"tool_use_id"`
	Content         json.RawMessage `json:"content"`
	IsError         bool            `json:"is_error"`
	ToolUseResult   string          `json:"toolUseResult"`
	ToolDenialKind  string          `json:"toolDenialKind"`
	Interrupted     bool            `json:"interrupted"`
	StructuredPatch json.RawMessage `json:"structuredPatch"`
	AgentID         string          `json:"agentId"`
}

func convertToolResult(raw toolResultRaw) ToolResult {
	tr := ToolResult{
		UseID:       raw.ToolUseID,
		IsError:     raw.IsError,
		Interrupted: raw.Interrupted,
		AgentID:     raw.AgentID,
	}

	if raw.ToolDenialKind != "" {
		tr.Denied = true
		tr.DenialKind = raw.ToolDenialKind
	}
	if strings.HasPrefix(raw.ToolUseResult, "Error") || raw.ToolUseResult == "rejected" {
		tr.IsError = true
	}

	// Extract text from content
	tr.Text = extractResultText(raw.Content)
	tr.Text = truncateBytes(tr.Text, capResultText)

	// Count added/removed from structuredPatch
	if raw.StructuredPatch != nil {
		tr.Added, tr.Removed = countPatchChanges(raw.StructuredPatch)
	}

	if !tr.IsError && !tr.Interrupted && !tr.Denied {
		tr.Success = true
	}

	return tr
}

func extractResultText(content json.RawMessage) string {
	if content == nil {
		return ""
	}

	var s string
	if err := json.Unmarshal(content, &s); err == nil {
		return s
	}

	var blocks []struct {
		Type string `json:"type"`
		Text string `json:"text"`
	}
	if err := json.Unmarshal(content, &blocks); err == nil {
		var parts []string
		for _, b := range blocks {
			if b.Type == "text" && b.Text != "" {
				parts = append(parts, b.Text)
			}
		}
		return strings.Join(parts, "\n")
	}

	return ""
}

func countPatchChanges(patch json.RawMessage) (added, removed int) {
	var p struct {
		Diff []struct {
			Added   int `json:"added"`
			Removed int `json:"removed"`
		} `json:"diff"`
	}
	if err := json.Unmarshal(patch, &p); err != nil {
		return 0, 0
	}
	for _, d := range p.Diff {
		added += d.Added
		removed += d.Removed
	}
	return
}

func parsePrompt(rec Record, msg json.RawMessage) (Record, bool) {
	rec.T = RecPrompt
	if msg == nil {
		return Record{}, false
	}

	var m promptMsg
	if err := json.Unmarshal(msg, &m); err != nil {
		return Record{}, false
	}

	// Check for meta/system-reminder-only
	if m.IsMeta {
		rec.IsMeta = true
		return rec, true
	}

	// Extract text from content
	var text string
	var hasNonReminder bool
	if err := json.Unmarshal(m.Content, (*string)(&text)); err == nil {
		if isSystemReminderOnly(text) {
			rec.IsMeta = true
			return rec, true
		}
		hasNonReminder = true
		rec.PromptText = truncate(text, capPrompt)
	} else {
		var blocks []promptContent
		if err := json.Unmarshal(m.Content, &blocks); err == nil {
			var parts []string
			for _, b := range blocks {
				if b.Type == "text" {
					if !isSystemReminderOnly(b.Text) {
						hasNonReminder = true
						parts = append(parts, b.Text)
					}
				}
			}
			if !hasNonReminder {
				rec.IsMeta = true
				return rec, true
			}
			rec.PromptText = truncate(strings.Join(parts, "\n"), capPrompt)
		}
	}

	// Extract command tags
	if strings.HasPrefix(rec.PromptText, "/") {
		parts := strings.SplitN(rec.PromptText, " ", 2)
		rec.Command = parts[0]
		if len(parts) > 1 {
			rec.CommandArgs = parts[1]
		}
	}

	// Check for compact summary
	if m.Type == "compact_summary" {
		rec.IsCompact = true
	}

	// Check for task notification
	if m.Type == "task-notification" {
		rec.AgentTask = rec.PromptText
	}

	return rec, true
}

type promptMsg struct {
	Content json.RawMessage `json:"content"`
	IsMeta  bool            `json:"isMeta"`
	Type    string          `json:"type"`
}

type promptContent struct {
	Type string `json:"type"`
	Text string `json:"text"`
}

func isSystemReminderOnly(text string) bool {
	trimmed := strings.TrimSpace(text)
	return strings.HasPrefix(trimmed, "<system-reminder>") && strings.HasSuffix(trimmed, "</system-reminder>")
}

func parseSystem(rec Record, msg json.RawMessage) (Record, bool) {
	rec.T = RecSystem
	if msg == nil {
		return rec, true
	}

	var m systemMsg
	if err := json.Unmarshal(msg, &m); err != nil {
		return rec, true
	}

	rec.SystemType = m.Subtype

	switch m.Subtype {
	case "api_error":
		rec.ErrorText = truncate(m.Error, capText)
		if m.RetryExhausted {
			rec.Fatal = true
		}
	case "compact_boundary":
		// marker only
	case "informational":
		rec.Text = truncate(m.Text, capText)
	case "local_command":
		rec.Text = truncate(m.Text, capText)
	case "init":
		// Extract agent-name as title
		if m.AgentName != "" {
			rec.TitleText = m.AgentName
			rec.TitleKind = "agent-name"
		}
		if m.Cwd != "" {
			rec.Text = m.Cwd
		}
	}

	return rec, true
}

type systemMsg struct {
	Subtype        string `json:"subtype"`
	Error          string `json:"error"`
	Text           string `json:"text"`
	RetryExhausted bool   `json:"retryExhausted"`
	AgentName      string `json:"agentName"`
	Cwd            string `json:"cwd"`
	Version        string `json:"claude_code_version"`
	Entrypoint     string `json:"entrypoint"`
}

func parseTitle(rec Record, msg json.RawMessage) (Record, bool) {
	rec.T = RecTitle
	if msg == nil {
		return Record{}, false
	}

	var m struct {
		Title     string `json:"title"`
		TitleType string `json:"titleType"`
	}
	if err := json.Unmarshal(msg, &m); err != nil || m.Title == "" {
		return Record{}, false
	}

	rec.TitleText = m.Title
	switch m.TitleType {
	case "custom-title":
		rec.TitleKind = "custom"
	case "ai-title":
		rec.TitleKind = "ai"
	case "agent-name":
		rec.TitleKind = "agent-name"
	default:
		rec.TitleKind = m.TitleType
	}

	return rec, true
}

func targetFor(name string, input json.RawMessage) string {
	if input == nil {
		return ""
	}
	var fields map[string]json.RawMessage
	if err := json.Unmarshal(input, &fields); err != nil {
		return ""
	}

	extract := func(key string, cap int) string {
		raw, ok := fields[key]
		if !ok {
			return ""
		}
		var s string
		if err := json.Unmarshal(raw, &s); err != nil {
			return ""
		}
		return truncate(s, cap)
	}

	switch name {
	case "Edit", "Read", "Write", "MultiEdit":
		return extract("file_path", capTarget)
	case "Bash":
		cmd := extract("command", capBashLine)
		if i := strings.IndexAny(cmd, "\n\r"); i >= 0 {
			cmd = cmd[:i]
		}
		return truncate(cmd, capBashLine)
	case "Grep":
		return extract("pattern", capTarget)
	case "Glob":
		return extract("pattern", capTarget)
	case "WebFetch":
		return extract("url", capTarget)
	case "WebSearch":
		return extract("query", capTarget)
	case "Agent":
		return extract("name", capTarget)
	case "Task", "TaskCreate":
		return extract("description", capTarget)
	case "TodoWrite", "TodoRead":
		return extract("task_id", capTarget)
	default:
		if fp := extract("file_path", capTarget); fp != "" {
			return fp
		}
		if p := extract("path", capTarget); p != "" {
			return p
		}
		if u := extract("url", capTarget); u != "" {
			return u
		}
		return ""
	}
}

func filePathFrom(name string, input json.RawMessage) string {
	if input == nil {
		return ""
	}
	var fields struct {
		FilePath string `json:"file_path"`
		Path     string `json:"path"`
	}
	_ = json.Unmarshal(input, &fields)
	if fields.FilePath != "" {
		return fields.FilePath
	}
	return fields.Path
}

func inputPreview(name string, input json.RawMessage) string {
	if input == nil {
		return ""
	}

	var fields map[string]json.RawMessage
	if err := json.Unmarshal(input, &fields); err != nil {
		return truncateBytes(string(input), capInput)
	}

	extract := func(key string) string {
		raw, ok := fields[key]
		if !ok {
			return ""
		}
		var s string
		if err := json.Unmarshal(raw, &s); err != nil {
			return ""
		}
		return s
	}

	switch name {
	case "Bash":
		if cmd := extract("command"); cmd != "" {
			return truncate(firstLine(cmd), capInput)
		}
	case "Edit":
		if fp := extract("file_path"); fp != "" {
			return truncate(fp, capInput)
		}
	case "Read":
		if fp := extract("file_path"); fp != "" {
			return truncate(fp, capInput)
		}
	case "Write":
		if fp := extract("file_path"); fp != "" {
			return truncate(fp, capInput)
		}
	case "Grep":
		if p := extract("pattern"); p != "" {
			return truncate(p, capInput)
		}
	case "Glob":
		if p := extract("pattern"); p != "" {
			return truncate(p, capInput)
		}
	case "WebFetch":
		if u := extract("url"); u != "" {
			return truncate(u, capInput)
		}
	case "WebSearch":
		if q := extract("query"); q != "" {
			return truncate(q, capInput)
		}
	case "Agent":
		if n := extract("name"); n != "" {
			return truncate(n, capInput)
		}
	}

	// Fallback: compact JSON
	compact, err := compactJSON(input)
	if err != nil {
		return truncateBytes(string(input), capInput)
	}
	return truncate(string(compact), capInput)
}

func compactJSON(data json.RawMessage) ([]byte, error) {
	var buf bytes.Buffer
	if err := json.Compact(&buf, data); err != nil {
		return nil, err
	}
	return buf.Bytes(), nil
}

func firstLine(s string) string {
	if i := strings.IndexAny(s, "\n\r"); i >= 0 {
		return s[:i]
	}
	return s
}

func truncate(s string, max int) string {
	if len(s) <= max {
		return s
	}
	ellipsis := "…" // 3 bytes UTF-8
	cut := max - len(ellipsis)
	if cut <= 0 {
		return ellipsis[:max]
	}
	// Find the last rune boundary at or before cut
	for cut > 0 && !utf8.RuneStart(s[cut]) {
		cut--
	}
	return s[:cut] + ellipsis
}

func truncateBytes(s string, max int) string {
	if len(s) <= max {
		return s
	}
	cut := max - 3
	if cut < 0 {
		cut = 0
	}
	for cut > 0 && !utf8.RuneStart(s[cut]) {
		cut--
	}
	return s[:cut] + "…"
}
