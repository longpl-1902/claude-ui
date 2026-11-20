package ui

import (
	"fmt"
	"image/color"
	"strings"
	"time"

	"github.com/charmbracelet/x/ansi"
	"github.com/longpl-1902/claude-ui/internal/core"
	"github.com/longpl-1902/claude-ui/internal/mdlite"

	tea "charm.land/bubbletea/v2"
	"charm.land/lipgloss/v2"
)

type Mode int

const (
	ModeNormal Mode = iota
	ModeInsert
	ModeCommand
	ModeSearch
)

func (m Mode) String() string {
	switch m {
	case ModeNormal:
		return "NORMAL"
	case ModeInsert:
		return "INSERT"
	case ModeCommand:
		return "COMMAND"
	case ModeSearch:
		return "SEARCH"
	default:
		return "?"
	}
}

type Focus int

const (
	FocusSessions Focus = iota
	FocusLog
)

type Screen int

const (
	ScreenMain Screen = iota
	ScreenPicker
	ScreenDiff
)

type tickMsg time.Time

type Model struct {
	backend Backend
	mode    Mode
	focus   Focus
	screen  Screen
	width   int
	height  int
	ready   bool

	// Sessions pane
	sessions     []core.SessionSummary
	sessCursor   int
	sessOffset   int
	sessFolds    map[string]bool // project key -> folded
	allAccounts  bool
	showSessions bool

	// Log pane
	logKey    core.SessionKey
	logView   core.SessionView
	logItems  []logItem
	logCursor int
	logOffset int
	logFollow bool
	expanded  map[string]bool // item ID -> expanded

	// Prompt
	promptText string
	promptHist []string
	promptIdx  int

	// Command line
	cmdText   string
	cmdActive bool

	// Search
	searchText string
	searchHits []int

	// Overlay
	overlay string
	flash   string
	flashAt time.Time

	// Status info
	acct       core.Account
	needsMine  int
	needsOther int
	tokToday   int64

	// Account picker (see startup.go)
	picker pickerState

	// Key sequence buffer
	keyBuf  string
	keyTime time.Time

	// Needs-you jump: where to go back to after answering.
	hasReturn   bool
	returnKey   core.SessionKey
	returnFocus Focus
	returnMode  Mode

	// Question card progress (oldest card only).
	qReq string            // request id the progress belongs to
	qIdx int               // current question index
	qSel map[int]bool      // multi-select toggles for the current question
	qAns map[string]string // answers collected so far, by question text

	// Esc Esc detection.
	escTime time.Time

	// Styles
	mdStyles mdlite.Styles
	accent   color.Color
}

type logItem struct {
	item     core.Item
	rendered []string
}

func (m Model) Init() tea.Cmd {
	return tea.Batch(
		m.tick(),
		func() tea.Msg {
			return core.ChangedMsg{}
		},
	)
}

func (m Model) Update(msg tea.Msg) (tea.Model, tea.Cmd) {
	switch msg := msg.(type) {
	case tea.WindowSizeMsg:
		m.width = msg.Width
		m.height = msg.Height
		m.ready = true
		return m, nil

	case tickMsg:
		if m.flash != "" && time.Since(m.flashAt) > 5*time.Second {
			m.flash = ""
		}
		if m.busy() || m.anyRunning() {
			m.refresh()
		}
		return m, m.tick()

	case core.ChangedMsg:
		return m.refresh(), nil

	case core.OpenMsg:
		m.logKey = msg.Key
		m.focus = FocusLog
		m.logFollow = true
		m.resetQuestion()
		return m.refresh(), nil

	case core.ErrMsg:
		m.flash = msg.Text
		m.flashAt = time.Now()
		return m, nil

	case core.InfoMsg:
		m.overlay = formatInfo(msg)
		return m, nil

	case tea.KeyPressMsg:
		return m.handleKey(msg)
	}

	return m, nil
}

func (m Model) View() tea.View {
	if !m.ready {
		v := tea.NewView("")
		v.AltScreen = true
		return v
	}

	var content string
	if m.screen == ScreenPicker {
		content = m.viewPicker(m.width, m.height)
	} else if m.overlay != "" {
		content = m.viewOverlay(m.viewMain())
	} else {
		content = m.viewMain()
	}

	v := tea.NewView(content)
	v.AltScreen = true
	return v
}

