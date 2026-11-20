package ui

import (
	"strings"
	"time"
	"unicode/utf8"

	"github.com/longpl-1902/claude-ui/internal/core"

	tea "charm.land/bubbletea/v2"
)

func (m Model) handleKey(msg tea.KeyPressMsg) (Model, tea.Cmd) {
	key := msg.String()

	// Global: Ctrl+C
	if key == "ctrl+c" {
		if m.busy() {
			return m, m.backend.Do(core.Action{Kind: core.ActionInterrupt, Key: m.logKey})
		}
		if m.mode == ModeInsert || m.mode == ModeCommand || m.mode == ModeSearch {
			m.mode = ModeNormal
			return m, nil
		}
		m.flash = ":q to quit"
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
		if m.busy() && !m.escTime.IsZero() && time.Since(m.escTime) < time.Second {
			m.escTime = time.Time{}
			return m, m.backend.Do(core.Action{Kind: core.ActionInterrupt, Key: m.logKey})
		}
		m.escTime = time.Now()
		return m, nil

	case "tab":
		return m.jumpAttention(1)

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
		m.escTime = time.Now()
		return m, nil

	case "enter":
		if m.promptText == "" {
			return m, nil
		}
		if card, ok := m.oldestQuestion(); ok {
			// Free text answers the current question ("other").
			text := m.promptText
			m.promptText = ""
			return m.recordAnswer(card, text)
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

	case "shift+enter", "alt+enter", "ctrl+j":
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
		m.promptText = dropLastRune(m.promptText)
		return m, nil

	default:
		text := tea.Key(msg).Text
		if text != "" {
			m.promptText += text
		} else {
			m.promptText += printable(key)
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
		if m.cmdText != "" {
			m.cmdText = dropLastRune(m.cmdText)
		} else {
			m.mode = ModeNormal
		}
		return m, nil

	default:
		m.cmdText += printable(key)
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
		m.searchText = dropLastRune(m.searchText)
		return m, nil

	default:
		m.searchText += printable(key)
		return m, nil
	}
}

func (m Model) handleEnter() (Model, tea.Cmd) {
	// Multi-select question: Enter confirms the current question.
	if card, ok := m.oldestQuestion(); ok {
		q := m.currentQuestion(card)
		if q.Multi {
			return m.confirmMulti(card)
		}
	}

	if len(m.sessions) == 0 && m.focus == FocusSessions {
		m.logKey = core.SessionKey{}
		m.logView = core.SessionView{}
		m.logItems = nil
		m.mode = ModeInsert
		return m, nil
	}

	if m.focus == FocusSessions {
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
						// Opening never forks; the backend forks on send.
						m.logKey = s.Key
						m.logFollow = true
						m.focus = FocusLog
						m.mode = ModeInsert
						m.resetQuestion()
						return m.refresh(), nil
					}
					row++
				}
			}
		}
		return m, nil
	}

	if m.focus == FocusLog {
		return m.toggleExpand()
	}

	return m, nil
}

// dropLastRune removes the final rune of s (not the final byte).
func dropLastRune(s string) string {
	if s == "" {
		return s
	}
	_, n := utf8.DecodeLastRuneInString(s)
	return s[:len(s)-n]
}

// printable returns key when it is one printable rune (space included).
func printable(key string) string {
	if key == "space" {
		return " "
	}
	if utf8.RuneCountInString(key) == 1 {
		r, _ := utf8.DecodeRuneInString(key)
		if r >= 32 && r != 127 {
			return key
		}
	}
	return ""
}

func sameKey(a, b core.SessionKey) bool {
	if a.SessionID != "" && b.SessionID != "" {
		return a.SessionID == b.SessionID
	}
	if a.DraftID != "" && b.DraftID != "" {
		return a.DraftID == b.DraftID
	}
	return false
}

// resetQuestion drops partial question progress.
func (m *Model) resetQuestion() {
	m.qReq = ""
	m.qIdx = 0
	m.qSel = nil
	m.qAns = nil
}

// restoreReturn goes back to where the user was before a needs-you jump.
func (m *Model) restoreReturn() {
	if !m.hasReturn {
		return
	}
	m.logKey = m.returnKey
	m.focus = m.returnFocus
	m.mode = m.returnMode
	m.hasReturn = false
	m.resetQuestion()
	if m.logKey.IsZero() {
		m.logView = core.SessionView{}
		m.logItems = nil
	}
}

func (m Model) oldestCard() (core.Card, bool) {
	if len(m.logView.Cards) == 0 {
		return core.Card{}, false
	}
	return m.logView.Cards[0], true
}

func (m Model) oldestQuestion() (core.Card, bool) {
	card, ok := m.oldestCard()
	if !ok || !card.IsQuestion() || card.IsPlan() {
		return core.Card{}, false
	}
	return card, true
}

func (m *Model) syncQuestion(card core.Card) {
	if card.RequestID != m.qReq {
		m.resetQuestion()
		m.qReq = card.RequestID
	}
	if m.qIdx >= len(card.Questions) {
		m.qIdx = 0
	}
}

