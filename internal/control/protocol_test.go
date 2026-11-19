package control

import (
	"encoding/json"
	"strings"
	"testing"
)

func TestParseOutputLine_Init(t *testing.T) {
	line := `{"type":"system","subtype":"init","message":{"sessionId":"11111111-aaaa-4bbb-8ccc-000000000001","model":"claude-test-opus","claude_code_version":"1.0.0","tools":[{"name":"Bash"},{"name":"Read"}],"models":["opus","sonnet"]}}`
	msg, ok := ParseOutputLine([]byte(line))
	if !ok {
		t.Fatal("expected ok")
	}
	if msg.Kind != MsgInit {
		t.Fatalf("expected MsgInit, got %d", msg.Kind)
	}
	if msg.SessionID != "11111111-aaaa-4bbb-8ccc-000000000001" {
		t.Errorf("sessionID = %q", msg.SessionID)
	}
	if msg.Model != "claude-test-opus" {
		t.Errorf("model = %q", msg.Model)
	}
	if msg.Version != "1.0.0" {
		t.Errorf("version = %q", msg.Version)
	}
	if len(msg.Commands) != 2 || msg.Commands[0] != "Bash" {
		t.Errorf("commands = %v", msg.Commands)
	}
	if len(msg.Models) != 2 || msg.Models[0] != "opus" {
		t.Errorf("models = %v", msg.Models)
	}
}

func TestParseOutputLine_Status(t *testing.T) {
	line := `{"type":"status","status":"busy"}`
	msg, ok := ParseOutputLine([]byte(line))
	if !ok {
		t.Fatal("expected ok")
	}
	if msg.Kind != MsgStatus || msg.StatusText != "busy" {
		t.Errorf("kind=%d status=%q", msg.Kind, msg.StatusText)
	}
}

func TestParseOutputLine_StreamEvent(t *testing.T) {
	tests := []struct {
		name      string
		line      string
		wantOK    bool
		eventType string
		deltaType string
		deltaText string
	}{
		{
			name:      "text delta",
			line:      `{"type":"stream_event","event":{"type":"content_block_delta","delta":{"type":"text","text":"hello"}}}`,
			wantOK:    true,
			eventType: "content_block_delta",
			deltaType: "text",
			deltaText: "hello",
		},
		{
			name:   "signature delta is skipped",
			line:   `{"type":"stream_event","event":{"type":"content_block_delta","delta":{"type":"signature","text":"sig"}}}`,
			wantOK: false,
		},
		{
			name:      "message_stop",
			line:      `{"type":"stream_event","event":{"type":"message_stop"}}`,
			wantOK:    true,
			eventType: "message_stop",
		},
	}
	for _, tt := range tests {
		t.Run(tt.name, func(t *testing.T) {
			msg, ok := ParseOutputLine([]byte(tt.line))
			if ok != tt.wantOK {
				t.Fatalf("ok = %v, want %v", ok, tt.wantOK)
			}
			if !ok {
				return
			}
			if msg.EventType != tt.eventType {
				t.Errorf("eventType = %q, want %q", msg.EventType, tt.eventType)
			}
			if msg.DeltaType != tt.deltaType {
				t.Errorf("deltaType = %q, want %q", msg.DeltaType, tt.deltaType)
			}
			if msg.DeltaText != tt.deltaText {
				t.Errorf("deltaText = %q, want %q", msg.DeltaText, tt.deltaText)
			}
		})
	}
}

func TestParseOutputLine_Assistant(t *testing.T) {
	line := `{"type":"assistant","message":{"text":"hello world"}}`
	msg, ok := ParseOutputLine([]byte(line))
	if !ok {
		t.Fatal("expected ok")
	}
	if msg.Kind != MsgAssistant || msg.AssistantText != "hello world" {
		t.Errorf("kind=%d text=%q", msg.Kind, msg.AssistantText)
	}
}