func (m Model) viewMain() string {
	w := m.width
	h := m.height

	statusH := 1
	promptH := m.promptHeight()
	bodyH := h - statusH - promptH
	if bodyH < 1 {
		bodyH = 1
	}

	sessW := 0
	logW := w
	if m.showSessions && w >= 80 {
		sessW = min(w/3, 30)
		logW = w - sessW - 1
	}

	var body string
	if sessW > 0 {
		sessPane := m.viewSessions(sessW, bodyH)
		logPane := m.viewLog(logW, bodyH)
		sep := strings.Repeat("│\n", bodyH)
		sep = strings.TrimRight(sep, "\n")
		body = lipgloss.JoinHorizontal(lipgloss.Top, sessPane, sep, logPane)
	} else {
		body = m.viewLog(logW, bodyH)
	}

	status := m.viewStatus(w)
	prompt := m.viewPrompt(w)

	return body + "\n" + status + "\n" + prompt
}

func (m Model) viewSessions(w, h int) string {
	var lines []string
	title := fmt.Sprintf(" Sessions · %s ", m.acct.Name)
	titleStyle := lipgloss.NewStyle().Bold(true).Foreground(m.accent)
	lines = append(lines, truncPad(titleStyle.Render(title), w))

	groups := m.groupSessions()
	row := 0
	for _, g := range groups {
		folded := m.sessFolds[g.key]
		prefix := "▾"
		if folded {
			prefix = "▸"
		}
		badge := ""
		blocked := 0
		for _, s := range g.sessions {
			if s.Blocked {
				blocked++
			}
		}
		if blocked > 0 {
			badge = fmt.Sprintf(" %d!", blocked)
		}
		groupLine := fmt.Sprintf("%s %s%s", prefix, g.name, badge)
		style := lipgloss.NewStyle()
		if row == m.sessCursor {
			style = style.Reverse(true)
		}
		lines = append(lines, truncPad(style.Render(groupLine), w))
		row++

		if !folded {
			for _, s := range g.sessions {
				glyph := statusGlyph(s.Status)
				badge := statusBadge(s)
				title := s.Title
				if title == "" {
					title = "(untitled)"
				}
				sessLine := fmt.Sprintf("  %s %s", glyph, title)
				if badge != "" {
					sessLine += " " + badge
				}
				style := lipgloss.NewStyle()
				if row == m.sessCursor {
					style = style.Reverse(true)
				}
				lines = append(lines, truncPad(style.Render(sessLine), w))
				row++
			}
		}
	}

	for len(lines) < h {
		lines = append(lines, strings.Repeat(" ", w))
	}
	if len(lines) > h {
		lines = lines[:h]
	}

	return strings.Join(lines, "\n")
}

func (m Model) viewLog(w, h int) string {
	if m.logKey.IsZero() {
		center := "Press Enter on a session, or :new to start one"
		pad := (h - 1) / 2
		var lines []string
		for i := 0; i < pad; i++ {
			lines = append(lines, "")
		}
		lines = append(lines, centerText(center, w))
		for len(lines) < h {
			lines = append(lines, "")
		}
		return strings.Join(lines, "\n")
	}

	var lines []string

	title := m.logView.Summary.Title
	if title == "" {
		title = "(untitled)"
	}
	header := fmt.Sprintf(" %s ", title)
	if m.logView.Summary.Blocked {
		header += "· needs you "
	}
	if where := m.logView.Summary.CtlWhere; where != "" && m.logView.Summary.Ctl.Kind != core.CtlMine && m.logView.Summary.Ctl.Kind != core.CtlNone {
		header += "· read-only — running in " + where + "; typing forks it "
	}
	headerStyle := lipgloss.NewStyle().Bold(true).Foreground(m.accent)
	lines = append(lines, truncPad(headerStyle.Render(header), w))

	contentH := h - 1
	var contentLines []string
	for _, li := range m.logItems {
		contentLines = append(contentLines, li.rendered...)
	}

	if m.logView.Typing != "" {
		typed := lipgloss.NewStyle().Faint(true).Render(m.logView.Typing)
		contentLines = append(contentLines, typed)
	}

	for i, card := range m.logView.Cards {
		contentLines = append(contentLines, m.renderCard(card, w-4, i == 0)...)
	}

	start := len(contentLines) - contentH
	if start < 0 {
		start = 0
	}
	if !m.logFollow && m.logOffset < start {
		start = m.logOffset
	}
	end := start + contentH
	if end > len(contentLines) {
		end = len(contentLines)
	}

	visible := contentLines[start:end]
	for _, l := range visible {
		lines = append(lines, truncPad(l, w))
	}

	for len(lines) < h {
		lines = append(lines, strings.Repeat(" ", w))
	}
	if len(lines) > h {
		lines = lines[:h]
	}

	return strings.Join(lines, "\n")
}

