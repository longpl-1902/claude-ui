package control

import (
	"bytes"
	"encoding/json"
	"fmt"
	"regexp"
	"strings"
	"unicode/utf8"
)

// The wire shapes in this file are ported from the working Electron app
// (git tag electron-final, src/main/control/protocol.ts) and pinned by
// golden_test.go. Do not invent shapes: the real CLI rejects them.

type MsgKind int

const (
	MsgInit MsgKind = iota
	MsgStatus
	MsgStreamEvent
	MsgAssistant
	MsgUserEcho
	MsgResult
	MsgCanUseTool
	MsgControlRequest
	MsgControlResponse
	MsgCommandsChanged
	MsgUser // tool_result turn (not a replayed prompt)
)

type Msg struct {
	Kind MsgKind

	// Init
	SessionID      string
	Model          string
	Version        string
	PermissionMode string
	Cwd            string
	Commands       []string // slash command names (init) / command names (commands_changed)

	// Status
	StatusText string

	// StreamEvent
	EventType string
	DeltaType string // text_delta, thinking_delta, input_json_delta
	DeltaText string
	BlockType string
	ToolName  string // content_block_start tool_use name
	MessageID string

	// Assistant
	AssistantText string
	Aborted       bool

	// UserEcho
	UUID     string
	UserText string

	// Result
	Subtype    string
	IsError    bool
	ResultText string
	Cost       float64
	Duration   float64
	StopReason string
	Usage      *ResultUsage
	Denials    int

	// CanUseTool / ControlRequest
	RequestID       string
	ReqSubtype      string
	DisplayName     string
	Input           json.RawMessage
	ToolUseID       string
	Description     string
	Reason          string // decision_reason
	BlockedPath     string
	Suggestions     json.RawMessage // permission_suggestions, "[]" when absent
	CanAllowSession bool            // derived: a session-scoped suggestion exists

	// ControlResponse
	OK            bool
	Error         string
	ResponseBody  json.RawMessage
	CorrelationID string

	// Raw
	Raw json.RawMessage
}

type ResultUsage struct {
	Input         int64
	Output        int64
	CacheCreation int64
	CacheRead     int64
}

type QuestionData struct {
	Text    string       `json:"question"`
	Header  string       `json:"header"`
	Options []OptionData `json:"options"`
	Multi   bool         `json:"multiSelect"`
}

type OptionData struct {
	Label       string `json:"label"`
	Description string `json:"description"`
}

var ansiRe = regexp.MustCompile(`\x1b\[[0-9;?]*[ -/]*[@-~]|\x1b\][^\x07\x1b]*(?:\x07|\x1b\\)`)

func stripANSI(s string) string {
	return ansiRe.ReplaceAllString(s, "")
}

func capString(s string, max int) string {
	if utf8.RuneCountInString(s) <= max {
		return s
	}
	r := []rune(s)
	return string(r[:max]) + "…"
}

type obj = map[string]any

func asObj(v any) (obj, bool) {
	o, ok := v.(map[string]any)
	return o, ok
}

func str(v any) (string, bool) {
	s, ok := v.(string)
	return s, ok
}

func strOf(o obj, k string) string {
	s, _ := str(o[k])
	return s
}

func numOf(v any) float64 {
	switch n := v.(type) {
	case json.Number:
		f, _ := n.Float64()
		return f
	case float64:
		return n
	}
	return 0
}

func intOf(v any) int64 { return int64(numOf(v)) }

// ParseOutputLine parses one stdout line. It returns false for blank or
// invalid lines and for messages the app does not act on. It never panics.
func ParseOutputLine(line []byte) (Msg, bool) {
	line = bytes.TrimSpace(line)
	if len(line) == 0 {
		return Msg{}, false
	}
	dec := json.NewDecoder(bytes.NewReader(line))
	dec.UseNumber()
	var v any
	if err := dec.Decode(&v); err != nil {
		return Msg{}, false
	}
	o, ok := asObj(v)
	if !ok {
		return Msg{}, false
	}
	raw := json.RawMessage(append([]byte(nil), line...))
	typ, _ := str(o["type"])
	switch typ {
	case "system":
		return parseSystem(o, raw)
	case "stream_event":
		return parseStreamEvent(o, raw)
	case "assistant":
		return parseAssistant(o, raw)
	case "user":
		return parseUser(o, raw)
	case "result":
		return parseResult(o, raw)
	case "control_request":
		return parseControlRequest(o, raw)
	case "control_response":
		return parseControlResponse(o, raw)
	default:
		return Msg{}, false
	}
}

