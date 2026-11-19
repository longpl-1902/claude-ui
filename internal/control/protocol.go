package control

import (
	"encoding/json"
	"fmt"
	"regexp"
	"strings"
	"unicode/utf8"
)

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
)

type Msg struct {
	Kind MsgKind

	// Init
	SessionID string
	Model     string
	Version   string
	Commands  []string
	Models    []string

	// Status
	StatusText string

	// StreamEvent
	EventType string
	DeltaType string
	DeltaText string

	// Assistant
	AssistantText string
	Aborted       bool

	// Result
	Cost       float64
	Duration   float64
	StopReason string
	Usage      *ResultUsage
	Denials    int

	// CanUseTool / ControlRequest
	RequestID       string
	ToolName        string
	DisplayName     string
	Input           json.RawMessage
	Description     string
	Reason          string
	BlockedPath     string
	Suggestions     json.RawMessage
	CanAllowSession bool

	// Questions (AskUserQuestion / ExitPlanMode)
	Questions []QuestionData

	// ControlResponse
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

var ansiRe = regexp.MustCompile(`\x1b\[[0-9;]*[a-zA-Z]`)

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

func ParseOutputLine(line []byte) (Msg, bool) {
	var envelope struct {
		Type    string          `json:"type"`
		Subtype string          `json:"subtype"`
		IsEcho  bool            `json:"is_echo"`
		Message json.RawMessage `json:"message"`
	}
	if err := json.Unmarshal(line, &envelope); err != nil {
		return Msg{}, false
	}

	raw := json.RawMessage(append([]byte(nil), line...))

	switch envelope.Type {
	case "system":
		return parseSystem(envelope.Subtype, envelope.Message, raw)
	case "status":
		return parseStatus(line, raw)
	case "stream_event":
		return parseStreamEvent(line, raw)
	case "assistant":
		return parseAssistant(line, raw)
	case "user":
		if envelope.IsEcho {
			return Msg{Kind: MsgUserEcho, Raw: raw}, true
		}
		return Msg{}, false
	case "result":
		return parseResult(line, raw)
	case "control_request":
		return parseControlRequest(envelope.Subtype, line, raw)
	case "control_response":
		return parseControlResponse(line, raw)
	case "commands_changed":
		return Msg{Kind: MsgCommandsChanged, Raw: raw}, true
	default:
		return Msg{}, false
	}
}

func parseSystem(subtype string, message json.RawMessage, raw json.RawMessage) (Msg, bool) {
	if subtype != "init" {
		return Msg{}, false
	}
	var init struct {
		SessionID         string `json:"sessionId"`
		ClaudeCodeVersion string `json:"claude_code_version"`
		Model             string `json:"model"`
		Tools             []struct {
			Name string `json:"name"`
		} `json:"tools"`
		Models []string `json:"models"`
	}
	if message != nil {
		if err := json.Unmarshal(message, &init); err != nil {
			return Msg{}, false
		}
	}

	var commands []string
	for _, t := range init.Tools {
		if t.Name != "" {
			commands = append(commands, t.Name)
		}
	}

	return Msg{
		Kind:      MsgInit,
		SessionID: init.SessionID,
		Model:     init.Model,
		Version:   init.ClaudeCodeVersion,
		Commands:  commands,
		Models:    init.Models,
		Raw:       raw,
	}, true
}

func parseStatus(line []byte, raw json.RawMessage) (Msg, bool) {
	var s struct {
		Status string `json:"status"`
	}
	if err := json.Unmarshal(line, &s); err != nil {
		return Msg{}, false
	}
	return Msg{Kind: MsgStatus, StatusText: s.Status, Raw: raw}, true
}

func parseStreamEvent(line []byte, raw json.RawMessage) (Msg, bool) {
	var se struct {
		Event struct {
			Type  string `json:"type"`
			Delta struct {
				Type string `json:"type"`
				Text string `json:"text"`
			} `json:"delta"`
			ContentBlock struct {
				Type string `json:"type"`
			} `json:"content_block"`
		} `json:"event"`
	}
	if err := json.Unmarshal(line, &se); err != nil {
		return Msg{}, false
	}

	m := Msg{
		Kind:      MsgStreamEvent,
		EventType: se.Event.Type,
		Raw:       raw,
	}

	if se.Event.Type == "content_block_delta" || se.Event.Type == "delta" {
		m.DeltaType = se.Event.Delta.Type
		if se.Event.Delta.Type == "signature" {
			return Msg{}, false
		}
		m.DeltaText = se.Event.Delta.Text
	}

	return m, true
}

func parseAssistant(line []byte, raw json.RawMessage) (Msg, bool) {
	var a struct {
		Message struct {
			Text    string `json:"text"`
			Content []struct {
				Type string `json:"type"`
				Text string `json:"text"`
			} `json:"content"`
		} `json:"message"`
		Aborted bool `json:"aborted"`
	}
	if err := json.Unmarshal(line, &a); err != nil {
		return Msg{}, false
	}

	text := a.Message.Text
	if text == "" && len(a.Message.Content) > 0 {
		var parts []string
		for _, c := range a.Message.Content {
			if c.Type == "text" {
				parts = append(parts, c.Text)
			}
		}
		text = strings.Join(parts, "")
	}

	return Msg{
		Kind:          MsgAssistant,
		AssistantText: capString(text, 4000),
		Aborted:       a.Aborted,
		Raw:           raw,
	}, true
}

func parseResult(line []byte, raw json.RawMessage) (Msg, bool) {
	var r struct {
		Cost       float64 `json:"cost_usd"`
		Duration   float64 `json:"duration_ms"`
		StopReason string  `json:"stop_reason"`
		Denials    int     `json:"num_denials"`
		Usage      *struct {
			Input         int64 `json:"input_tokens"`
			Output        int64 `json:"output_tokens"`
			CacheCreation int64 `json:"cache_creation_input_tokens"`
			CacheRead     int64 `json:"cache_read_input_tokens"`
		} `json:"usage"`
	}
	if err := json.Unmarshal(line, &r); err != nil {
		return Msg{}, false
	}

	m := Msg{
		Kind:       MsgResult,
		Cost:       r.Cost,
		Duration:   r.Duration,
		StopReason: r.StopReason,
		Denials:    r.Denials,
		Raw:        raw,
	}
	if r.Usage != nil {
		m.Usage = &ResultUsage{
			Input:         r.Usage.Input,
			Output:        r.Usage.Output,
			CacheCreation: r.Usage.CacheCreation,
			CacheRead:     r.Usage.CacheRead,
		}
	}
	return m, true
}

func parseControlRequest(subtype string, line []byte, raw json.RawMessage) (Msg, bool) {
	if subtype == "can_use_tool" {
		return parseCanUseTool(line, raw)
	}

	var cr struct {
		RequestID string `json:"request_id"`
	}
	_ = json.Unmarshal(line, &cr)

	return Msg{
		Kind:      MsgControlRequest,
		RequestID: cr.RequestID,
		Raw:       raw,
	}, true
}

func parseCanUseTool(line []byte, raw json.RawMessage) (Msg, bool) {
	var req struct {
		RequestID string `json:"request_id"`
		Tool      struct {
			Name        string          `json:"toolName"`
			DisplayName string          `json:"displayName"`
			Input       json.RawMessage `json:"input"`
			Description string          `json:"description"`
			Reason      string          `json:"reason"`
			BlockedPath string          `json:"blocked_path"`
		} `json:"tool"`
		Suggestions     json.RawMessage `json:"suggestions"`
		CanAllowSession bool            `json:"can_allow_session"`
		Questions       []QuestionData  `json:"questions"`
	}
	if err := json.Unmarshal(line, &req); err != nil {
		return Msg{}, false
	}

	displayName := req.Tool.DisplayName
	if displayName == "" {
		displayName = req.Tool.Name
	}

	return Msg{
		Kind:            MsgCanUseTool,
		RequestID:       req.RequestID,
		ToolName:        req.Tool.Name,
		DisplayName:     displayName,
		Input:           req.Tool.Input,
		Description:     capString(stripANSI(req.Tool.Description), 500),
		Reason:          capString(stripANSI(req.Tool.Reason), 500),
		BlockedPath:     req.Tool.BlockedPath,
		Suggestions:     req.Suggestions,
		CanAllowSession: req.CanAllowSession,
		Questions:       req.Questions,
		Raw:             raw,
	}, true
}

func parseControlResponse(line []byte, raw json.RawMessage) (Msg, bool) {
	var cr struct {
		RequestID string          `json:"request_id"`
		Body      json.RawMessage `json:"body"`
	}
	if err := json.Unmarshal(line, &cr); err != nil {
		return Msg{}, false
	}
	return Msg{
		Kind:          MsgControlResponse,
		CorrelationID: cr.RequestID,
		ResponseBody:  cr.Body,
		Raw:           raw,
	}, true
}

// --- Encoders ---

func EncodeUserTurn(text string) []byte {
	frame := map[string]any{
		"type":    "user",
		"message": text,
	}
	b, _ := json.Marshal(frame)
	return append(b, '\n')
}

func EncodeAllow(reqID string, input json.RawMessage, sessionRules json.RawMessage) []byte {
	resp := map[string]any{
		"type":       "control_response",
		"request_id": reqID,
		"body": map[string]any{
			"behavior":     "allow",
			"updatedInput": input,
		},
	}
	if sessionRules != nil {
		body := resp["body"].(map[string]any)
		body["updatedPermissions"] = sessionRules
	}
	b, _ := json.Marshal(resp)
	return append(b, '\n')
}

func EncodeAllowWithAnswers(reqID string, input json.RawMessage, answers map[string]string) []byte {
	var merged json.RawMessage
	if input != nil {
		var base map[string]any
		if err := json.Unmarshal(input, &base); err == nil {
			if answers != nil {
				if base == nil {
					base = make(map[string]any)
				}
				base["answers"] = answers
			}
			merged, _ = json.Marshal(base)
		}
	}
	if merged == nil {
		merged, _ = json.Marshal(map[string]any{"answers": answers})
	}

	resp := map[string]any{
		"type":       "control_response",
		"request_id": reqID,
		"body": map[string]any{
			"behavior":     "allow",
			"updatedInput": json.RawMessage(merged),
		},
	}
	b, _ := json.Marshal(resp)
	return append(b, '\n')
}

func EncodeDeny(reqID string, message string) []byte {
	resp := map[string]any{
		"type":       "control_response",
		"request_id": reqID,
		"body": map[string]any{
			"behavior": "deny",
			"message":  message,
		},
	}
	b, _ := json.Marshal(resp)
	return append(b, '\n')
}

func EncodeUnsupported(reqID string) []byte {
	resp := map[string]any{
		"type":       "control_response",
		"request_id": reqID,
		"body": map[string]any{
			"behavior": "unsupported",
		},
	}
	b, _ := json.Marshal(resp)
	return append(b, '\n')
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

func EncodeRequest(reqID string, kind ReqKind, params map[string]any) []byte {
	body := map[string]any{
		"type": string(kind),
	}
	for k, v := range params {
		body[k] = v
	}
	frame := map[string]any{
		"type":       "control_request",
		"request_id": reqID,
		"body":       body,
	}
	b, _ := json.Marshal(frame)
	return append(b, '\n')
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
