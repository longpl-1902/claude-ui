package transcript

import (
	"os"
	"strings"
	"testing"
)

func TestShouldSkipRaw(t *testing.T) {
	tests := []struct {
		name string
		line string
		want bool
	}{
		{"empty", "", true},
		{"whitespace", "   \t  ", true},
		{"not json", "hello world", true},
		{"json object", `{"uuid":"a"}`, false},
		{"array", `[1,2,3]`, true},
	}
	for _, tt := range tests {
		t.Run(tt.name, func(t *testing.T) {
			if got := ShouldSkipRaw([]byte(tt.line)); got != tt.want {
				t.Errorf("ShouldSkipRaw(%q) = %v, want %v", tt.line, got, tt.want)
			}
		})
	}
}

func TestParseLine_Assistant(t *testing.T) {
	line := `{"uuid":"aaa","timestamp":"2026-11-18T10:00:02Z","type":"assistant","message":{"id":"msg_001","model":"claude-test-opus","content":[{"type":"text","text":"Hello world"},{"type":"thinking","thinking":"secret"}],"usage":{"input_tokens":100,"output_tokens":50,"cache_creation_input_tokens":10,"cache_read_input_tokens":5}}}`

	rec, ok := ParseLine([]byte(line))
	if !ok {
		t.Fatal("ParseLine failed")
	}
	if rec.T != RecAssistant {
		t.Errorf("type = %v, want RecAssistant", rec.T)
	}
	if rec.MessageID != "msg_001" {
		t.Errorf("messageID = %q", rec.MessageID)
	}
	if rec.Text != "Hello world" {
		t.Errorf("text = %q, want %q", rec.Text, "Hello world")
	}
	if rec.Model != "claude-test-opus" {
		t.Errorf("model = %q", rec.Model)
	}
	if rec.Usage == nil {
		t.Fatal("usage is nil")
	}
	if rec.Usage.Input != 100 || rec.Usage.Output != 50 {
		t.Errorf("usage = %+v", rec.Usage)
	}
	if rec.Usage.CacheCreation != 10 {
		t.Errorf("cacheCreation = %d", rec.Usage.CacheCreation)
	}
}

func TestParseLine_AssistantNoID(t *testing.T) {
	line := `{"uuid":"aaa","timestamp":"2026-11-18T10:00:02Z","type":"assistant","message":{"content":[{"type":"text","text":"Hello"}]}}`
	_, ok := ParseLine([]byte(line))
	if ok {
		t.Error("expected ParseLine to fail for assistant without message.id")
	}
}

func TestParseLine_AssistantSyntheticNoUsage(t *testing.T) {
	line := `{"uuid":"aaa","timestamp":"2026-11-18T10:00:02Z","type":"assistant","message":{"id":"msg_s","model":"test","content":[{"type":"text","text":"<synthetic> placeholder"}],"usage":{"input_tokens":100,"output_tokens":50}}}`

	rec, ok := ParseLine([]byte(line))
	if !ok {
		t.Fatal("ParseLine failed")
	}
	if rec.Usage != nil {
		t.Error("usage should be nil for <synthetic> lines")
	}
}

func TestParseLine_AssistantWithToolUse(t *testing.T) {
	line := `{"uuid":"aaa","timestamp":"2026-01-01T00:00:00Z","type":"assistant","message":{"id":"msg_t","model":"test","content":[{"type":"text","text":"Let me read that."},{"type":"tool_use","id":"tu_1","name":"Read","input":{"file_path":"/src/main.go"}}]}}`

	rec, ok := ParseLine([]byte(line))
	if !ok {
		t.Fatal("ParseLine failed")
	}
	if len(rec.Tools) != 1 {
		t.Fatalf("tools count = %d, want 1", len(rec.Tools))
	}
	tu := rec.Tools[0]
	if tu.UseID != "tu_1" {
		t.Errorf("UseID = %q", tu.UseID)
	}
	if tu.Name != "Read" {
		t.Errorf("Name = %q", tu.Name)
	}
	if tu.Target != "/src/main.go" {
		t.Errorf("Target = %q", tu.Target)
	}
	if tu.FilePath != "/src/main.go" {
		t.Errorf("FilePath = %q", tu.FilePath)
	}
}

