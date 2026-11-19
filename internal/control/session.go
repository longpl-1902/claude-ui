package control

import (
	"encoding/json"

	"github.com/longpl-1902/claude-ui/internal/core"
)

type State int

const (
	StateDraft State = iota
	StateStarting
	StateIdle
	StateBusy
	StateStopping
	StateExited
)

func (s State) String() string {
	switch s {
	case StateDraft:
		return "draft"
	case StateStarting:
		return "starting"
	case StateIdle:
		return "idle"
	case StateBusy:
		return "busy"
	case StateStopping:
		return "stopping"
	case StateExited:
		return "exited"
	default:
		return "unknown"
	}
}

type EventKind int

const (
	EvState EventKind = iota
	EvInit
	EvTyping
	EvTypingClear
	EvThinking
	EvPermission
	EvPermissionResolved
	EvTurnEnd
	EvNotice
	EvDetails
	EvExited
)

type Event struct {
	Kind      EventKind
	SessionID string
	Model     string
	Version   string
	Commands  []string
	Text      string
	Thinking  bool
	Card      *core.Card
	RequestID string
	Cost      float64
	Usage     *ResultUsage
	Code      int
	Error     string
	Info      json.RawMessage
}