func parseSystem(o obj, raw json.RawMessage) (Msg, bool) {
	switch strOf(o, "subtype") {
	case "init":
		m := Msg{
			Kind:           MsgInit,
			SessionID:      strOf(o, "session_id"),
			Model:          strOf(o, "model"),
			PermissionMode: strOf(o, "permissionMode"),
			Cwd:            strOf(o, "cwd"),
			Version:        strOf(o, "claude_code_version"),
			Raw:            raw,
		}
		if arr, ok := o["slash_commands"].([]any); ok {
			for _, c := range arr {
				if s, ok := str(c); ok {
					m.Commands = append(m.Commands, s)
				}
			}
		}
		return m, true
	case "commands_changed":
		m := Msg{Kind: MsgCommandsChanged, Raw: raw}
		if arr, ok := o["commands"].([]any); ok {
			for _, c := range arr {
				co, ok := asObj(c)
				if !ok {
					continue
				}
				if n := strOf(co, "name"); n != "" {
					m.Commands = append(m.Commands, n)
				}
			}
		}
		return m, true
	case "status":
		if s, ok := str(o["status"]); ok {
			return Msg{Kind: MsgStatus, StatusText: s, Raw: raw}, true
		}
	}
	return Msg{}, false
}

func parseStreamEvent(o obj, raw json.RawMessage) (Msg, bool) {
	ev, ok := asObj(o["event"])
	if !ok {
		return Msg{}, false
	}
	evType, ok := str(ev["type"])
	if !ok {
		return Msg{}, false
	}
	m := Msg{Kind: MsgStreamEvent, EventType: evType, MessageID: strOf(o, "api_message_id"), Raw: raw}
	switch evType {
	case "message_start":
		if msg, ok := asObj(ev["message"]); ok && strOf(msg, "id") != "" {
			m.MessageID = strOf(msg, "id")
		}
	case "content_block_start":
		b, _ := asObj(ev["content_block"])
		m.BlockType = strOf(b, "type")
		if m.BlockType == "" {
			m.BlockType = "unknown"
		}
		m.ToolName = strOf(b, "name")
	case "content_block_delta":
		d, _ := asObj(ev["delta"])
		dt := strOf(d, "type")
		var text string
		var has bool
		switch dt {
		case "text_delta":
			text, has = str(d["text"])
		case "thinking_delta":
			text, has = str(d["thinking"])
		case "input_json_delta":
			text, has = str(d["partial_json"])
		}
		if !has {
			return Msg{}, false // incl. signature_delta
		}
		m.DeltaType = dt
		m.DeltaText = text
	case "message_stop":
	default:
		return Msg{}, false
	}
	return m, true
}

func parseAssistant(o obj, raw json.RawMessage) (Msg, bool) {
	msg, _ := asObj(o["message"])
	m := Msg{Kind: MsgAssistant, MessageID: strOf(msg, "id"), Aborted: o["aborted"] == true, Raw: raw}
	if arr, ok := msg["content"].([]any); ok {
		var parts []string
		for _, c := range arr {
			if co, ok := asObj(c); ok && strOf(co, "type") == "text" {
				if t := strOf(co, "text"); t != "" {
					parts = append(parts, t)
				}
			}
		}
		m.AssistantText = capString(strings.Join(parts, "\n"), 4000)
	}
	return m, true
}