func TestParseLine_ToolResult(t *testing.T) {
	line := `{"uuid":"aaa","timestamp":"2026-01-01T00:00:00Z","type":"tool_result","message":[{"tool_use_id":"tu_1","content":"file contents here","is_error":false}]}`

	rec, ok := ParseLine([]byte(line))
	if !ok {
		t.Fatal("ParseLine failed")
	}
	if rec.T != RecToolResults {
		t.Errorf("type = %v", rec.T)
	}
	if len(rec.Results) != 1 {
		t.Fatalf("results count = %d", len(rec.Results))
	}
	tr := rec.Results[0]
	if tr.UseID != "tu_1" {
		t.Errorf("UseID = %q", tr.UseID)
	}
	if tr.Text != "file contents here" {
		t.Errorf("Text = %q", tr.Text)
	}
	if tr.IsError {
		t.Error("unexpected error")
	}
	if !tr.Success {
		t.Error("expected success")
	}
}

func TestParseLine_ToolResultError(t *testing.T) {
	line := `{"uuid":"aaa","timestamp":"2026-01-01T00:00:00Z","type":"tool_result","message":[{"tool_use_id":"tu_1","content":"something failed","is_error":true,"toolUseResult":"Error: command failed"}]}`

	rec, ok := ParseLine([]byte(line))
	if !ok {
		t.Fatal("ParseLine failed")
	}
	tr := rec.Results[0]
	if !tr.IsError {
		t.Error("expected error")
	}
	if tr.Success {
		t.Error("expected no success")
	}
}

func TestParseLine_ToolResultWithPatch(t *testing.T) {
	line := `{"uuid":"aaa","timestamp":"2026-01-01T00:00:00Z","type":"tool_result","message":[{"tool_use_id":"tu_2","content":"edited","is_error":false,"structuredPatch":{"diff":[{"added":5,"removed":2}]}}]}`

	rec, ok := ParseLine([]byte(line))
	if !ok {
		t.Fatal("ParseLine failed")
	}
	tr := rec.Results[0]
	if tr.Added != 5 || tr.Removed != 2 {
		t.Errorf("patch counts: +%d -%d, want +5 -2", tr.Added, tr.Removed)
	}
}

func TestParseLine_Prompt(t *testing.T) {
	line := `{"uuid":"aaa","timestamp":"2026-01-01T00:00:00Z","type":"user","message":{"content":"Fix the bug","isMeta":false}}`

	rec, ok := ParseLine([]byte(line))
	if !ok {
		t.Fatal("ParseLine failed")
	}
	if rec.T != RecPrompt {
		t.Errorf("type = %v", rec.T)
	}
	if rec.PromptText != "Fix the bug" {
		t.Errorf("text = %q", rec.PromptText)
	}
	if rec.IsMeta {
		t.Error("unexpected meta")
	}
}

func TestParseLine_PromptMeta(t *testing.T) {
	line := `{"uuid":"aaa","timestamp":"2026-01-01T00:00:00Z","type":"user","message":{"content":"hello","isMeta":true}}`

	rec, ok := ParseLine([]byte(line))
	if !ok {
		t.Fatal("ParseLine failed")
	}
	if !rec.IsMeta {
		t.Error("expected meta")
	}
}

func TestParseLine_PromptSystemReminderOnly(t *testing.T) {
	line := `{"uuid":"aaa","timestamp":"2026-01-01T00:00:00Z","type":"user","message":{"content":"<system-reminder>some reminder text</system-reminder>","isMeta":false}}`

	rec, ok := ParseLine([]byte(line))
	if !ok {
		t.Fatal("ParseLine failed")
	}
	if !rec.IsMeta {
		t.Error("expected system-reminder-only to be treated as meta")
	}
}

func TestParseLine_PromptCommand(t *testing.T) {
	line := `{"uuid":"aaa","timestamp":"2026-01-01T00:00:00Z","type":"user","message":{"content":"/model claude-sonnet","isMeta":false}}`

	rec, ok := ParseLine([]byte(line))
	if !ok {
		t.Fatal("ParseLine failed")
	}
	if rec.Command != "/model" {
		t.Errorf("command = %q", rec.Command)
	}
	if rec.CommandArgs != "claude-sonnet" {
		t.Errorf("args = %q", rec.CommandArgs)
	}
}

