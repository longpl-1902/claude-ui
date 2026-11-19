package mdlite

import (
	"strings"
	"unicode/utf8"

	"charm.land/lipgloss/v2"
)

type Styles struct {
	Heading   lipgloss.Style
	Bold      lipgloss.Style
	Italic    lipgloss.Style
	Code      lipgloss.Style
	CodeBlock lipgloss.Style
	Quote     lipgloss.Style
	Link      lipgloss.Style
}

func DefaultStyles() Styles {
	return Styles{
		Heading:   lipgloss.NewStyle().Bold(true),
		Bold:      lipgloss.NewStyle().Bold(true),
		Italic:    lipgloss.NewStyle().Italic(true),
		Code:      lipgloss.NewStyle().Faint(true),
		CodeBlock: lipgloss.NewStyle().Faint(true),
		Quote:     lipgloss.NewStyle().Faint(true),
		Link:      lipgloss.NewStyle().Underline(true),
	}
}

func Render(md string, width int, st Styles) []string {
	if width < 10 {
		width = 10
	}
	lines := strings.Split(strings.ReplaceAll(md, "\r\n", "\n"), "\n")
	var out []string

	i := 0
	for i < len(lines) {
		line := lines[i]

		if strings.HasPrefix(line, "```") {
			out = append(out, renderFence(lines, &i, width, st)...)
			continue
		}

		if h, level := headingLevel(line); level > 0 {
			out = append(out, wrapStyled(h, width, st.Heading)...)
			i++
			continue
		}

		if strings.HasPrefix(line, "> ") || line == ">" {
			text := strings.TrimPrefix(line, "> ")
			wrapped := wrapStyled(text, width-2, st.Quote)
			for j, w := range wrapped {
				wrapped[j] = st.Quote.Render("│ ") + w
			}
			out = append(out, wrapped...)
			i++
			continue
		}

		if bullet, indent, ok := listItem(line); ok {
			text := renderInline(line[indent:], st)
			wrapped := wrapPlain(text, width-indent)
			prefix := bullet + strings.Repeat(" ", indent-len(bullet))
			hang := strings.Repeat(" ", indent)
			for j, w := range wrapped {
				if j == 0 {
					wrapped[j] = prefix + w
				} else {
					wrapped[j] = hang + w
				}
			}
			out = append(out, wrapped...)
			i++
			continue
		}

		if strings.TrimSpace(line) == "" {
			out = append(out, "")
			i++
			continue
		}

		text := renderInline(line, st)
		out = append(out, wrapPlain(text, width)...)
		i++
	}
	return out
}

func headingLevel(line string) (string, int) {
	for level := 6; level >= 1; level-- {
		prefix := strings.Repeat("#", level) + " "
		if strings.HasPrefix(line, prefix) {
			return strings.TrimPrefix(line, prefix), level
		}
	}
	return "", 0
}

func renderFence(lines []string, i *int, width int, st Styles) []string {
	*i++ // skip opening ```
	var out []string
	for *i < len(lines) {
		if strings.HasPrefix(lines[*i], "```") {
			*i++
			return out
		}
		line := lines[*i]
		if displayWidth(line) > width {
			line = truncateToWidth(line, width-1) + "…"
		}
		out = append(out, st.CodeBlock.Render(line))
		*i++
	}
	return out
}

func listItem(line string) (bullet string, indent int, ok bool) {
	trimmed := strings.TrimLeft(line, " ")
	leading := len(line) - len(trimmed)
	if strings.HasPrefix(trimmed, "- ") || strings.HasPrefix(trimmed, "* ") {
		return trimmed[:2], leading + 2, true
	}
	for j := 0; j < len(trimmed); j++ {
		if trimmed[j] >= '0' && trimmed[j] <= '9' {
			continue
		}
		if trimmed[j] == '.' && j > 0 && j+1 < len(trimmed) && trimmed[j+1] == ' ' {
			b := trimmed[:j+2]
			return b, leading + len(b), true
		}
		break
	}
	return "", 0, false
}

func renderInline(text string, st Styles) string {
	var b strings.Builder
	i := 0
	runes := []rune(text)
	for i < len(runes) {
		switch {
		case i+1 < len(runes) && runes[i] == '*' && runes[i+1] == '*':
			end := findClose(runes, i+2, "**")
			if end >= 0 {
				b.WriteString(st.Bold.Render(string(runes[i+2 : end])))
				i = end + 2
				continue
			}
		case runes[i] == '*' && (i+1 >= len(runes) || runes[i+1] != '*'):
			end := findCloseRune(runes, i+1, '*')
			if end >= 0 {
				b.WriteString(st.Italic.Render(string(runes[i+1 : end])))
				i = end + 1
				continue
			}
		case runes[i] == '`':
			end := findCloseRune(runes, i+1, '`')
			if end >= 0 {
				b.WriteString(st.Code.Render(string(runes[i+1 : end])))
				i = end + 1
				continue
			}
		case runes[i] == '[':
			mid := findCloseRune(runes, i+1, ']')
			if mid >= 0 && mid+1 < len(runes) && runes[mid+1] == '(' {
				end := findCloseRune(runes, mid+2, ')')
				if end >= 0 {
					linkText := string(runes[i+1 : mid])
					url := string(runes[mid+2 : end])
					b.WriteString(st.Link.Render(linkText) + " (" + url + ")")
					i = end + 1
					continue
				}
			}
		}
		b.WriteRune(runes[i])
		i++
	}
	return b.String()
}

func findClose(runes []rune, start int, marker string) int {
	mr := []rune(marker)
	for i := start; i <= len(runes)-len(mr); i++ {
		match := true
		for j := range mr {
			if runes[i+j] != mr[j] {
				match = false
				break
			}
		}
		if match {
			return i
		}
	}
	return -1
}

func findCloseRune(runes []rune, start int, ch rune) int {
	for i := start; i < len(runes); i++ {
		if runes[i] == ch {
			return i
		}
	}
	return -1
}

func wrapStyled(text string, width int, st lipgloss.Style) []string {
	plain := wrapPlain(text, width)
	for i, p := range plain {
		plain[i] = st.Render(p)
	}
	return plain
}

func wrapPlain(text string, width int) []string {
	if width < 5 {
		width = 5
	}
	if displayWidth(text) <= width {
		return []string{text}
	}

	var lines []string
	words := strings.Fields(text)
	var cur strings.Builder
	curW := 0

	for _, w := range words {
		ww := displayWidth(w)
		if curW > 0 && curW+1+ww > width {
			lines = append(lines, cur.String())
			cur.Reset()
			curW = 0
		}
		if curW > 0 {
			cur.WriteByte(' ')
			curW++
		}
		cur.WriteString(w)
		curW += ww
	}
	if cur.Len() > 0 {
		lines = append(lines, cur.String())
	}
	if len(lines) == 0 {
		lines = []string{""}
	}
	return lines
}

func displayWidth(s string) int {
	return lipgloss.Width(s)
}

func truncateToWidth(s string, maxW int) string {
	var b strings.Builder
	w := 0
	for i := 0; i < len(s); {
		r, size := utf8.DecodeRuneInString(s[i:])
		rw := lipgloss.Width(string(r))
		if w+rw > maxW {
			break
		}
		b.WriteRune(r)
		w += rw
		i += size
	}
	return b.String()
}
