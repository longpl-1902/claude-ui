package transcript

import (
	"fmt"
	"strings"
	"testing"
	"time"
)

type memReader struct {
	files map[string]*memFile
}

type memFile struct {
	data    []byte
	created time.Time
}

func newMemReader() *memReader {
	return &memReader{files: make(map[string]*memFile)}
}

func (m *memReader) Set(path string, data []byte, created time.Time) {
	m.files[path] = &memFile{data: data, created: created}
}

func (m *memReader) Stat(path string) (int64, time.Time, bool, error) {
	f, ok := m.files[path]
	if !ok {
		return 0, time.Time{}, false, nil
	}
	return int64(len(f.data)), f.created, true, nil
}

func (m *memReader) ReadRange(path string, start, end int64) ([]byte, error) {
	f, ok := m.files[path]
	if !ok {
		return nil, fmt.Errorf("not found: %s", path)
	}
	if start < 0 {
		start = 0
	}
	if end > int64(len(f.data)) {
		end = int64(len(f.data))
	}
	if start >= end {
		return nil, nil
	}
	result := make([]byte, end-start)
	copy(result, f.data[start:end])
	return result, nil
}

func TestTailer_BasicRead(t *testing.T) {
	mr := newMemReader()
	now := time.Now()
	mr.Set("test.jsonl", []byte("line1\nline2\nline3\n"), now)

	tailer := NewTailer(mr)
	read, err := tailer.Read("test.jsonl")
	if err != nil {
		t.Fatal(err)
	}
	if len(read.Lines) != 3 {
		t.Fatalf("lines = %d, want 3", len(read.Lines))
	}
	if string(read.Lines[0]) != "line1" {
		t.Errorf("line[0] = %q", string(read.Lines[0]))
	}
	if string(read.Lines[2]) != "line3" {
		t.Errorf("line[2] = %q", string(read.Lines[2]))
	}
}

func TestTailer_IncrementalAppend(t *testing.T) {
	mr := newMemReader()
	now := time.Now()
	mr.Set("test.jsonl", []byte("line1\n"), now)

	tailer := NewTailer(mr)
	read1, err := tailer.Read("test.jsonl")
	if err != nil {
		t.Fatal(err)
	}
	if len(read1.Lines) != 1 {
		t.Fatalf("first read: lines = %d", len(read1.Lines))
	}

	// Append more data
	mr.Set("test.jsonl", []byte("line1\nline2\nline3\n"), now)
	read2, err := tailer.Read("test.jsonl")
	if err != nil {
		t.Fatal(err)
	}
	if len(read2.Lines) != 2 {
		t.Fatalf("second read: lines = %d, want 2", len(read2.Lines))
	}
	if string(read2.Lines[0]) != "line2" {
		t.Errorf("line[0] = %q", string(read2.Lines[0]))
	}
}

func TestTailer_PartialLine(t *testing.T) {
	mr := newMemReader()
	now := time.Now()
	mr.Set("test.jsonl", []byte("line1\npartial"), now)

	tailer := NewTailer(mr)
	read, err := tailer.Read("test.jsonl")
	if err != nil {
		t.Fatal(err)
	}
	// partial line should be held back
	if len(read.Lines) != 1 {
		t.Fatalf("lines = %d, want 1 (partial held)", len(read.Lines))
	}

	// Now complete the line
	mr.Set("test.jsonl", []byte("line1\npartial complete\n"), now)
	read2, err := tailer.Read("test.jsonl")
	if err != nil {
		t.Fatal(err)
	}
	if len(read2.Lines) != 1 {
		t.Fatalf("second read: lines = %d, want 1", len(read2.Lines))
	}
	if string(read2.Lines[0]) != "partial complete" {
		t.Errorf("line = %q", string(read2.Lines[0]))
	}
}

func TestTailer_CRLF(t *testing.T) {
	mr := newMemReader()
	now := time.Now()
	mr.Set("test.jsonl", []byte("line1\r\nline2\r\n"), now)

	tailer := NewTailer(mr)
	read, err := tailer.Read("test.jsonl")
	if err != nil {
		t.Fatal(err)
	}
	if len(read.Lines) != 2 {
		t.Fatalf("lines = %d, want 2", len(read.Lines))
	}
	if string(read.Lines[0]) != "line1" {
		t.Errorf("line[0] = %q (should strip CR)", string(read.Lines[0]))
	}
}

