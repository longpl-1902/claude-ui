package control

import (
	"encoding/json"
	"errors"
	"time"

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

// Errors returned by Session.
var (
	ErrNotBusy        = errors.New("session is not running a turn")
	ErrNotLive        = errors.New("session is not live")
	ErrUnknownRequest = errors.New("unknown request id")
	ErrClosed         = errors.New("session is closed")
)

// Deps are the injectable dependencies of a Session. Zero values use defaults.
type Deps struct {
	Spawner        Spawner
	BaseEnv        []string
	Now            func() time.Time
	StopGrace      time.Duration
	RequestTimeout time.Duration
	BatchWindow    time.Duration
}

// Answer is the user's decision on a pending permission, question or plan card.
type Answer struct {
	Allow      bool
	ForSession bool
	Message    string
	Answers    map[string]string
}

// Info is a snapshot of a session.
type Info struct {
	State     State
	SessionID string
	Model     string
	Mode      string
	Version   string
	Commands  []string
	Models    []string
	CostUSD   float64
	CtxPct    float64
	PID       int
	Error     string
	Spawns    int
}