func TestParseOutputLine_AssistantTextCapped(t *testing.T) {
	long := strings.Repeat("x", 5000)
	line := `{"type":"assistant","message":{"text":"` + long + `"}}`
	msg, ok := ParseOutputLine([]byte(line))
	if !ok {
		t.Fatal("expected ok")
	}
	if len([]rune(msg.AssistantText)) > 4001 { // 4000 + "…"
		t.Errorf("text not capped: len=%d", len([]rune(msg.AssistantText)))
	}
}

func TestParseOutputLine_UserEcho(t *testing.T) {
	line := `{"type":"user","is_echo":true,"message":"hi"}`
	msg, ok := ParseOutputLine([]byte(line))
	if !ok {
		t.Fatal("expected ok")
	}
	if msg.Kind != MsgUserEcho {
		t.Errorf("kind = %d", msg.Kind)
	}
}

func TestParseOutputLine_UserNonEcho(t *testing.T) {
	line := `{"type":"user","message":"hi"}`
	_, ok := ParseOutputLine([]byte(line))
	if ok {
		t.Fatal("non-echo user should not parse")
	}
}

func TestParseOutputLine_Result(t *testing.T) {
	line := `{"type":"result","cost_usd":0.05,"duration_ms":1234,"stop_reason":"end_turn","num_denials":1,"usage":{"input_tokens":100,"output_tokens":50,"cache_creation_input_tokens":10,"cache_read_input_tokens":5}}`
	msg, ok := ParseOutputLine([]byte(line))
	if !ok {
		t.Fatal("expected ok")
	}
	if msg.Kind != MsgResult {
		t.Fatalf("kind = %d", msg.Kind)
	}
	if msg.Cost != 0.05 {
		t.Errorf("cost = %v", msg.Cost)
	}
	if msg.Denials != 1 {
		t.Errorf("denials = %d", msg.Denials)
	}
	if msg.Usage == nil {
		t.Fatal("usage nil")
	}
	if msg.Usage.Input != 100 || msg.Usage.Output != 50 {
		t.Errorf("usage = %+v", msg.Usage)
	}
}

func TestParseOutputLine_CanUseTool(t *testing.T) {
	line := `{"type":"control_request","subtype":"can_use_tool","request_id":"req-1","tool":{"toolName":"Bash","displayName":"Bash","input":{"command":"ls"},"description":"Run a command","reason":"needed"},"can_allow_session":true}`
	msg, ok := ParseOutputLine([]byte(line))
	if !ok {
		t.Fatal("expected ok")
	}
	if msg.Kind != MsgCanUseTool {
		t.Fatalf("kind = %d", msg.Kind)
	}
	if msg.RequestID != "req-1" {
		t.Errorf("requestID = %q", msg.RequestID)
	}
	if msg.ToolName != "Bash" {
		t.Errorf("toolName = %q", msg.ToolName)
	}
	if msg.DisplayName != "Bash" {
		t.Errorf("displayName = %q", msg.DisplayName)
	}
	if !msg.CanAllowSession {
		t.Error("expected canAllowSession")
	}
}

func TestParseOutputLine_CanUseTool_ANSIStrip(t *testing.T) {
	line := `{"type":"control_request","subtype":"can_use_tool","request_id":"r","tool":{"toolName":"T","description":"\u001b[31mred\u001b[0m text","reason":"\u001b[1mbold\u001b[0m reason"}}`
	msg, ok := ParseOutputLine([]byte(line))
	if !ok {
		t.Fatal("expected ok")
	}
	if strings.Contains(msg.Description, "\x1b") {
		t.Errorf("description has ANSI: %q", msg.Description)
	}
	if strings.Contains(msg.Reason, "\x1b") {
		t.Errorf("reason has ANSI: %q", msg.Reason)
	}
}

func TestParseOutputLine_CanUseTool_DescCap(t *testing.T) {
	long := strings.Repeat("a", 600)
	line := `{"type":"control_request","subtype":"can_use_tool","request_id":"r","tool":{"toolName":"T","description":"` + long + `"}}`
	msg, ok := ParseOutputLine([]byte(line))
	if !ok {
		t.Fatal("expected ok")
	}
	if len([]rune(msg.Description)) > 501 {
		t.Errorf("description not capped: len=%d", len([]rune(msg.Description)))
	}
}