// parseUser: a plain prompt replayed by --replay-user-messages becomes
// MsgUserEcho; a tool_result turn becomes MsgUser.
func parseUser(o obj, raw json.RawMessage) (Msg, bool) {
	plain := Msg{Kind: MsgUser, Raw: raw}
	uuid, hasUUID := str(o["uuid"])
	msg, hasMsg := asObj(o["message"])
	if !hasUUID || !hasMsg {
		return plain, true
	}
	switch c := msg["content"].(type) {
	case string:
		return Msg{Kind: MsgUserEcho, UUID: uuid, UserText: c, Raw: raw}, true
	case []any:
		var text string
		for _, b := range c {
			bo, ok := asObj(b)
			if !ok {
				continue
			}
			switch strOf(bo, "type") {
			case "tool_result":
				return plain, true
			case "text":
				if t, ok := str(bo["text"]); ok {
					if text != "" {
						text += "\n"
					}
					text += t
				}
			}
		}
		return Msg{Kind: MsgUserEcho, UUID: uuid, UserText: text, Raw: raw}, true
	}
	return plain, true
}

func parseResult(o obj, raw json.RawMessage) (Msg, bool) {
	m := Msg{
		Kind:    MsgResult,
		Subtype: strOf(o, "subtype"),
		IsError: o["is_error"] == true,
		Raw:     raw,
	}
	m.SessionID = strOf(o, "session_id")
	if s, ok := str(o["result"]); ok {
		m.ResultText = capString(s, 4000)
	}
	m.Cost = numOf(o["total_cost_usd"])
	m.StopReason = strOf(o, "stop_reason")
	m.Duration = numOf(o["duration_ms"])
	if d, ok := o["permission_denials"].([]any); ok {
		m.Denials = len(d)
	}
	if u, ok := asObj(o["usage"]); ok {
		m.Usage = &ResultUsage{
			Input:         intOf(u["input_tokens"]),
			Output:        intOf(u["output_tokens"]),
			CacheCreation: intOf(u["cache_creation_input_tokens"]),
			CacheRead:     intOf(u["cache_read_input_tokens"]),
		}
	}
	return m, true
}

func parseControlRequest(o obj, raw json.RawMessage) (Msg, bool) {
	reqID := strOf(o, "request_id")
	req, _ := asObj(o["request"])
	sub := strOf(req, "subtype")
	toolName := strOf(req, "tool_name")
	if sub != "can_use_tool" || toolName == "" {
		return Msg{Kind: MsgControlRequest, RequestID: reqID, ReqSubtype: sub, Raw: raw}, true
	}
	m := Msg{
		Kind:        MsgCanUseTool,
		RequestID:   reqID,
		ReqSubtype:  sub,
		ToolName:    toolName,
		DisplayName: strOf(req, "display_name"),
		ToolUseID:   strOf(req, "tool_use_id"),
		BlockedPath: strOf(req, "blocked_path"),
		Raw:         raw,
	}
	if m.DisplayName == "" {
		m.DisplayName = toolName
	}
	if in, ok := asObj(req["input"]); ok {
		m.Input, _ = json.Marshal(in)
	} else {
		m.Input = json.RawMessage(`{}`)
	}
	if sg, ok := req["permission_suggestions"].([]any); ok {
		m.Suggestions, _ = json.Marshal(sg)
	} else {
		m.Suggestions = json.RawMessage(`[]`)
	}
	m.CanAllowSession = len(SessionScopedSuggestions(m.Suggestions)) > 0
	m.Description = capString(strOf(req, "description"), 500)
	m.Reason = capString(stripANSI(strOf(req, "decision_reason")), 500)
	return m, true
}

func parseControlResponse(o obj, raw json.RawMessage) (Msg, bool) {
	r, _ := asObj(o["response"])
	m := Msg{
		Kind:          MsgControlResponse,
		CorrelationID: strOf(r, "request_id"),
		OK:            strOf(r, "subtype") == "success",
		Error:         strOf(r, "error"),
		Raw:           raw,
	}
	if body, present := r["response"]; present {
		m.ResponseBody, _ = json.Marshal(body)
	}
	return m, true
}

// --- Encoders (frames written to the CLI's stdin) ---

func frame(v any) []byte {
	b, _ := json.Marshal(v)
	return append(b, '\n')
}