func (m Model) renderCard(card core.Card, w int, oldest bool) []string {
	var lines []string
	border := lipgloss.NewStyle().
		Border(lipgloss.RoundedBorder()).
		BorderForeground(lipgloss.Color("#FFA500")).
		Width(w)

	switch {
	case card.IsPlan():
		lines = append(lines, lipgloss.NewStyle().Bold(true).Render("Plan"))
		if card.Preview != "" {
			lines = append(lines, mdlite.Render(card.Preview, max(w-4, 10), m.mdStyles)...)
		}
		lines = append(lines, "a approve · d reject")
	case card.IsPermission():
		lines = append(lines, fmt.Sprintf("Permission: %s", card.DisplayName))
		if card.Preview != "" {
			lines = append(lines, card.Preview)
		}
		if card.Description != "" {
			lines = append(lines, card.Description)
		}
		footer := "a allow · d deny"
		if card.CanAllowSession {
			footer = "a allow · A allow for session · d deny"
		}
		lines = append(lines, footer)
	default:
		qi := 0
		if oldest && card.RequestID == m.qReq {
			qi = m.qIdx
		}
		if qi >= len(card.Questions) {
			qi = len(card.Questions) - 1
		}
		q := card.Questions[qi]
		lines = append(lines, fmt.Sprintf("q %d/%d", qi+1, len(card.Questions)))
		lines = append(lines, q.Header+": "+q.Text)
		for i, opt := range q.Options {
			mark := ""
			if q.Multi {
				mark = "[ ] "
				if oldest && m.qSel[i] {
					mark = "[x] "
				}
			}
			lines = append(lines, fmt.Sprintf("  %d. %s%s", i+1, mark, opt.Label))
		}
		lines = append(lines, "1-9 pick · Enter confirm · type + Enter = other")
	}

	rendered := border.Render(strings.Join(lines, "\n"))
	return strings.Split(rendered, "\n")
}

func (m Model) viewStatus(w int) string {
	bg := lipgloss.Color("#333333")
	style := lipgloss.NewStyle().
		Background(bg).
		Foreground(lipgloss.Color("#CCCCCC")).
		Width(w)
	acctStyle := lipgloss.NewStyle().Background(bg).Foreground(m.accent).Bold(true)
	sep := " │ "

	parts := []string{
		" " + m.mode.String(),
		acctStyle.Render(m.acct.Name),
	}

	if m.acct.Email != "" {
		parts = append(parts, m.acct.Email)
	}

	if m.needsMine > 0 {
		need := fmt.Sprintf("%d need you", m.needsMine)
		if m.needsOther > 0 {
			need += fmt.Sprintf(" (+%d other)", m.needsOther)
		}
		parts = append(parts, need)
	}

	if m.tokToday > 0 {
		parts = append(parts, formatTokens(m.tokToday)+" today")
	}

	if m.logView.Ctl != nil {
		ctl := m.logView.Ctl
		info := ctl.Model
		if ctl.Mode != "" && ctl.Mode != "default" {
			info += " · " + ctl.Mode
		}
		if ctl.CtxPct > 0 {
			info += fmt.Sprintf(" · ctx %.0f%%", ctl.CtxPct*100)
		}
		if info != "" {
			parts = append(parts, info)
		}
		if ctl.State != "" {
			parts = append(parts, "ctl: "+ctl.State)
		}
	}

	parts = append(parts, "? help")

	return style.Render(strings.Join(parts, sep))
}

