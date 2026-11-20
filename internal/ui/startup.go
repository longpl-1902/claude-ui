package ui

import (
	"strings"

	"github.com/longpl-1902/claude-ui/internal/core"
	"github.com/longpl-1902/claude-ui/internal/mdlite"

	tea "charm.land/bubbletea/v2"
	"charm.land/lipgloss/v2"
)

// Options configures NewModel.
type Options struct {
	// ShowPicker shows the account picker first (only when more than one
	// account exists).
	ShowPicker bool
}

// pickerState is the account picker's state, embedded in Model as m.picker.
type pickerState struct {
	cursor   int
	accounts []core.Account
	fromCmd  bool // opened by :account (esc/q goes back instead of quitting)
}

// NewModel builds the root model. The prompt starts in INSERT mode with the
// log pane focused (the cursor is already in the prompt line).
func NewModel(b Backend, o Options) Model {
	acct := b.Account()
	accentStr := acct.Color
	if accentStr == "" {
		accentStr = "#5B9BD5"
	}

	m := Model{
		backend:      b,
		mode:         ModeInsert,
		focus:        FocusLog,
		screen:       ScreenMain,
		showSessions: true,
		sessFolds:    make(map[string]bool),
		expanded:     make(map[string]bool),
		logFollow:    true,
		acct:         acct,
		accent:       lipgloss.Color(accentStr),
		mdStyles:     mdlite.DefaultStyles(),
	}

	if accts := b.Accounts(); o.ShowPicker && len(accts) > 1 {
		m.screen = ScreenPicker
		m.picker = pickerState{accounts: accts, cursor: indexOfAccount(accts, acct.ID)}
	}
	return m
}

// openPicker shows the account picker from inside the app (:account).
func (m Model) openPicker() Model {
	accts := m.backend.Accounts()
	m.picker = pickerState{
		accounts: accts,
		cursor:   indexOfAccount(accts, m.acct.ID),
		fromCmd:  true,
	}
	m.screen = ScreenPicker
	return m
}

func indexOfAccount(accts []core.Account, id core.AccountID) int {
	for i, a := range accts {
		if a.ID == id {
			return i
		}
	}
	return 0
}

// pickerList returns the live account list (sign-in and "always use" change
// it while the picker is open), falling back to the list captured at open.
func (m Model) pickerList() []core.Account {
	if accts := m.backend.Accounts(); len(accts) > 0 {
		return accts
	}
	return m.picker.accounts
}

func (m Model) handlePicker(key string) (Model, tea.Cmd) {
	accts := m.pickerList()
	if m.picker.cursor >= len(accts) {
		m.picker.cursor = len(accts) - 1
	}
	if m.picker.cursor < 0 {
		m.picker.cursor = 0
	}
	switch key {
	case "j", "down":
		if m.picker.cursor < len(accts)-1 {
			m.picker.cursor++
		}
	case "k", "up":
		if m.picker.cursor > 0 {
			m.picker.cursor--
		}
	case "q", "ctrl+c", "esc":
		if m.picker.fromCmd {
			m.screen = ScreenMain
			return m, nil
		}
		return m, tea.Quit
	case "enter", "u", "s":
		if len(accts) == 0 {
			return m, nil
		}
		a := accts[m.picker.cursor]
		if key == "s" || (key == "enter" && !a.SignedIn) {
			return m, m.backend.Do(core.Action{Kind: core.ActionSignIn, ID: string(a.ID)})
		}
		act := core.Action{Kind: core.ActionSwitchAccount, ID: string(a.ID)}
		if key == "u" {
			act.Text = "always"
			if a.AlwaysUse {
				act.Text = "never"
			}
		}
		m.acct = a
		if a.Color != "" {
			m.accent = lipgloss.Color(a.Color)
		}
		m.screen = ScreenMain
		m.mode = ModeInsert
		return m, m.backend.Do(act)
	}
	return m, nil
}

func (m Model) viewPicker(w, h int) string {
	title := lipgloss.NewStyle().Bold(true).Render("Select account")
	hint := lipgloss.NewStyle().Faint(true).Render("j/k move · Enter use · u always use · s sign in · q quit")
	faint := lipgloss.NewStyle().Faint(true)
	red := lipgloss.NewStyle().Foreground(lipgloss.Color("#E06C75")).Faint(true)

	current := m.backend.Account().ID
	var lines []string
	lines = append(lines, title, "")
	for i, a := range m.pickerList() {
		accent := m.accent
		if a.Color != "" {
			accent = lipgloss.Color(a.Color)
		}
		selected := i == m.picker.cursor

		cursor := "  "
		if selected {
			cursor = "▸ "
		}
		swatch := lipgloss.NewStyle().Foreground(accent).Render("●")
		nameStyle := lipgloss.NewStyle().Foreground(accent)
		if selected {
			nameStyle = nameStyle.Bold(true)
		}
		line := cursor + swatch + " " + nameStyle.Render(a.Name)
		if a.SignedIn && a.Email != "" {
			line += "  " + faint.Render(a.Email)
		} else if !a.SignedIn {
			line += "  " + red.Render("not signed in")
		}
		if a.Org != "" {
			line += "  " + faint.Render(a.Org)
		}
		if a.AlwaysUse {
			line += "  " + faint.Render("(always)")
		}
		if a.ID == current {
			line += "  " + faint.Render("(current)")
		}
		lines = append(lines, line)
	}
	lines = append(lines, "", hint)

	box := lipgloss.NewStyle().
		Border(lipgloss.RoundedBorder()).
		BorderForeground(m.accent).
		Padding(1, 3).
		Render(strings.Join(lines, "\n"))

	return lipgloss.Place(w, h, lipgloss.Center, lipgloss.Center, box)
}
