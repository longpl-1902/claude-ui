package core

import "time"

type AccountID string

type Account struct {
	ID        AccountID
	Name      string
	Color     string
	ConfigDir string
	Kind      string // "company", "personal", ""
	Email     string
	Org       string
	SignedIn  bool
}

type SessionKey struct {
	Account   AccountID
	SessionID string
	DraftID   string
}

func (k SessionKey) IsZero() bool { return k.SessionID == "" && k.DraftID == "" }

type Status int

const (
	StatusDone Status = iota
	StatusWaiting
	StatusRunning
	StatusNeedsYou
)

func (s Status) String() string {
	switch s {
	case StatusDone:
		return "done"
	case StatusWaiting:
		return "idle"
	case StatusRunning:
		return "run"
	case StatusNeedsYou:
		return "needs-you"
	default:
		return "?"
	}
}

type Severity int

const (
	SeverityBlocked Severity = iota
	SeverityIdle
)

type Source int

const (
	SourceUnknown Source = iota
	SourceCLI
	SourceVSCode
	SourceAC
	SourceSDK
)

func SourceFromString(s string) Source {
	switch s {
	case "cli":
		return SourceCLI
	case "vscode":
		return SourceVSCode
	case "ac":
		return SourceAC
	case "sdk":
		return SourceSDK
	default:
		return SourceUnknown
	}
}

func (s Source) String() string {
	switch s {
	case SourceCLI:
		return ""
	case SourceVSCode:
		return "vs"
	case SourceAC:
		return "ac"
	case SourceSDK:
		return "sdk"
	default:
		return ""
	}
}

type Ctl struct {
	Kind CtlKind
	PID  int
}

type CtlKind int

const (
	CtlNone CtlKind = iota
	CtlMine
	CtlOtherAC
	CtlElsewhere
)

type SessionSummary struct {
	Key          SessionKey
	Title        string
	ProjectKey   string
	ProjectName  string
	ProjectRoot  string
	Cwd          string
	Branch       string
	Status       Status
	Reason       string
	Source       Source
	Ctl          Ctl
	LastActivity time.Time
	Tokens       int64
	Model        string
	Blocked      bool
	Idle         bool
}

type ItemKind int

const (
	ItemPrompt ItemKind = iota
	ItemCommand
	ItemText
	ItemTool
	ItemAgent
	ItemNotice
	ItemInterrupted
	ItemCompactSummary
)

type Item struct {
	ID    string
	Kind  ItemKind
	Time  time.Time
	Text  string
	Tool  *ToolItem
	Agent *AgentItem
}

type ToolItem struct {
	UseID       string
	Name        string
	Target      string
	FilePath    string
	Input       string
	Result      string
	Open        bool
	Failed      bool
	Interrupted bool
	Added       int
	Removed     int
}

type AgentItem struct {
	AgentID   string
	Name      string
	Type      string
	Status    string
	ToolCalls int
	Tokens    int64
}

type Card struct {
	RequestID       string
	ToolName        string
	DisplayName     string
	Preview         string
	Description     string
	Reason          string
	BlockedPath     string
	Questions       []Question
	CanAllowSession bool
	Since           time.Time
}

func (c Card) IsPermission() bool { return len(c.Questions) == 0 }
func (c Card) IsQuestion() bool   { return len(c.Questions) > 0 }

type Question struct {
	Text    string
	Header  string
	Options []Option
	Multi   bool
}

type Option struct {
	Label       string
	Description string
}

type CtlInfo struct {
	State    string
	Model    string
	Mode     string
	CtxPct   float64
	CostUSD  float64
	Version  string
	Commands []string
	Models   []string
	Error    string
}

type SessionView struct {
	Summary   SessionSummary
	Items     []Item
	Typing    string
	Thinking  bool
	Cards     []Card
	Ctl       *CtlInfo
	Notices   []string
	AgentPath []string
}

type Attention struct {
	Key      SessionKey
	AgentID  string
	Kind     string
	Detail   string
	Severity Severity
	Since    time.Time
}

type ActionKind int

const (
	ActionSend ActionKind = iota
	ActionAnswer
	ActionInterrupt
	ActionStop
	ActionNewDraft
	ActionResume
	ActionFork
	ActionSetModel
	ActionSetMode
	ActionRename
	ActionCtx
	ActionMcp
	ActionOpenWT
	ActionOpenEditor
	ActionYank
	ActionSwitchAccount
	ActionSignIn
	ActionRefresh
)

type Action struct {
	Kind       ActionKind
	Key        SessionKey
	Text       string
	RequestID  string
	Allow      bool
	ForSession bool
	Message    string
	Answers    map[string]string
	Dir        string
	Path       string
	Line       int
	ID         string
}

type ChangedMsg struct{}
type ErrMsg struct{ Text string }
type InfoMsg struct {
	Title string
	Lines []string
}
