package control

// Anti-drift: every frame below is copied from the electron-final protocol
// tests (tests/main/control/protocol.test.ts, protocolV2.test.ts), which were
// verified against the real claude CLI. If a change here is needed, it must
// come from a newly captured real frame, never from the Go code.

import (
	"encoding/json"
	"reflect"
	"strings"
	"testing"
)

func mustJSON(t *testing.T, b []byte) any {
	t.Helper()
	if len(b) == 0 || b[len(b)-1] != '\n' || strings.Contains(string(b[:len(b)-1]), "\n") {
		t.Fatalf("frame must be one line ending in LF: %q", b)
	}
	var v any
	if err := json.Unmarshal(b, &v); err != nil {
		t.Fatalf("invalid json %q: %v", b, err)
	}
	return v
}

func assertFrame(t *testing.T, got []byte, want string) {
	t.Helper()
	var w any
	if err := json.Unmarshal([]byte(want), &w); err != nil {
		t.Fatalf("bad golden %s: %v", want, err)
	}
	g := mustJSON(t, got)
	if !reflect.DeepEqual(g, w) {
		t.Fatalf("frame drift\n got: %s\nwant: %s", strings.TrimSpace(string(got)), want)
	}
}

func TestGoldenEncoders(t *testing.T) {
	assertFrame(t, EncodeUserTurn("hello\nworld \"q\""),
		`{"type":"user","message":{"role":"user","content":"hello\nworld \"q\""},"parent_tool_use_id":null,"session_id":""}`)

	assertFrame(t, EncodeAllow("req_1", json.RawMessage(`{"command":"ls"}`), nil),
		`{"type":"control_response","response":{"subtype":"success","request_id":"req_1","response":{"behavior":"allow","updatedInput":{"command":"ls"}}}}`)

	rules := json.RawMessage(`[{"type":"addRules","destination":"session"}]`)
	assertFrame(t, EncodeAllow("req_1", json.RawMessage(`{}`), rules),
		`{"type":"control_response","response":{"subtype":"success","request_id":"req_1","response":{"behavior":"allow","updatedInput":{},"updatedPermissions":[{"type":"addRules","destination":"session"}]}}}`)

	assertFrame(t, EncodeDeny("req_2", "Denied in Agent Console"),
		`{"type":"control_response","response":{"subtype":"success","request_id":"req_2","response":{"behavior":"deny","message":"Denied in Agent Console"}}}`)

	assertFrame(t, EncodeUnsupported("req_3", "hook_callback"),
		`{"type":"control_response","response":{"subtype":"error","request_id":"req_3","error":"unsupported: hook_callback"}}`)

	assertFrame(t, EncodeAllowWithAnswers("r9", json.RawMessage(`{"questions":[{"question":"Q?"}]}`), map[string]string{"Q?": "A, B"}),
		`{"type":"control_response","response":{"subtype":"success","request_id":"r9","response":{"behavior":"allow","updatedInput":{"questions":[{"question":"Q?"}],"answers":{"Q?":"A, B"}}}}}`)

	assertFrame(t, EncodeRequest("req_1", ReqInitialize, nil),
		`{"type":"control_request","request_id":"req_1","request":{"subtype":"initialize"}}`)
	assertFrame(t, EncodeRequest("r1", ReqInterrupt, nil),
		`{"type":"control_request","request_id":"r1","request":{"subtype":"interrupt"}}`)
	assertFrame(t, EncodeRequest("r2", ReqSetModel, map[string]any{"model": "opus"}),
		`{"type":"control_request","request_id":"r2","request":{"subtype":"set_model","model":"opus"}}`)
	assertFrame(t, EncodeRequest("r3", ReqSetModel, map[string]any{"model": nil}),
		`{"type":"control_request","request_id":"r3","request":{"subtype":"set_model","model":null}}`)
	assertFrame(t, EncodeRequest("r4", ReqSetPermissionMode, map[string]any{"mode": "plan"}),
		`{"type":"control_request","request_id":"r4","request":{"subtype":"set_permission_mode","mode":"plan"}}`)
	assertFrame(t, EncodeRequest("req_1", ReqMcpStatus, nil),
		`{"type":"control_request","request_id":"req_1","request":{"subtype":"mcp_status"}}`)
	assertFrame(t, EncodeRequest("req_1", ReqGetContextUsage, nil),
		`{"type":"control_request","request_id":"req_1","request":{"subtype":"get_context_usage"}}`)
	assertFrame(t, EncodeRequest("req_1", ReqRewindFiles, map[string]any{"user_message_id": "u1", "dry_run": true}),
		`{"type":"control_request","request_id":"req_1","request":{"subtype":"rewind_files","user_message_id":"u1","dry_run":true}}`)
	assertFrame(t, EncodeRequest("req_1", ReqRenameSession, map[string]any{"title": "My \"title\""}),
		`{"type":"control_request","request_id":"req_1","request":{"subtype":"rename_session","title":"My \"title\""}}`)
}