func TestTailer_ResetOnTruncate(t *testing.T) {
	mr := newMemReader()
	now := time.Now()
	mr.Set("test.jsonl", []byte("line1\nline2\nline3\n"), now)

	tailer := NewTailer(mr)
	_, err := tailer.Read("test.jsonl")
	if err != nil {
		t.Fatal(err)
	}

	// Truncate
	mr.Set("test.jsonl", []byte("new1\n"), now)
	read, err := tailer.Read("test.jsonl")
	if err != nil {
		t.Fatal(err)
	}
	if !read.Reset {
		t.Error("expected reset on truncate")
	}
	if len(read.Lines) != 1 {
		t.Fatalf("lines = %d", len(read.Lines))
	}
	if string(read.Lines[0]) != "new1" {
		t.Errorf("line = %q", string(read.Lines[0]))
	}
}

func TestTailer_ResetOnNewCreationTime(t *testing.T) {
	mr := newMemReader()
	t1 := time.Date(2026, 1, 1, 0, 0, 0, 0, time.UTC)
	t2 := time.Date(2026, 1, 2, 0, 0, 0, 0, time.UTC)

	mr.Set("test.jsonl", []byte("old1\nold2\n"), t1)
	tailer := NewTailer(mr)
	_, err := tailer.Read("test.jsonl")
	if err != nil {
		t.Fatal(err)
	}

	// Replace file (same size but different creation time)
	mr.Set("test.jsonl", []byte("new1\nnew2\n"), t2)
	read, err := tailer.Read("test.jsonl")
	if err != nil {
		t.Fatal(err)
	}
	if !read.Reset {
		t.Error("expected reset on new creation time")
	}
}

func TestTailer_OverLongLine(t *testing.T) {
	mr := newMemReader()
	now := time.Now()

	// Line longer than maxLineSize (8 MiB)
	longLine := strings.Repeat("x", maxLineSize+100)
	data := "short\n" + longLine + "\nafter\n"
	mr.Set("test.jsonl", []byte(data), now)

	tailer := NewTailer(mr)
	read, err := tailer.Read("test.jsonl")
	if err != nil {
		t.Fatal(err)
	}
	if read.Dropped != 1 {
		t.Errorf("dropped = %d, want 1", read.Dropped)
	}
	// Should still get "short" and "after"
	if len(read.Lines) != 2 {
		t.Fatalf("lines = %d, want 2", len(read.Lines))
	}
}

func TestTailer_Forget(t *testing.T) {
	mr := newMemReader()
	now := time.Now()
	mr.Set("test.jsonl", []byte("line1\n"), now)

	tailer := NewTailer(mr)
	_, err := tailer.Read("test.jsonl")
	if err != nil {
		t.Fatal(err)
	}

	tailer.Forget("test.jsonl")

	// After forget, should re-read from start
	read, err := tailer.Read("test.jsonl")
	if err != nil {
		t.Fatal(err)
	}
	if len(read.Lines) != 1 {
		t.Fatalf("lines after forget = %d", len(read.Lines))
	}
}

func TestTailer_Backfill(t *testing.T) {
	mr := newMemReader()
	now := time.Now()

	// Create data larger than backfillWindow (16 MiB)
	var lines []string
	lineLen := 200
	numLines := (backfillWindow / lineLen) + 1000
	for i := 0; i < numLines; i++ {
		lines = append(lines, fmt.Sprintf("line-%06d-%s", i, strings.Repeat("x", lineLen)))
	}
	data := strings.Join(lines, "\n") + "\n"
	mr.Set("test.jsonl", []byte(data), now)

	tailer := NewTailer(mr)
	read, err := tailer.Read("test.jsonl")
	if err != nil {
		t.Fatal(err)
	}

	if read.Skipped == 0 {
		t.Error("expected some data to be skipped for large file")
	}
	if len(read.Lines) == 0 {
		t.Error("expected some lines to be read")
	}
}

func TestTailer_MissingFile(t *testing.T) {
	mr := newMemReader()
	tailer := NewTailer(mr)
	read, err := tailer.Read("nonexistent.jsonl")
	if err != nil {
		t.Fatal(err)
	}
	if len(read.Lines) != 0 {
		t.Error("expected no lines for missing file")
	}
}
