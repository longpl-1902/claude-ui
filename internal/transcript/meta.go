package transcript

import (
	"bytes"
	"time"
)

type Meta struct {
	Cwd         string
	Entrypoint  string
	Title       string
	TitleKind   string
	FirstPrompt string
	LastTs      time.Time
}

func ScanMeta(head, tail []byte) Meta {
	var m Meta

	scan := func(data []byte) {
		for _, line := range bytes.Split(data, []byte("\n")) {
			line = bytes.TrimRight(line, "\r")
			if ShouldSkipRaw(line) {
				continue
			}
			rec, ok := ParseLine(line)
			if !ok {
				continue
			}

			if !rec.Timestamp.IsZero() && rec.Timestamp.After(m.LastTs) {
				m.LastTs = rec.Timestamp
			}

			switch rec.T {
			case RecSystem:
				if rec.SystemType == "init" {
					if rec.Text != "" && m.Cwd == "" {
						m.Cwd = rec.Text
					}
					if rec.TitleKind == "agent-name" && m.Title == "" {
						m.Title = rec.TitleText
						m.TitleKind = "agent-name"
					}
				}
			case RecTitle:
				switch rec.TitleKind {
				case "custom":
					m.Title = rec.TitleText
					m.TitleKind = "custom"
				case "ai":
					if m.TitleKind != "custom" {
						m.Title = rec.TitleText
						m.TitleKind = "ai"
					}
				case "agent-name":
					if m.TitleKind == "" {
						m.Title = rec.TitleText
						m.TitleKind = "agent-name"
					}
				}
			case RecPrompt:
				if !rec.IsMeta && m.FirstPrompt == "" && rec.PromptText != "" {
					m.FirstPrompt = truncate(rec.PromptText, capSummary)
				}
			}
		}
	}

	scan(head)
	scan(tail)
	return m
}