func parseGolden(t *testing.T, line string) Msg {
	t.Helper()
	m, ok := ParseOutputLine([]byte(line))
	if !ok {
		t.Fatalf("not parsed: %s", line)
	}
	return m
}

const sid = "11111111-aaaa-4bbb-8ccc-000000000001"

func TestGoldenParseSystem(t *testing.T) {
	m := parseGolden(t, `{"type":"system","subtype":"init","session_id":"`+sid+`","cwd":"C:/Users/u/acme","model":"claude-test-opus","permissionMode":"default","tools":["Read","Bash"],"slash_commands":["compact","review"],"agents":["Explore"],"skills":[],"mcp_servers":[],"claude_code_version":"0.0.0-test"}`)
	if m.Kind != MsgInit || m.SessionID != sid || m.Model != "claude-test-opus" || m.PermissionMode != "default" ||
		m.Cwd != "C:/Users/u/acme" || m.Version != "0.0.0-test" || !reflect.DeepEqual(m.Commands, []string{"compact", "review"}) {
		t.Fatalf("init = %+v", m)
	}
	m = parseGolden(t, `{"type":"system","subtype":"init","session_id":"`+sid+`","slash_commands":["a",5,null,"b"]}`)
	if !reflect.DeepEqual(m.Commands, []string{"a", "b"}) {
		t.Fatalf("commands = %v", m.Commands)
	}
	m = parseGolden(t, `{"type":"system","subtype":"status","status":"requesting","session_id":"`+sid+`"}`)
	if m.Kind != MsgStatus || m.StatusText != "requesting" {
		t.Fatalf("status = %+v", m)
	}
	m = parseGolden(t, `{"type":"system","subtype":"commands_changed","commands":[{"name":"p:do","description":"x"},{"description":"no name"}]}`)
	if m.Kind != MsgCommandsChanged || !reflect.DeepEqual(m.Commands, []string{"p:do"}) {
		t.Fatalf("commands_changed = %+v", m)
	}
	for _, sub := range []string{"hook_started", "hook_response", "thinking_tokens", "api_retry", "compact_boundary", "task_started"} {
		if _, ok := ParseOutputLine([]byte(`{"type":"system","subtype":"` + sub + `","session_id":"` + sid + `"}`)); ok {
			t.Errorf("system/%s should be ignored", sub)
		}
	}
}

func TestGoldenParseStreamEvent(t *testing.T) {
	ev := func(event string) string {
		return `{"type":"stream_event","event":` + event + `,"parent_tool_use_id":null,"api_message_id":"msg_1","session_id":"` + sid + `"}`
	}
	m := parseGolden(t, ev(`{"type":"message_start","message":{"id":"msg_1","role":"assistant"}}`))
	if m.EventType != "message_start" || m.MessageID != "msg_1" {
		t.Fatalf("message_start = %+v", m)
	}
	m = parseGolden(t, ev(`{"type":"content_block_start","index":2,"content_block":{"type":"tool_use","id":"toolu_1","name":"Bash","input":{}}}`))
	if m.EventType != "content_block_start" || m.BlockType != "tool_use" || m.ToolName != "Bash" {
		t.Fatalf("block start = %+v", m)
	}
	m = parseGolden(t, ev(`{"type":"content_block_start","index":1,"content_block":{"type":"thinking","thinking":""}}`))
	if m.BlockType != "thinking" {
		t.Fatalf("block start = %+v", m)
	}
	for _, c := range []struct{ ev, dt, text string }{
		{`{"type":"content_block_delta","index":0,"delta":{"type":"text_delta","text":"Hel"}}`, "text_delta", "Hel"},
		{`{"type":"content_block_delta","index":1,"delta":{"type":"thinking_delta","thinking":"hmm"}}`, "thinking_delta", "hmm"},
		{`{"type":"content_block_delta","index":2,"delta":{"type":"input_json_delta","partial_json":"{\"a\""}}`, "input_json_delta", `{"a"`},
	} {
		m = parseGolden(t, ev(c.ev))
		if m.EventType != "content_block_delta" || m.DeltaType != c.dt || m.DeltaText != c.text {
			t.Fatalf("delta = %+v want %s %q", m, c.dt, c.text)
		}
	}
	if _, ok := ParseOutputLine([]byte(ev(`{"type":"content_block_delta","index":1,"delta":{"type":"signature_delta","signature":"FAKE"}}`))); ok {
		t.Fatal("signature_delta must not be a delta")
	}
	m = parseGolden(t, ev(`{"type":"message_stop"}`))
	if m.EventType != "message_stop" {
		t.Fatalf("message_stop = %+v", m)
	}
}