func TestParseLine_System(t *testing.T) {
	tests := []struct {
		name    string
		line    string
		subtype string
		fatal   bool
	}{
		{
			"api_error",
			`{"uuid":"aaa","timestamp":"2026-01-01T00:00:00Z","type":"system","message":{"subtype":"api_error","error":"rate limited"}}`,
			"api_error", false,
		},
		{
			"api_error_fatal",
			`{"uuid":"aaa","timestamp":"2026-01-01T00:00:00Z","type":"system","message":{"subtype":"api_error","error":"rate limited","retryExhausted":true}}`,
			"api_error", true,
		},
		{
			"compact_boundary",
			`{"uuid":"aaa","timestamp":"2026-01-01T00:00:00Z","type":"system","message":{"subtype":"compact_boundary"}}`,
			"compact_boundary", false,
		},
		{
			"init",
			`{"uuid":"aaa","timestamp":"2026-01-01T00:00:00Z","type":"system","message":{"subtype":"init","cwd":"d:\\work\\demo"}}`,
			"init", false,
		},
	}
	for _, tt := range tests {
		t.Run(tt.name, func(t *testing.T) {
			rec, ok := ParseLine([]byte(tt.line))
			if !ok {
				t.Fatal("ParseLine failed")
			}
			if rec.T != RecSystem {
				t.Errorf("type = %v", rec.T)
			}
			if rec.SystemType != tt.subtype {
				t.Errorf("subtype = %q", rec.SystemType)
			}
			if rec.Fatal != tt.fatal {
				t.Errorf("fatal = %v", rec.Fatal)
			}
		})
	}
}

func TestParseLine_Title(t *testing.T) {
	tests := []struct {
		name  string
		line  string
		title string
		kind  string
	}{
		{
			"ai",
			`{"uuid":"aaa","timestamp":"2026-01-01T00:00:00Z","type":"title","message":{"title":"fix login","titleType":"ai-title"}}`,
			"fix login", "ai",
		},
		{
			"custom",
			`{"uuid":"aaa","timestamp":"2026-01-01T00:00:00Z","type":"title","message":{"title":"My Session","titleType":"custom-title"}}`,
			"My Session", "custom",
		},
	}
	for _, tt := range tests {
		t.Run(tt.name, func(t *testing.T) {
			rec, ok := ParseLine([]byte(tt.line))
			if !ok {
				t.Fatal("ParseLine failed")
			}
			if rec.TitleText != tt.title {
				t.Errorf("title = %q", rec.TitleText)
			}
			if rec.TitleKind != tt.kind {
				t.Errorf("kind = %q", rec.TitleKind)
			}
		})
	}
}

func TestParseLine_Interrupted(t *testing.T) {
	line := `{"uuid":"aaa","timestamp":"2026-01-01T00:00:00Z","type":"interrupted","message":{"text":"[Request interrupted by user]"}}`
	rec, ok := ParseLine([]byte(line))
	if !ok {
		t.Fatal("ParseLine failed")
	}
	if rec.T != RecInterrupted {
		t.Errorf("type = %v", rec.T)
	}
}

func TestParseLine_TextTruncation(t *testing.T) {
	longText := strings.Repeat("x", 15000)
	line := `{"uuid":"aaa","timestamp":"2026-01-01T00:00:00Z","type":"assistant","message":{"id":"msg_long","model":"test","content":[{"type":"text","text":"` + longText + `"}]}}`

	rec, ok := ParseLine([]byte(line))
	if !ok {
		t.Fatal("ParseLine failed")
	}
	if len(rec.Text) > capText+10 {
		t.Errorf("text length %d exceeds cap %d", len(rec.Text), capText)
	}
}

func TestParseLine_GarbageNeverPanics(t *testing.T) {
	data, err := os.ReadFile("testdata/garbage.jsonl")
	if err != nil {
		t.Fatal(err)
	}
	for _, line := range strings.Split(string(data), "\n") {
		// Must not panic
		ParseLine([]byte(line))
	}
}

