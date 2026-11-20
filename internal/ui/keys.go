package ui

import (
	"strings"
	"time"

	"github.com/longpl-1902/claude-ui/internal/core"

	tea "charm.land/bubbletea/v2"
)

func (m Model) handleKey(msg tea.KeyPressMsg) (Model, tea.Cmd) {
	key := msg.String()

	// Global: Ctrl+C
	if key == "ctrl+c" {
		if m.mode == ModeInsert || m.mode == ModeCommand || m.mode == ModeSearch {
			m.mode = ModeNormal
			return m, nil
		}
		if !m.logKey.IsZero() && m.logView.Ctl != nil && m.logView.Ctl.State == "busy" {
			return m, m.backend.Do(core.Action{Kind: core.ActionInterrupt, Key: m.logKey})
		}
		m.flash = "Press :q to quit"
		m.flashAt = time.Now()
		return m, nil
	}

	if m.screen == ScreenPicker {
		return m.handlePicker(key)
	}

	switch m.mode {
	case ModeInsert:
		return m.handleInsert(key, msg)
	case ModeCommand:
		return m.handleCommand(key)
	case ModeSearch:
		return m.handleSearch(key)
	default:
		return m.handleNormal(key, msg)
	}
}

func (m Model) handleNormal(key string, msg tea.KeyPressMsg) (Model, tea.Cmd) {
	// Two-key sequences
	if m.keyBuf != "" {
		seq := m.keyBuf + key
		m.keyBuf = ""
		return m.handleSequence(seq)
	}

	switch key {
	case "?":
		m.overlay = helpText()
		return m, nil

	case ":":
		m.mode = ModeCommand
		m.cmdText = ""
		return m, nil

	case "i":
		m.mode = ModeInsert
		return m, nil

	case "I":
		m.mode = ModeInsert
		m.promptText = ""
		return m, nil

	case "escape", "esc":
		if m.overlay != "" {
			m.overlay = ""
			return m, nil
		}
		m.mode = ModeNormal
		return m, nil

	case "tab":
		if m.focus == FocusSessions {
			m.focus = FocusLog
		} else {
			m.focus = FocusSessions
		}
		return m, nil

	case "enter":
		return m.handleEnter()

	case "j", "down":
		return m.moveCursor(1)

	case "k", "up":
		return m.moveCursor(-1)

	case "a":
		return m.handleAllow(false)

	case "A":
		return m.handleAllow(true)

	case "d":
		return m.handleDeny("")

	case "D":
		m.mode = ModeInsert
		// TODO: prompt for deny reason
		return m, nil

	case "1", "2", "3", "4", "5", "6", "7", "8", "9":
		return m.handleOptionPick(int(key[0] - '0'))

	case "q":
		if m.overlay != "" {
			m.overlay = ""
			return m, nil
		}
		return m, tea.Quit

	case "/":
		m.mode = ModeSearch
		m.searchText = ""
		return m, nil

	case "g", "]", "[", "z", "ctrl+w":
		m.keyBuf = key
		m.keyTime = time.Now()
		return m, nil
	}

	return m, nil
}

func (m Model) handleSequence(seq string) (Model, tea.Cmd) {
	switch seq {
	case "gg":
		if m.focus == FocusSessions {
			m.sessCursor = 0
		} else {
			m.logOffset = 0
			m.logFollow = false
		}
		return m, nil

	case "]n":
		return m.jumpAttention(1)
	case "[n":
		return m.jumpAttention(-1)

	case "za":
		if m.focus == FocusSessions {
			return m.toggleFold()
		}
		return m.toggleExpand()

	case "ctrl+ww":
		if m.focus == FocusSessions {
			m.focus = FocusLog
		} else {
			m.focus = FocusSessions
		}
		return m, nil

	case "ctrl+wh":
		m.focus = FocusSessions
		return m, nil

	case "ctrl+wl":
		m.focus = FocusLog
		return m, nil

	case "ga":
		m.allAccounts = !m.allAccounts
		return m.refresh(), nil
	case "gr":
		return m, m.backend.Do(core.Action{Kind: core.ActionRefresh})
	}

	return m, nil
}

