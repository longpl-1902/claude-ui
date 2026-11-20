package mdlite

import (
	"strings"
	"testing"
)

func TestRenderHeadings(t *testing.T) {
	st := DefaultStyles()
	cases := []struct {
		input string
		want  string
	}{
		{"# Hello", "Hello"},
		{"## Sub", "Sub"},
		{"### Deep", "Deep"},
	}
	for _, c := range cases {
		lines := Render(c.input, 80, st)
		if len(lines) == 0 {
			t.Errorf("Render(%q) returned no lines", c.input)
			continue
		}
		if !strings.Contains(lines[0], c.want) {
			t.Errorf("Render(%q) = %q, want to contain %q", c.input, lines[0], c.want)
		}
	}
}

func TestRenderCodeBlock(t *testing.T) {
	st := DefaultStyles()
	md := "```\nfoo bar\nbaz\n```"
	lines := Render(md, 80, st)
	if len(lines) != 2 {
		t.Fatalf("expected 2 lines, got %d: %v", len(lines), lines)
	}
}

func TestRenderList(t *testing.T) {
	st := DefaultStyles()
	md := "- item one\n- item two\n1. numbered"
	lines := Render(md, 80, st)
	if len(lines) < 3 {
		t.Fatalf("expected at least 3 lines, got %d", len(lines))
	}
}

func TestRenderQuote(t *testing.T) {
	st := DefaultStyles()
	md := "> quoted text"
	lines := Render(md, 80, st)
	if len(lines) == 0 {
		t.Fatal("expected at least 1 line")
	}
	if !strings.Contains(lines[0], "quoted text") {
		t.Errorf("quote not rendered: %q", lines[0])
	}
}

func TestWrapLongLine(t *testing.T) {
	st := DefaultStyles()
	md := strings.Repeat("word ", 30)
	lines := Render(md, 40, st)
	if len(lines) < 2 {
		t.Errorf("expected wrapping, got %d lines", len(lines))
	}
}

func stripANSI(s string) string {
	var b strings.Builder
	i := 0
	for i < len(s) {
		if s[i] == '\x1b' && i+1 < len(s) && s[i+1] == '[' {
			j := i + 2
			for j < len(s) && !((s[j] >= 'A' && s[j] <= 'Z') || (s[j] >= 'a' && s[j] <= 'z')) {
				j++
			}
			if j < len(s) {
				j++
			}
			i = j
			continue
		}
		b.WriteByte(s[i])
		i++
	}
	return b.String()
}

func TestRenderInline(t *testing.T) {
	st := DefaultStyles()
	cases := []struct {
		input string
		want  string
	}{
		{"**bold**", "bold"},
		{"*italic*", "italic"},
		{"`code`", "code"},
		{"[link](http://x)", "link"},
	}
	for _, c := range cases {
		lines := Render(c.input, 80, st)
		joined := stripANSI(strings.Join(lines, " "))
		if !strings.Contains(joined, c.want) {
			t.Errorf("Render(%q) = %q, want to contain %q", c.input, joined, c.want)
		}
	}
}

func TestMalformedInput(t *testing.T) {
	st := DefaultStyles()
	cases := []string{
		"**unclosed",
		"```\nno closing fence",
		"** alone **",
		"",
		"\n\n\n",
		"```",
	}
	for _, md := range cases {
		func() {
			defer func() {
				if r := recover(); r != nil {
					t.Errorf("Render(%q) panicked: %v", md, r)
				}
			}()
			Render(md, 80, st)
		}()
	}
}

func TestNarrowWidth(t *testing.T) {
	st := DefaultStyles()
	Render("# Hello World\n\nSome text here", 10, st)
	Render("# Hello World", 1, st) // should not panic even with tiny width
}

func TestFenceTruncation(t *testing.T) {
	st := DefaultStyles()
	long := "```\n" + strings.Repeat("x", 100) + "\n```"
	lines := Render(long, 20, st)
	if len(lines) == 0 {
		t.Fatal("expected output")
	}
}