func TestGoldenParseAssistantUserResult(t *testing.T) {
	m := parseGolden(t, `{"type":"assistant","message":{"id":"msg_9","role":"assistant","content":[{"type":"text","text":"Hello there"}],"usage":{}},"parent_tool_use_id":null,"session_id":"`+sid+`"}`)
	if m.Kind != MsgAssistant || m.MessageID != "msg_9" || m.Aborted || m.AssistantText != "Hello there" {
		t.Fatalf("assistant = %+v", m)
	}
	m = parseGolden(t, `{"type":"assistant","aborted":true,"message":{"id":"msg_9","content":[]},"parent_tool_use_id":null}`)
	if !m.Aborted {
		t.Fatalf("aborted = %+v", m)
	}
	m = parseGolden(t, `{"type":"assistant","message":{"id":"m","content":[{"type":"text","text":"`+strings.Repeat("x", 9000)+`"}]},"parent_tool_use_id":null}`)
	if n := len([]rune(m.AssistantText)); n < 3000 || n > 4001 {
		t.Fatalf("assistant text len = %d", n)
	}

	m = parseGolden(t, `{"type":"user","message":{"role":"user","content":[{"type":"tool_result","tool_use_id":"toolu_1","content":"ok"}]},"parent_tool_use_id":null,"tool_use_result":{}}`)
	if m.Kind != MsgUser {
		t.Fatalf("tool_result user = %+v", m)
	}
	m = parseGolden(t, `{"type":"user","uuid":"u-1","message":{"role":"user","content":"hello"},"parent_tool_use_id":null,"session_id":"`+sid+`"}`)
	if m.Kind != MsgUserEcho || m.UUID != "u-1" || m.UserText != "hello" {
		t.Fatalf("echo = %+v", m)
	}
	m = parseGolden(t, `{"type":"user","uuid":"u-2","message":{"role":"user","content":[{"type":"text","text":"a"},{"type":"text","text":"b"}]}}`)
	if m.Kind != MsgUserEcho || m.UserText != "a\nb" {
		t.Fatalf("echo blocks = %+v", m)
	}

	m = parseGolden(t, `{"type":"result","subtype":"success","is_error":false,"result":"Done.","session_id":"`+sid+`","stop_reason":"end_turn","total_cost_usd":0.0123,"duration_ms":1500,"usage":{"input_tokens":3,"output_tokens":4,"cache_read_input_tokens":5,"cache_creation_input_tokens":6},"num_turns":1,"permission_denials":[{"tool_name":"Bash"},{"tool_name":"Write"}]}`)
	if m.Kind != MsgResult || m.Subtype != "success" || m.IsError || m.SessionID != sid || m.ResultText != "Done." ||
		m.Cost != 0.0123 || m.Denials != 2 || m.StopReason != "end_turn" || m.Duration != 1500 ||
		m.Usage == nil || *m.Usage != (ResultUsage{Input: 3, Output: 4, CacheRead: 5, CacheCreation: 6}) {
		t.Fatalf("result = %+v usage=%+v", m, m.Usage)
	}
	m = parseGolden(t, `{"type":"result","subtype":"error_during_execution","is_error":true,"session_id":"`+sid+`"}`)
	if !m.IsError || m.Denials != 0 || m.Subtype != "error_during_execution" {
		t.Fatalf("error result = %+v", m)
	}
	m = parseGolden(t, `{"type":"result","subtype":"success","is_error":false,"result":"`+strings.Repeat("y", 9000)+`"}`)
	if n := len([]rune(m.ResultText)); n > 4001 {
		t.Fatalf("result text len = %d", n)
	}
	for _, l := range []string{`{"type":"rate_limit_event","rate_limit_info":{}}`, `{"type":"brand_new_thing","x":1}`} {
		if _, ok := ParseOutputLine([]byte(l)); ok {
			t.Errorf("%s should be ignored", l)
		}
	}
}

func canUse(over string) string {
	return `{"type":"control_request","request_id":"req_1","request":{"subtype":"can_use_tool","tool_name":"Bash","display_name":"Bash","input":{"command":"npm test"},"tool_use_id":"toolu_1","description":"Run tests"` + over + `}}`
}

