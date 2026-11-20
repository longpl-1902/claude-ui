package ui

import (
	"github.com/longpl-1902/claude-ui/internal/core"

	tea "charm.land/bubbletea/v2"
)

type Backend interface {
	Account() core.Account
	Accounts() []core.Account
	Sessions(all bool) []core.SessionSummary
	View(key core.SessionKey, agentID string) (core.SessionView, bool)
	Attention() (mine, others int, items []core.Attention)
	UsageToday() int64
	Do(a core.Action) tea.Cmd
	Completions(kind string, prefix string) []string
	SetNotify(func())
}