func TestTargetFor(t *testing.T) {
	tests := []struct {
		name  string
		tool  string
		input string
		want  string
	}{
		{"bash", "Bash", `{"command":"ls -la\necho done"}`, "ls -la"},
		{"read", "Read", `{"file_path":"/src/main.go"}`, "/src/main.go"},
		{"edit", "Edit", `{"file_path":"/src/app.go","old_string":"a","new_string":"b"}`, "/src/app.go"},
		{"grep", "Grep", `{"pattern":"TODO","path":"/src"}`, "TODO"},
		{"glob", "Glob", `{"pattern":"**/*.go"}`, "**/*.go"},
		{"agent", "Agent", `{"name":"reviewer","prompt":"check"}`, "reviewer"},
		{"unknown_with_path", "Custom", `{"path":"/some/file"}`, "/some/file"},
		{"empty", "Nothing", `{}`, ""},
	}
	for _, tt := range tests {
		t.Run(tt.name, func(t *testing.T) {
			got := targetFor(tt.tool, []byte(tt.input))
			if got != tt.want {
				t.Errorf("targetFor(%q) = %q, want %q", tt.tool, got, tt.want)
			}
		})
	}
}

func TestInputPreview(t *testing.T) {
	tests := []struct {
		name  string
		tool  string
		input string
		want  string
	}{
		{"bash", "Bash", `{"command":"go test ./..."}`, "go test ./..."},
		{"read", "Read", `{"file_path":"/src/main.go"}`, "/src/main.go"},
		{"grep", "Grep", `{"pattern":"hello"}`, "hello"},
		{"unknown_compact", "Custom", `{"key":"val"}`, `{"key":"val"}`},
	}
	for _, tt := range tests {
		t.Run(tt.name, func(t *testing.T) {
			got := inputPreview(tt.tool, []byte(tt.input))
			if got != tt.want {
				t.Errorf("inputPreview(%q) = %q, want %q", tt.tool, got, tt.want)
			}
		})
	}
}

func TestTruncate(t *testing.T) {
	tests := []struct {
		input string
		max   int
		want  string
	}{
		{"hello", 10, "hello"},
		{"hello world", 8, "hello…"}, // 5 bytes + 3 byte ellipsis = 8
		{"", 5, ""},
		{"abc", 3, "abc"},
	}
	for _, tt := range tests {
		t.Run(tt.input, func(t *testing.T) {
			got := truncate(tt.input, tt.max)
			if got != tt.want {
				t.Errorf("truncate(%q, %d) = %q, want %q", tt.input, tt.max, got, tt.want)
			}
		})
	}
}

func TestTruncateMultibyte(t *testing.T) {
	input := "Xin chào thế giới! Đây là một chuỗi dài"
	result := truncate(input, 20)
	// Must not break mid-rune
	for i := 0; i < len(result); {
		_, size := rune(result[i]), 1
		if result[i] >= 0x80 {
			_, size = decodeRune([]byte(result[i:]))
		}
		i += size
	}
	if len(result) > 23 { // 20 + "…" (3 bytes)
		t.Errorf("truncated too long: %d bytes", len(result))
	}
}

func decodeRune(b []byte) (rune, int) {
	r, size := rune(b[0]), 1
	if b[0] < 0x80 {
		return r, size
	}
	// Just use the standard library
	return rune(b[0]), 1
}

func TestParseLeadBasic(t *testing.T) {
	data, err := os.ReadFile("testdata/lead_basic.jsonl")
	if err != nil {
		t.Fatal(err)
	}

	var records []Record
	for _, line := range strings.Split(string(data), "\n") {
		line = strings.TrimSpace(line)
		if line == "" {
			continue
		}
		rec, ok := ParseLine([]byte(line))
		if ok {
			records = append(records, rec)
		}
	}

	if len(records) < 8 {
		t.Fatalf("parsed %d records from lead_basic, expected at least 8", len(records))
	}

	// First record should be system/init
	if records[0].T != RecSystem || records[0].SystemType != "init" {
		t.Errorf("first record: type=%v subtype=%q", records[0].T, records[0].SystemType)
	}

	// Second should be prompt
	if records[1].T != RecPrompt || records[1].PromptText != "Fix the login redirect bug" {
		t.Errorf("second record: type=%v text=%q", records[1].T, records[1].PromptText)
	}

	// Third should be assistant with tool use
	if records[2].T != RecAssistant || len(records[2].Tools) != 1 {
		t.Errorf("third record: type=%v tools=%d", records[2].T, len(records[2].Tools))
	}

	// Last should be title
	last := records[len(records)-1]
	if last.T != RecTitle || last.TitleText != "fix login redirect" {
		t.Errorf("last record: type=%v title=%q", last.T, last.TitleText)
	}
}