func TestGoldenParseControlRequest(t *testing.T) {
	m := parseGolden(t, canUse(""))
	if m.Kind != MsgCanUseTool || m.RequestID != "req_1" || m.ToolName != "Bash" || m.DisplayName != "Bash" ||
		m.ToolUseID != "toolu_1" || m.Description != "Run tests" || string(m.Suggestions) != "[]" || m.CanAllowSession {
		t.Fatalf("can_use_tool = %+v", m)
	}
	var in map[string]any
	if err := json.Unmarshal(m.Input, &in); err != nil || in["command"] != "npm test" {
		t.Fatalf("input = %s", m.Input)
	}

	m = parseGolden(t, canUse(`,"decision_reason":"\u001b[31mOutside project\u001b[0m","blocked_path":"C:/Users/u/other/a.txt","permission_suggestions":[{"type":"addRules","rules":[],"behavior":"allow","destination":"localSettings"}]`))
	var sg []any
	if m.Reason != "Outside project" || m.BlockedPath != "C:/Users/u/other/a.txt" ||
		json.Unmarshal(m.Suggestions, &sg) != nil || len(sg) != 1 || !m.CanAllowSession {
		t.Fatalf("details = %+v", m)
	}

	m = parseGolden(t, canUse(`,"decision_reason":"`+strings.Repeat("r", 2000)+`"`))
	if len([]rune(m.Reason)) > 501 {
		t.Fatalf("reason len = %d", len([]rune(m.Reason)))
	}
	m = parseGolden(t, strings.Replace(canUse(""), `"display_name":"Bash",`, "", 1))
	if m.DisplayName != "Bash" {
		t.Fatalf("display fallback = %q", m.DisplayName)
	}

	m = parseGolden(t, `{"type":"control_request","request_id":"req_2","request":{"subtype":"hook_callback"}}`)
	if m.Kind != MsgControlRequest || m.RequestID != "req_2" || m.ReqSubtype != "hook_callback" {
		t.Fatalf("other control request = %+v", m)
	}
	m = parseGolden(t, `{"type":"control_request","request_id":"req_3","request":{"subtype":"can_use_tool","input":{}}}`)
	if m.Kind == MsgCanUseTool {
		t.Fatal("can_use_tool without tool_name must not be can-use-tool")
	}
}

func TestGoldenParseControlResponse(t *testing.T) {
	m := parseGolden(t, `{"type":"control_response","response":{"subtype":"success","request_id":"req_7","response":{"still_queued":[]}}}`)
	if m.Kind != MsgControlResponse || m.CorrelationID != "req_7" || !m.OK || string(m.ResponseBody) != `{"still_queued":[]}` {
		t.Fatalf("success = %+v", m)
	}
	m = parseGolden(t, `{"type":"control_response","response":{"subtype":"error","request_id":"req_8","error":"nope"}}`)
	if m.CorrelationID != "req_8" || m.OK || m.Error != "nope" {
		t.Fatalf("error = %+v", m)
	}
}

func TestGoldenRobustness(t *testing.T) {
	for _, l := range []string{"", "   ", "\r", "{not json", "null", "[]", `"str"`, "42"} {
		if _, ok := ParseOutputLine([]byte(l)); ok {
			t.Errorf("%q should not parse", l)
		}
	}
	for _, l := range []string{
		`{}`, `{"type":5}`, `{"type":null}`,
		`{"type":"system","subtype":"init","session_id":5,"slash_commands":"x"}`,
		`{"type":"stream_event","event":"nope"}`,
		`{"type":"stream_event","event":{"type":"content_block_delta","delta":null}}`,
		`{"type":"assistant","message":"x"}`,
		`{"type":"result","permission_denials":"x","total_cost_usd":"x"}`,
		`{"type":"control_request","request":null}`,
		`{"type":"control_response","response":3}`,
	} {
		ParseOutputLine([]byte(l)) // must not panic
	}
	m := parseGolden(t, `{"type":"system","subtype":"status","status":"requesting"}`+"\r")
	if m.StatusText != "requesting" {
		t.Fatalf("CRLF line = %+v", m)
	}
}

// The wire shape the old invented protocol used must not parse as a request.
func TestInventedShapeIsNotAccepted(t *testing.T) {
	m, ok := ParseOutputLine([]byte(`{"type":"control_request","subtype":"can_use_tool","request_id":"r1","tool":{"toolName":"Bash","input":{}}}`))
	if ok && m.Kind == MsgCanUseTool {
		t.Fatal("invented can_use_tool shape parsed")
	}
}