func (m Model) currentQuestion(card core.Card) core.Question {
	idx := 0
	if card.RequestID == m.qReq && m.qIdx < len(card.Questions) {
		idx = m.qIdx
	}
	return card.Questions[idx]
}

// answered sends the action and returns focus to where the user was.
func (m Model) answered(a core.Action) (Model, tea.Cmd) {
	cmd := m.backend.Do(a)
	m.resetQuestion()
	m.restoreReturn()
	return m.refresh(), cmd
}

func (m Model) handleAllow(forSession bool) (Model, tea.Cmd) {
	card, ok := m.oldestCard()
	if !ok || !card.IsPermission() {
		return m, nil
	}
	if forSession && (!card.CanAllowSession || card.IsPlan()) {
		return m, nil
	}
	return m.answered(core.Action{
		Kind:       core.ActionAnswer,
		Key:        m.logKey,
		RequestID:  card.RequestID,
		Allow:      true,
		ForSession: forSession,
	})
}

func (m Model) handleDeny(message string) (Model, tea.Cmd) {
	card, ok := m.oldestCard()
	if !ok {
		return m, nil
	}
	return m.answered(core.Action{
		Kind:      core.ActionAnswer,
		Key:       m.logKey,
		RequestID: card.RequestID,
		Allow:     false,
		Message:   message,
	})
}

func (m Model) handleOptionPick(n int) (Model, tea.Cmd) {
	card, ok := m.oldestCard()
	if !ok {
		return m, nil
	}
	if card.IsPlan() {
		if n == 1 {
			return m.handleAllow(false)
		}
		return m, nil
	}
	if !card.IsQuestion() {
		return m, nil
	}
	m.syncQuestion(card)
	q := card.Questions[m.qIdx]
	if n < 1 || n > len(q.Options) {
		return m, nil
	}
	if q.Multi {
		sel := make(map[int]bool, len(m.qSel)+1)
		for k, v := range m.qSel {
			sel[k] = v
		}
		sel[n-1] = !sel[n-1]
		m.qSel = sel
		return m, nil
	}
	return m.recordAnswer(card, q.Options[n-1].Label)
}

// confirmMulti commits the multi-select toggles of the current question.
func (m Model) confirmMulti(card core.Card) (Model, tea.Cmd) {
	m.syncQuestion(card)
	q := card.Questions[m.qIdx]
	var labels []string
	for i, o := range q.Options {
		if m.qSel[i] {
			labels = append(labels, o.Label)
		}
	}
	if len(labels) == 0 {
		m.flash = "pick at least one option"
		m.flashAt = time.Now()
		return m, nil
	}
	return m.recordAnswer(card, strings.Join(labels, ", "))
}

// recordAnswer stores the answer for the current question, advances, and sends
// ActionAnswer once every question has one.
func (m Model) recordAnswer(card core.Card, label string) (Model, tea.Cmd) {
	m.syncQuestion(card)
	q := card.Questions[m.qIdx]
	ans := make(map[string]string, len(m.qAns)+1)
	for k, v := range m.qAns {
		ans[k] = v
	}
	ans[q.Text] = label
	m.qAns = ans
	m.qSel = nil
	m.qIdx++
	if m.qIdx < len(card.Questions) {
		return m, nil
	}
	return m.answered(core.Action{
		Kind:      core.ActionAnswer,
		Key:       m.logKey,
		RequestID: card.RequestID,
		Allow:     true,
		Answers:   ans,
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
	_, _, all := m.backend.Attention()
	var items []core.Attention
	for _, att := range all {
		if att.Severity == core.SeverityBlocked {
			items = append(items, att)
		}
	}
	if len(items) == 0 {
		return m, nil
	}
	cur := -1
	for i, att := range items {
		if sameKey(att.Key, m.logKey) {
			cur = i
			break
		}
	}
	var next int
	switch {
	case cur < 0 && dir > 0:
		next = 0
	case cur < 0:
		next = len(items) - 1
	default:
		next = ((cur+dir)%len(items) + len(items)) % len(items)
	}
	if !m.hasReturn {
		m.hasReturn = true
		m.returnKey = m.logKey
		m.returnFocus = m.focus
		m.returnMode = m.mode
	}
	m.logKey = items[next].Key
	m.logFollow = true
	m.focus = FocusLog
	m.mode = ModeNormal
	m.resetQuestion()
	return m.refresh(), nil
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
  Enter      open session (INSERT); Enter confirms multi-select
  i/I        INSERT mode (I clears)
  Tab, ]n/[n next/prev needs-you item
  Ctrl+w w   switch pane (Ctrl+w h/l)
  a/A        allow / approve plan (A = for session)
  d          deny / reject plan
  1-9        pick option (multi-select toggles)
  Ctrl+C     interrupt running turn (Esc Esc too)
  /          search
  :          command line
  ?          this help
  q          quit

 INSERT mode
  Enter       send prompt
  Shift/Alt+Enter  newline
  Esc         back to NORMAL

 Commands
  :new [dir]   new session
  :fork        fork selected session (explicit)
  :stop        stop controlled session
  :model M     set model
  :mode M      set permission mode
  :account     switch account
  :ctx         context usage
  :mcp         MCP status
  :q           quit

Press Esc to close`
}
