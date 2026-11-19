package transcript

import "time"

type RecType int

const (
	RecAssistant RecType = iota
	RecToolResults
	RecPrompt
	RecInterrupted
	RecSystem
	RecTitle
)

func (r RecType) String() string {
	switch r {
	case RecAssistant:
		return "assistant"
	case RecToolResults:
		return "tool_results"
	case RecPrompt:
		return "prompt"
	case RecInterrupted:
		return "interrupted"
	case RecSystem:
		return "system"
	case RecTitle:
		return "title"
	default:
		return "unknown"
	}
}

type Record struct {
	T         RecType
	UUID      string
	Timestamp time.Time

	// Assistant
	MessageID string
	Text      string
	Usage     *TokenUsage
	Model     string

	// Tool use/result
	Tools   []ToolUse
	Results []ToolResult

	// Prompt
	PromptText  string
	IsMeta      bool
	Command     string
	CommandArgs string
	IsCompact   bool
	AgentTask   string

	// System
	SystemType string // "api_error", "compact_boundary", "informational", "local_command"
	Fatal      bool
	ErrorText  string

	// Title
	TitleText string
	TitleKind string // "custom", "ai", "agent-name"

	// Agent/SubAgent
	AgentID string
}

type TokenUsage struct {
	Input         int64
	Output        int64
	CacheCreation int64
	CacheRead     int64
}

type ToolUse struct {
	UseID        string
	Name         string
	Target       string
	FilePath     string
	InputPreview string
}

type ToolResult struct {
	UseID       string
	Text        string
	IsError     bool
	Interrupted bool
	Denied      bool
	DenialKind  string
	AgentID     string
	Success     bool
	Added       int
	Removed     int
}