func TestParseOutputLine_CanUseTool_DisplayNameFallback(t *testing.T) {
	line := `{"type":"control_request","subtype":"can_use_tool","request_id":"r","tool":{"toolName":"MyTool"}}`
	msg, ok := ParseOutputLine([]byte(line))
	if !ok {
		t.Fatal("expected ok")
	}
	if msg.DisplayName != "MyTool" {
		t.Errorf("displayName = %q, want MyTool", msg.DisplayName)
	}
}

func TestParseOutputLine_CanUseTool_Questions(t *testing.T) {
	line := `{"type":"control_request","subtype":"can_use_tool","request_id":"r","tool":{"toolName":"AskUserQuestion","input":{}},"questions":[{"question":"Pick one","header":"Choice","options":[{"label":"A","description":"Option A"}],"multiSelect":false}]}`
	msg, ok := ParseOutputLine([]byte(line))
	if !ok {
		t.Fatal("expected ok")
	}
	if len(msg.Questions) != 1 {
		t.Fatalf("questions len = %d", len(msg.Questions))
	}
	if msg.Questions[0].Text != "Pick one" {
		t.Errorf("question text = %q", msg.Questions[0].Text)
	}
}

func TestParseOutputLine_ControlResponse(t *testing.T) {
	line := `{"type":"control_response","request_id":"ac-1","body":{"result":"ok"}}`
	msg, ok := ParseOutputLine([]byte(line))
	if !ok {
		t.Fatal("expected ok")
	}
	if msg.Kind != MsgControlResponse {
		t.Fatalf("kind = %d", msg.Kind)
	}
	if msg.CorrelationID != "ac-1" {
		t.Errorf("correlationID = %q", msg.CorrelationID)
	}
}

func TestParseOutputLine_CommandsChanged(t *testing.T) {
	line := `{"type":"commands_changed"}`
	msg, ok := ParseOutputLine([]byte(line))
	if !ok {
		t.Fatal("expected ok")
	}
	if msg.Kind != MsgCommandsChanged {
		t.Errorf("kind = %d", msg.Kind)
	}
}

func TestParseOutputLine_Garbage(t *testing.T) {
	cases := []string{
		"",
		"not json",
		`{"type":"unknown_thing"}`,
		`{"no":"type field"}`,
		`{"type":"system","subtype":"not_init"}`,
		`null`,
	}
	for _, c := range cases {
		_, ok := ParseOutputLine([]byte(c))
		if ok {
			t.Errorf("expected !ok for %q", c)
		}
	}
}

func TestStripANSI(t *testing.T) {
	tests := []struct {
		in, want string
	}{
		{"\x1b[31mred\x1b[0m", "red"},
		{"\x1b[1;32mbold green\x1b[0m", "bold green"},
		{"no ansi here", "no ansi here"},
		{"", ""},
	}
	for _, tt := range tests {
		got := stripANSI(tt.in)
		if got != tt.want {
			t.Errorf("stripANSI(%q) = %q, want %q", tt.in, got, tt.want)
		}
	}
}

func TestEncodeUserTurn(t *testing.T) {
	b := EncodeUserTurn("hello")
	var m map[string]any
	if err := json.Unmarshal(b, &m); err != nil {
		t.Fatalf("invalid JSON: %v", err)
	}
	if m["type"] != "user" {
		t.Errorf("type = %v", m["type"])
	}
	if m["message"] != "hello" {
		t.Errorf("message = %v", m["message"])
	}
}