func (m Model) handleInsert(key string, msg tea.KeyPressMsg) (Model, tea.Cmd) {
	switch key {
	case "escape", "esc":
		m.mode = ModeNormal
		return m, nil

	case "enter":
		if m.promptText == "" {
			return m, nil
		}
		text := m.promptText
		m.promptText = ""
		m.promptHist = append(m.promptHist, text)
		m.promptIdx = len(m.promptHist)
		return m, m.backend.Do(core.Action{
			Kind: core.ActionSend,
			Key:  m.logKey,
			Text: text,
		})

	case "alt+enter", "ctrl+j":
		m.promptText += "\n"
		return m, nil

	case "ctrl+u":
		m.promptText = ""
		return m, nil

	case "ctrl+p", "up":
		if m.promptIdx > 0 {
			m.promptIdx--
			m.promptText = m.promptHist[m.promptIdx]
		}
		return m, nil

	case "ctrl+n", "down":
		if m.promptIdx < len(m.promptHist)-1 {
			m.promptIdx++
			m.promptText = m.promptHist[m.promptIdx]
		} else {
			m.promptIdx = len(m.promptHist)
			m.promptText = ""
		}
		return m, nil

	case "backspace":
		if len(m.promptText) > 0 {
			m.promptText = m.promptText[:len(m.promptText)-1]
		}
		return m, nil

	default:
		text := tea.Key(msg).Text
		if text != "" {
			m.promptText += text
		} else if len(key) == 1 && key[0] >= 32 {
			m.promptText += key
		}
		return m, nil
	}
}

func (m Model) handleCommand(key string) (Model, tea.Cmd) {
	switch key {
	case "escape", "esc":
		m.mode = ModeNormal
		m.cmdText = ""
		return m, nil

	case "enter":
		cmd := m.cmdText
		m.mode = ModeNormal
		m.cmdText = ""
		return m.executeCommand(cmd)

	case "backspace":
		if len(m.cmdText) > 0 {
			m.cmdText = m.cmdText[:len(m.cmdText)-1]
		} else {
			m.mode = ModeNormal
		}
		return m, nil

	default:
		if len(key) == 1 && key[0] >= 32 {
			m.cmdText += key
		}
		return m, nil
	}
}

func (m Model) handleSearch(key string) (Model, tea.Cmd) {
	switch key {
	case "escape", "esc":
		m.mode = ModeNormal
		m.searchText = ""
		return m, nil

	case "enter":
		m.mode = ModeNormal
		return m, nil

	case "backspace":
		if len(m.searchText) > 0 {
			m.searchText = m.searchText[:len(m.searchText)-1]
		}
		return m, nil

	default:
		if len(key) == 1 && key[0] >= 32 {
			m.searchText += key
		}
		return m, nil
	}
}

func (m Model) handleEnter() (Model, tea.Cmd) {
	if m.focus == FocusSessions && len(m.sessions) > 0 {
		groups := m.groupSessions()
		row := 0
		for _, g := range groups {
			if row == m.sessCursor {
				return m.toggleFold()
			}
			row++
			if !m.sessFolds[g.key] {
				for _, s := range g.sessions {
					if row == m.sessCursor {
						m.logKey = s.Key
						m.logFollow = true
						m.focus = FocusLog
						m.mode = ModeInsert
						// Auto-resume/fork logic
						if s.Ctl.Kind == CtlElsewhereHere(s) {
							// Fork if live elsewhere
							return m, m.backend.Do(core.Action{Kind: core.ActionFork, Key: s.Key})
						}
						return m.refresh(), nil
					}
					row++
				}
			}
		}
	}

	if m.focus == FocusLog {
		return m.toggleExpand()
	}

	return m, nil
}

func CtlElsewhereHere(s core.SessionSummary) core.CtlKind {
	if s.Ctl.Kind == core.CtlElsewhere || s.Ctl.Kind == core.CtlOtherAC {
		return s.Ctl.Kind
	}
	return core.CtlNone
}

func (m Model) handleAllow(forSession bool) (Model, tea.Cmd) {
	if len(m.logView.Cards) == 0 {
		return m, nil
	}
	card := m.logView.Cards[len(m.logView.Cards)-1]
	if !card.IsPermission() {
		return m, nil
	}
	return m, m.backend.Do(core.Action{
		Kind:       core.ActionAnswer,
		Key:        m.logKey,
		RequestID:  card.RequestID,
		Allow:      true,
		ForSession: forSession,
	})
}

func (m Model) handleDeny(message string) (Model, tea.Cmd) {
	if len(m.logView.Cards) == 0 {
		return m, nil
	}
	card := m.logView.Cards[len(m.logView.Cards)-1]
	return m, m.backend.Do(core.Action{
		Kind:      core.ActionAnswer,
		Key:       m.logKey,
		RequestID: card.RequestID,
		Allow:     false,
		Message:   message,
	})
}

func (m Model) handleOptionPick(n int) (Model, tea.Cmd) {
	if len(m.logView.Cards) == 0 {
		return m, nil
	}
	card := m.logView.Cards[len(m.logView.Cards)-1]
	if !card.IsQuestion() || len(card.Questions) == 0 {
		return m, nil
	}
	q := card.Questions[0]
	if n < 1 || n > len(q.Options) {
		return m, nil
	}
	opt := q.Options[n-1]
	answers := map[string]string{q.Text: opt.Label}
	return m, m.backend.Do(core.Action{
		Kind:      core.ActionAnswer,
		Key:       m.logKey,
		RequestID: card.RequestID,
		Allow:     true,
		Answers:   answers,
	})
}

