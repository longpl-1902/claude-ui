package transcript

import (
	"bytes"
	"time"
)

const (
	backfillWindow = 16 * 1024 * 1024
	chunkSize      = 4 * 1024 * 1024
	maxLineSize    = 8 * 1024 * 1024
)

type ByteReader interface {
	Stat(path string) (size int64, created time.Time, ok bool, err error)
	ReadRange(path string, start, end int64) ([]byte, error)
}

type TailRead struct {
	Lines   [][]byte
	Reset   bool
	Skipped int64
	Dropped int
	EOF     bool
}

type pathState struct {
	offset  int64
	created time.Time
	partial []byte
}

type Tailer struct {
	r     ByteReader
	state map[string]*pathState
}

func NewTailer(r ByteReader) *Tailer {
	return &Tailer{
		r:     r,
		state: make(map[string]*pathState),
	}
}

func (t *Tailer) Read(path string) (TailRead, error) {
	size, created, ok, err := t.r.Stat(path)
	if err != nil {
		return TailRead{}, err
	}
	if !ok {
		return TailRead{}, nil
	}

	st, exists := t.state[path]
	if !exists {
		st = &pathState{}
		t.state[path] = st
	}

	var result TailRead

	// Reset on truncate or file replaced
	if size < st.offset || (!st.created.IsZero() && !created.IsZero() && !created.Equal(st.created)) {
		st.offset = 0
		st.partial = nil
		result.Reset = true
	}
	st.created = created

	// First read: backfill from the end
	if st.offset == 0 && size > 0 {
		start := size - backfillWindow
		if start < 0 {
			start = 0
		}
		if start > 0 {
			// Start one byte early to find the newline boundary
			start--
			result.Skipped = start
		}

		data, err := t.r.ReadRange(path, start, size)
		if err != nil {
			return TailRead{}, err
		}

		if start > 0 && len(data) > 0 {
			// Discard to first newline
			idx := bytes.IndexByte(data, '\n')
			if idx >= 0 {
				result.Skipped += int64(idx + 1)
				data = data[idx+1:]
			} else {
				result.Skipped += int64(len(data))
				data = nil
			}
		}

		result.Lines, result.Dropped, st.partial = splitLines(data, nil)
		st.offset = size
		result.EOF = true
		return result, nil
	}

	if size <= st.offset {
		result.EOF = true
		return result, nil
	}

	// Incremental read in chunks
	remaining := size - st.offset
	var allLines [][]byte
	var dropped int

	for remaining > 0 {
		end := st.offset + chunkSize
		if end > size {
			end = size
		}

		data, err := t.r.ReadRange(path, st.offset, end)
		if err != nil {
			return TailRead{}, err
		}

		var lines [][]byte
		var d int
		lines, d, st.partial = splitLines(data, st.partial)
		allLines = append(allLines, lines...)
		dropped += d

		st.offset = end
		remaining = size - st.offset
	}

	result.Lines = allLines
	result.Dropped = dropped
	result.EOF = true
	return result, nil
}

func (t *Tailer) Forget(path string) {
	delete(t.state, path)
}

func splitLines(data, partial []byte) (lines [][]byte, dropped int, remainder []byte) {
	buf := append(partial, data...)

	for {
		idx := bytes.IndexByte(buf, '\n')
		if idx < 0 {
			// No complete line; hold as partial
			if len(buf) > maxLineSize {
				dropped++
				buf = nil
			}
			remainder = buf
			return
		}

		line := buf[:idx]
		buf = buf[idx+1:]

		// Strip CR
		line = bytes.TrimRight(line, "\r")

		if len(line) > maxLineSize {
			dropped++
			continue
		}

		lines = append(lines, line)
	}
}