func (m Model) viewPrompt(w int) string {
	prefix := "> "
	if m.mode == ModeCommand {
		prefix = ":"
		return prefix + m.cmdText
	}
	if m.mode == ModeSearch {
		prefix = "/"
		return prefix + m.searchText
	}

	if m.flash != "" && m.mode == ModeNormal && m.promptText == "" {
		return lipgloss.NewStyle().Faint(true).Render(m.flash)
	}
	style := lipgloss.NewStyle()
	if m.mode == ModeInsert {
		style = style.Foreground(m.accent)
	}
	lines := strings.Split(m.promptText, "\n")
	if n := m.promptHeight(); len(lines) > n {
		lines = lines[len(lines)-n:]
		for i := range lines {
			lines[i] = "  " + lines[i]
		}
		return strings.Join(lines, "\n")
	}
	lines[0] = style.Render(prefix) + lines[0]
	return strings.Join(lines, "\n")
}

func (m Model) promptHeight() int {
	lines := strings.Count(m.promptText, "\n") + 1
	if lines > 8 {
		lines = 8
	}
	return lines
}

func (m *Model) refresh() Model {
	m.sessions = m.backend.Sessions(m.allAccounts)
	m.needsMine, m.needsOther, _ = m.backend.Attention()
	m.tokToday = m.backend.UsageToday()
	m.acct = m.backend.Account()

	if !m.logKey.IsZero() {
		view, ok := m.backend.View(m.logKey, "")
		if ok {
			if id := view.Summary.Key.SessionID; id != "" && id != m.logKey.SessionID {
				m.logKey = view.Summary.Key // draft -> real id
			}
			m.logView = view
			m.logItems = m.renderItems(view.Items, m.width-2)
		}
	}
	return *m
}

func (m Model) renderItems(items []core.Item, w int) []logItem {
	var result []logItem
	for _, it := range items {
		var rendered []string
		switch it.Kind {
		case core.ItemPrompt:
			style := lipgloss.NewStyle().Bold(true).Foreground(lipgloss.Color("#61AFEF"))
			rendered = append(rendered, style.Render("› "+it.Text))
		case core.ItemText:
			rendered = mdlite.Render(it.Text, w, m.mdStyles)
		case core.ItemTool:
			if it.Tool != nil {
				glyph := "✓"
				if it.Tool.Open {
					glyph = "…"
				}
				if it.Tool.Failed {
					glyph = "✗"
				}
				line := fmt.Sprintf("%s %s", glyph, it.Tool.Name)
				if it.Tool.Target != "" {
					line += "  " + it.Tool.Target
				}
				if it.Tool.Added > 0 || it.Tool.Removed > 0 {
					line += fmt.Sprintf("  +%d −%d", it.Tool.Added, it.Tool.Removed)
				}
				rendered = append(rendered, line)

				if m.expanded[it.ID] {
					if it.Tool.Input != "" {
						rendered = append(rendered, "  "+it.Tool.Input)
					}
					if it.Tool.Result != "" {
						resultLines := strings.Split(it.Tool.Result, "\n")
						for _, rl := range resultLines {
							rendered = append(rendered, "  "+rl)
						}
					}
				}
			}
		case core.ItemAgent:
			if it.Agent != nil {
				line := fmt.Sprintf("⊕ Agent: %s (%s)", it.Agent.Name, it.Agent.Status)
				rendered = append(rendered, line)
			}
		case core.ItemNotice:
			if strings.HasPrefix(it.Text, "↳") {
				style := lipgloss.NewStyle().Foreground(m.accent)
				rendered = append(rendered, style.Render(firstLine(it.Text)))
			} else {
				style := lipgloss.NewStyle().Faint(true)
				rendered = append(rendered, style.Render("ℹ "+it.Text))
			}
		case core.ItemInterrupted:
			style := lipgloss.NewStyle().Foreground(lipgloss.Color("#E5C07B"))
			rendered = append(rendered, style.Render("⚡ "+it.Text))
		case core.ItemCompactSummary:
			style := lipgloss.NewStyle().Faint(true)
			rendered = append(rendered, style.Render("… "+it.Text))
		default:
			rendered = append(rendered, it.Text)
		}
		result = append(result, logItem{item: it, rendered: rendered})
	}
	return result
}

func (m Model) tick() tea.Cmd {
	return tea.Tick(time.Second, func(t time.Time) tea.Msg {
		return tickMsg(t)
	})
}