func (m Model) moveCursor(delta int) (Model, tea.Cmd) {
	if m.focus == FocusSessions {
		m.sessCursor += delta
		maxRow := m.sessRowCount() - 1
		if m.sessCursor < 0 {
			m.sessCursor = 0
		}
		if m.sessCursor > maxRow {
			m.sessCursor = maxRow
		}
	} else {
		m.logOffset += delta
		if m.logOffset < 0 {
			m.logOffset = 0
		}
		m.logFollow = false
	}
	return m, nil
}

func (m Model) sessRowCount() int {
	groups := m.groupSessions()
	count := 0
	for _, g := range groups {
		count++ // group header
		if !m.sessFolds[g.key] {
			count += len(g.sessions)
		}
	}
	if count == 0 {
		count = 1
	}
	return count
}

func (m Model) toggleFold() (Model, tea.Cmd) {
	groups := m.groupSessions()
	row := 0
	for _, g := range groups {
		if row == m.sessCursor {
			m.sessFolds[g.key] = !m.sessFolds[g.key]
			return m, nil
		}
		row++
		if !m.sessFolds[g.key] {
			row += len(g.sessions)
		}
	}
	return m, nil
}

func (m Model) toggleExpand() (Model, tea.Cmd) {
	if m.logCursor >= 0 && m.logCursor < len(m.logItems) {
		id := m.logItems[m.logCursor].item.ID
		if id != "" {
			m.expanded[id] = !m.expanded[id]
		}
	}
	return m, nil
}

func (m Model) jumpAttention(dir int) (Model, tea.Cmd) {
	_, _, items := m.backend.Attention()
	if len(items) == 0 {
		return m, nil
	}
	// Find first blocked item
	for _, att := range items {
		if att.Severity == core.SeverityBlocked {
			m.logKey = att.Key
			m.logFollow = true
			return m.refresh(), nil
		}
	}
	return m, nil
}

func (m Model) executeCommand(cmd string) (Model, tea.Cmd) {
	parts := strings.Fields(cmd)
	if len(parts) == 0 {
		return m, nil
	}

	switch parts[0] {
	case "q", "q!":
		return m, tea.Quit

	case "new":
		dir := ""
		if len(parts) > 1 {
			dir = strings.Join(parts[1:], " ")
		}
		return m, m.backend.Do(core.Action{Kind: core.ActionNewDraft, Dir: dir})

	case "fork":
		if !m.logKey.IsZero() {
			return m, m.backend.Do(core.Action{Kind: core.ActionFork, Key: m.logKey})
		}
		return m, nil

	case "stop":
		if !m.logKey.IsZero() {
			return m, m.backend.Do(core.Action{Kind: core.ActionStop, Key: m.logKey})
		}
		return m, nil

	case "interrupt":
		if !m.logKey.IsZero() {
			return m, m.backend.Do(core.Action{Kind: core.ActionInterrupt, Key: m.logKey})
		}
		return m, nil

	case "model":
		if len(parts) > 1 {
			return m, m.backend.Do(core.Action{Kind: core.ActionSetModel, Key: m.logKey, Text: parts[1]})
		}
		return m, nil

	case "mode":
		if len(parts) > 1 {
			return m, m.backend.Do(core.Action{Kind: core.ActionSetMode, Key: m.logKey, Text: parts[1]})
		}
		return m, nil

	case "account":
		if len(parts) > 1 {
			return m, m.backend.Do(core.Action{Kind: core.ActionSwitchAccount, ID: parts[1]})
		}
		return m.openPicker(), nil

	case "ctx":
		return m, m.backend.Do(core.Action{Kind: core.ActionCtx, Key: m.logKey})

	case "mcp":
		return m, m.backend.Do(core.Action{Kind: core.ActionMcp, Key: m.logKey})

	case "rename":
		if len(parts) > 1 {
			return m, m.backend.Do(core.Action{Kind: core.ActionRename, Key: m.logKey, Text: strings.Join(parts[1:], " ")})
		}
		return m, nil

	case "help":
		m.overlay = helpText()
		return m, nil
	}

	m.flash = "Unknown command: " + parts[0]
	m.flashAt = time.Now()
	return m, nil
}

func helpText() string {
	return `ac — Agent Console

 NORMAL mode
  j/k        move cursor
  Enter      open/resume session (INSERT)
  i/I        INSERT mode (I clears)
  Tab        switch pane
  ]n/[n      next/prev needs-you item
  a/A        allow (A = for session)
  d          deny
  1-9        pick option
  /          search
  :          command line
  ?          this help
  q          quit

 INSERT mode
  Enter       send prompt
  Alt+Enter   newline
  Esc         back to NORMAL

 Commands
  :new [dir]   new session
  :fork        fork selected session
  :stop        stop controlled session
  :model M     set model
  :mode M      set permission mode
  :account     switch account
  :ctx         context usage
  :mcp         MCP status
  :q           quit

Press Esc to close`
}