func EncodeUserTurn(text string) []byte {
	return frame(map[string]any{
		"type":               "user",
		"message":            map[string]any{"role": "user", "content": text},
		"parent_tool_use_id": nil,
		"session_id":         "",
	})
}

func controlResponse(reqID string, response any) []byte {
	return frame(map[string]any{
		"type": "control_response",
		"response": map[string]any{
			"subtype":    "success",
			"request_id": reqID,
			"response":   response,
		},
	})
}

func rawOrEmptyObject(in json.RawMessage) json.RawMessage {
	if len(in) == 0 {
		return json.RawMessage(`{}`)
	}
	return in
}

func EncodeAllow(reqID string, input json.RawMessage, sessionRules json.RawMessage) []byte {
	resp := map[string]any{
		"behavior":     "allow",
		"updatedInput": rawOrEmptyObject(input),
	}
	if len(sessionRules) > 0 {
		resp["updatedPermissions"] = sessionRules
	}
	return controlResponse(reqID, resp)
}

// EncodeAllowWithAnswers allows with the original input plus an "answers"
// object (AskUserQuestion).
func EncodeAllowWithAnswers(reqID string, input json.RawMessage, answers map[string]string) []byte {
	base := map[string]any{}
	if len(input) > 0 {
		_ = json.Unmarshal(input, &base)
		if base == nil {
			base = map[string]any{}
		}
	}
	if answers == nil {
		answers = map[string]string{}
	}
	base["answers"] = answers
	merged, _ := json.Marshal(base)
	return EncodeAllow(reqID, merged, nil)
}

func EncodeDeny(reqID string, message string) []byte {
	return controlResponse(reqID, map[string]any{"behavior": "deny", "message": message})
}

// EncodeUnsupported answers a control_request we do not handle.
func EncodeUnsupported(reqID string, subtype string) []byte {
	return frame(map[string]any{
		"type": "control_response",
		"response": map[string]any{
			"subtype":    "error",
			"request_id": reqID,
			"error":      "unsupported: " + subtype,
		},
	})
}

type ReqKind string

const (
	ReqInitialize        ReqKind = "initialize"
	ReqInterrupt         ReqKind = "interrupt"
	ReqSetModel          ReqKind = "set_model"
	ReqSetPermissionMode ReqKind = "set_permission_mode"
	ReqMcpStatus         ReqKind = "mcp_status"
	ReqGetContextUsage   ReqKind = "get_context_usage"
	ReqRenameSession     ReqKind = "rename_session"
	ReqRewindFiles       ReqKind = "rewind_files"
)

// EncodeRequest builds {"type":"control_request","request_id":..,
// "request":{"subtype":kind,...params}}.
func EncodeRequest(reqID string, kind ReqKind, params map[string]any) []byte {
	req := map[string]any{"subtype": string(kind)}
	for k, v := range params {
		req[k] = v
	}
	return frame(map[string]any{
		"type":       "control_request",
		"request_id": reqID,
		"request":    req,
	})
}

func SessionScopedSuggestions(raw json.RawMessage) json.RawMessage {
	if raw == nil {
		return nil
	}

	var suggestions []map[string]any
	if err := json.Unmarshal(raw, &suggestions); err != nil {
		return nil
	}

	allowedTypes := map[string]bool{
		"addRules":       true,
		"replaceRules":   true,
		"addDirectories": true,
		"setMode":        true,
	}

	var filtered []map[string]any
	for _, s := range suggestions {
		typeStr, _ := s["type"].(string)
		if !allowedTypes[typeStr] {
			continue
		}
		s["destination"] = "session"
		filtered = append(filtered, s)
	}

	if len(filtered) == 0 {
		return nil
	}

	b, err := json.Marshal(filtered)
	if err != nil {
		return nil
	}
	return b
}

// StripANSI is exported for use by other packages.
func StripANSI(s string) string { return stripANSI(s) }

// CapString is exported for use by other packages.
func CapString(s string, max int) string { return capString(s, max) }

// FormatRequestID generates a unique request ID for control messages.
func FormatRequestID(n int) string {
	return fmt.Sprintf("ac-%d", n)
}