func TestEncodeAllow(t *testing.T) {
	input := json.RawMessage(`{"command":"ls"}`)
	b := EncodeAllow("req-1", input, nil)
	var m map[string]any
	if err := json.Unmarshal(b, &m); err != nil {
		t.Fatalf("invalid JSON: %v", err)
	}
	if m["request_id"] != "req-1" {
		t.Errorf("request_id = %v", m["request_id"])
	}
	body := m["body"].(map[string]any)
	if body["behavior"] != "allow" {
		t.Errorf("behavior = %v", body["behavior"])
	}
}

func TestEncodeAllow_WithSessionRules(t *testing.T) {
	input := json.RawMessage(`{"command":"ls"}`)
	rules := json.RawMessage(`[{"type":"addRules","destination":"session"}]`)
	b := EncodeAllow("req-1", input, rules)
	var m map[string]any
	if err := json.Unmarshal(b, &m); err != nil {
		t.Fatalf("invalid JSON: %v", err)
	}
	body := m["body"].(map[string]any)
	if body["updatedPermissions"] == nil {
		t.Error("expected updatedPermissions")
	}
}

func TestEncodeDeny(t *testing.T) {
	b := EncodeDeny("req-1", "not allowed")
	var m map[string]any
	if err := json.Unmarshal(b, &m); err != nil {
		t.Fatalf("invalid JSON: %v", err)
	}
	body := m["body"].(map[string]any)
	if body["behavior"] != "deny" {
		t.Errorf("behavior = %v", body["behavior"])
	}
	if body["message"] != "not allowed" {
		t.Errorf("message = %v", body["message"])
	}
}

func TestEncodeUnsupported(t *testing.T) {
	b := EncodeUnsupported("req-1")
	var m map[string]any
	if err := json.Unmarshal(b, &m); err != nil {
		t.Fatalf("invalid JSON: %v", err)
	}
	body := m["body"].(map[string]any)
	if body["behavior"] != "unsupported" {
		t.Errorf("behavior = %v", body["behavior"])
	}
}

func TestEncodeRequest(t *testing.T) {
	b := EncodeRequest("ac-1", ReqSetModel, map[string]any{"model": "opus"})
	var m map[string]any
	if err := json.Unmarshal(b, &m); err != nil {
		t.Fatalf("invalid JSON: %v", err)
	}
	if m["type"] != "control_request" {
		t.Errorf("type = %v", m["type"])
	}
	if m["request_id"] != "ac-1" {
		t.Errorf("request_id = %v", m["request_id"])
	}
}

func TestEncodeAllowWithAnswers(t *testing.T) {
	input := json.RawMessage(`{"question":"Pick"}`)
	answers := map[string]string{"Pick": "A"}
	b := EncodeAllowWithAnswers("req-1", input, answers)
	var m map[string]any
	if err := json.Unmarshal(b, &m); err != nil {
		t.Fatalf("invalid JSON: %v", err)
	}
	body := m["body"].(map[string]any)
	if body["behavior"] != "allow" {
		t.Errorf("behavior = %v", body["behavior"])
	}
}

func TestSessionScopedSuggestions(t *testing.T) {
	raw := json.RawMessage(`[{"type":"addRules","destination":"global"},{"type":"deleteFile","destination":"session"},{"type":"setMode","destination":"global"}]`)
	result := SessionScopedSuggestions(raw)
	var out []map[string]any
	if err := json.Unmarshal(result, &out); err != nil {
		t.Fatalf("invalid JSON: %v", err)
	}
	if len(out) != 2 {
		t.Fatalf("expected 2, got %d", len(out))
	}
	for _, s := range out {
		if s["destination"] != "session" {
			t.Errorf("destination = %v, want session", s["destination"])
		}
	}
}

func TestSessionScopedSuggestions_Nil(t *testing.T) {
	if result := SessionScopedSuggestions(nil); result != nil {
		t.Errorf("expected nil, got %s", result)
	}
}

func TestSessionScopedSuggestions_Empty(t *testing.T) {
	raw := json.RawMessage(`[{"type":"deleteFile"}]`)
	if result := SessionScopedSuggestions(raw); result != nil {
		t.Errorf("expected nil for no allowed types, got %s", result)
	}
}
