package control

import (
	"bytes"
	"io"
	"strings"
	"testing"
)

func TestLineSplitter_Normal(t *testing.T) {
	r := strings.NewReader("line1\nline2\nline3\n")
	s := NewLineSplitter(r)

	var lines []string
	for {
		line, err := s.Next()
		if err == io.EOF {
			break
		}
		if err != nil {
			t.Fatal(err)
		}
		lines = append(lines, string(line))
	}

	if len(lines) != 3 {
		t.Fatalf("got %d lines, want 3: %v", len(lines), lines)
	}
	if lines[0] != "line1" || lines[1] != "line2" || lines[2] != "line3" {
		t.Errorf("lines = %v", lines)
	}
}

func TestLineSplitter_CRLF(t *testing.T) {
	r := strings.NewReader("a\r\nb\r\nc\r\n")
	s := NewLineSplitter(r)

	var lines []string
	for {
		line, err := s.Next()
		if err == io.EOF {
			break
		}
		if err != nil {
			t.Fatal(err)
		}
		lines = append(lines, string(line))
	}

	if len(lines) != 3 {
		t.Fatalf("got %d lines: %v", len(lines), lines)
	}
	for _, l := range lines {
		if strings.Contains(l, "\r") {
			t.Errorf("line contains \\r: %q", l)
		}
	}
}

func TestLineSplitter_PartialAtEOF(t *testing.T) {
	r := strings.NewReader("full\npartial")
	s := NewLineSplitter(r)

	var lines []string
	for {
		line, err := s.Next()
		if err == io.EOF {
			break
		}
		if err != nil {
			t.Fatal(err)
		}
		lines = append(lines, string(line))
	}

	if len(lines) != 2 {
		t.Fatalf("got %d lines: %v", len(lines), lines)
	}
	if lines[1] != "partial" {
		t.Errorf("last line = %q", lines[1])
	}
}

func TestLineSplitter_OverLongDrop(t *testing.T) {
	// A small limit keeps the test fast; the drop logic does not depend on
	// the production value.
	const limit = 3*readChunkSize + 10
	long := strings.Repeat("x", limit+100)
	r := strings.NewReader(long + "\nshort\n")
	s := NewLineSplitter(r)
	s.limit = limit

	var lines []string
	for {
		line, err := s.Next()
		if err == io.EOF {
			break
		}
		if err != nil {
			t.Fatal(err)
		}
		lines = append(lines, string(line))
	}

	if len(lines) != 1 || lines[0] != "short" {
		t.Errorf("lines = %v", lines)
	}
	if s.Dropped() != 1 {
		t.Errorf("dropped = %d, want 1", s.Dropped())
	}
}

func TestLineSplitter_Empty(t *testing.T) {
	r := strings.NewReader("")
	s := NewLineSplitter(r)
	_, err := s.Next()
	if err != io.EOF {
		t.Fatalf("expected EOF, got %v", err)
	}
}

func TestLineSplitter_EmptyLines(t *testing.T) {
	r := strings.NewReader("\n\ndata\n\n")
	s := NewLineSplitter(r)

	var lines []string
	for {
		line, err := s.Next()
		if err == io.EOF {
			break
		}
		if err != nil {
			t.Fatal(err)
		}
		lines = append(lines, string(line))
	}

	if len(lines) != 4 {
		t.Fatalf("got %d lines: %v", len(lines), lines)
	}
	if lines[0] != "" || lines[1] != "" || lines[2] != "data" || lines[3] != "" {
		t.Errorf("lines = %v", lines)
	}
}

func TestLineSplitter_LargeChunks(t *testing.T) {
	// Lines that span multiple read chunks
	line1 := strings.Repeat("a", readChunkSize+100)
	line2 := "short"
	r := strings.NewReader(line1 + "\n" + line2 + "\n")
	s := NewLineSplitter(r)

	got1, err := s.Next()
	if err != nil {
		t.Fatal(err)
	}
	if string(got1) != line1 {
		t.Errorf("line1 len = %d, want %d", len(got1), len(line1))
	}

	got2, err := s.Next()
	if err != nil {
		t.Fatal(err)
	}
	if string(got2) != line2 {
		t.Errorf("line2 = %q", string(got2))
	}
}

func TestLineSplitter_BinaryData(t *testing.T) {
	// Binary data with embedded null bytes
	data := []byte("line1\x00with\x00nulls\nline2\n")
	r := bytes.NewReader(data)
	s := NewLineSplitter(r)

	line, err := s.Next()
	if err != nil {
		t.Fatal(err)
	}
	if !bytes.Equal(line, []byte("line1\x00with\x00nulls")) {
		t.Errorf("line = %q", line)
	}
}