func (m Model) viewOverlay(base string) string {
	h, w := m.height, m.width
	rows := strings.Split(base, "\n")
	for len(rows) < h {
		rows = append(rows, "")
	}
	rows = rows[:h]

	content := strings.Split(m.overlay, "\n")
	if maxLines := h - 2; len(content) > maxLines {
		content = content[:max(maxLines, 0)]
	}
	for i, l := range content {
		content[i] = ansi.Truncate(l, max(w-4, 1), "…")
	}
	box := lipgloss.NewStyle().
		Border(lipgloss.RoundedBorder()).
		Padding(0, 1).
		MaxWidth(w).
		Render(strings.Join(content, "\n"))
	boxRows := strings.Split(box, "\n")
	if len(boxRows) > h {
		boxRows = boxRows[:h]
	}
	placed := strings.Split(lipgloss.Place(w, len(boxRows), lipgloss.Center, lipgloss.Center, strings.Join(boxRows, "\n")), "\n")
	top := (h - len(placed)) / 2
	copy(rows[top:], placed)
	return strings.Join(rows, "\n")
}

type sessionGroup struct {
	key      string
	name     string
	sessions []core.SessionSummary
}

func (m Model) groupSessions() []sessionGroup {
	groups := make(map[string]*sessionGroup)
	var order []string
	for _, s := range m.sessions {
		key := s.ProjectKey
		if key == "" {
			key = "_none"
		}
		g, ok := groups[key]
		if !ok {
			name := s.ProjectName
			if name == "" {
				name = "(no project)"
			}
			g = &sessionGroup{key: key, name: name}
			groups[key] = g
			order = append(order, key)
		}
		g.sessions = append(g.sessions, s)
	}
	var result []sessionGroup
	for _, key := range order {
		result = append(result, *groups[key])
	}
	return result
}

func statusGlyph(s core.Status) string {
	switch s {
	case core.StatusNeedsYou:
		return "●"
	case core.StatusRunning:
		return "○"
	case core.StatusWaiting:
		return "○"
	case core.StatusDone:
		return "◌"
	default:
		return " "
	}
}

func statusBadge(s core.SessionSummary) string {
	var parts []string
	switch s.Ctl.Kind {
	case core.CtlMine:
		parts = append(parts, "ac•")
	case core.CtlOtherAC:
		parts = append(parts, fmt.Sprintf("ac:%d", s.Ctl.PID))
	case core.CtlElsewhere:
		if s.Source == core.SourceVSCode {
			parts = append(parts, "vs")
		} else {
			parts = append(parts, "cli")
		}
	}
	if s.Blocked {
		parts = append(parts, "!")
	} else {
		switch s.Status {
		case core.StatusRunning:
			parts = append(parts, "run")
		case core.StatusWaiting:
			parts = append(parts, "idle")
		}
	}
	return strings.Join(parts, " ")
}

// truncPad cuts s to w terminal cells (ANSI and wide-rune safe) and pads with
// spaces up to w.
func truncPad(s string, w int) string {
	if w <= 0 {
		return ""
	}
	sw := ansi.StringWidth(s)
	if sw > w {
		s = ansi.Truncate(s, w, "…")
		sw = ansi.StringWidth(s)
	}
	if sw < w {
		s += strings.Repeat(" ", w-sw)
	}
	return s
}

func firstLine(s string) string {
	if i := strings.IndexByte(s, '\n'); i >= 0 {
		return s[:i]
	}
	return s
}

// busy reports whether the open session's child process is working.
func (m Model) busy() bool {
	if m.logKey.IsZero() || m.logView.Ctl == nil {
		return false
	}
	return m.logView.Ctl.State == "busy" || m.logView.Ctl.State == "starting"
}

func (m Model) anyRunning() bool {
	for _, s := range m.sessions {
		if s.Status == core.StatusRunning {
			return true
		}
	}
	return false
}

func centerText(s string, w int) string {
	sw := ansi.StringWidth(s)
	if sw >= w {
		return s
	}
	pad := (w - sw) / 2
	return strings.Repeat(" ", pad) + s
}

func formatTokens(n int64) string {
	if n >= 1_000_000 {
		return fmt.Sprintf("%.1fM tok", float64(n)/1_000_000)
	}
	if n >= 1_000 {
		return fmt.Sprintf("%.0fK tok", float64(n)/1_000)
	}
	return fmt.Sprintf("%d tok", n)
}

func formatInfo(msg core.InfoMsg) string {
	var b strings.Builder
	b.WriteString(msg.Title + "\n")
	for _, l := range msg.Lines {
		b.WriteString(l + "\n")
	}
	b.WriteString("\nPress Esc to close")
	return b.String()
}
