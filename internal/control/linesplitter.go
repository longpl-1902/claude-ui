package control

import "io"

const (
	maxLineSize   = 16 << 20 // 16 MiB
	readChunkSize = 64 * 1024
)

type LineSplitter struct {
	r       io.Reader
	buf     []byte
	start   int
	end     int
	dropped int
	done    bool
	limit   int // longest accepted line; tests lower it
}

func NewLineSplitter(r io.Reader) *LineSplitter {
	return &LineSplitter{
		r:     r,
		buf:   make([]byte, readChunkSize),
		limit: maxLineSize,
	}
}

func (s *LineSplitter) Dropped() int { return s.dropped }

func (s *LineSplitter) Next() ([]byte, error) {
	for {
		if lineEnd := s.findNewline(); lineEnd >= 0 {
			line := s.buf[s.start:lineEnd]
			next := lineEnd + 1
			if next < s.end && s.buf[lineEnd] == '\r' && s.buf[next] == '\n' {
				next++
			} else if s.buf[lineEnd] == '\r' && next == s.end {
				// might be \r\n split across reads — but we can't hold forever
			}

			// strip \r if present at end of line
			if len(line) > 0 && line[len(line)-1] == '\r' {
				line = line[:len(line)-1]
			}

			s.start = next
			if len(line) > s.limit {
				s.dropped++
				continue
			}
			return line, nil
		}

		if s.end-s.start > s.limit {
			s.start = s.end
			s.dropped++
			continue
		}

		if s.done {
			if s.start < s.end {
				line := s.buf[s.start:s.end]
				s.start = s.end
				if len(line) > 0 && line[len(line)-1] == '\r' {
					line = line[:len(line)-1]
				}
				if len(line) > s.limit {
					s.dropped++
					return nil, io.EOF
				}
				return line, nil
			}
			return nil, io.EOF
		}

		s.compact()
		n, err := s.r.Read(s.buf[s.end:])
		s.end += n
		if err != nil {
			s.done = true
			if err != io.EOF {
				// Return remaining data on error too
				if s.start < s.end {
					continue
				}
				return nil, err
			}
		}
	}
}

func (s *LineSplitter) findNewline() int {
	for i := s.start; i < s.end; i++ {
		if s.buf[i] == '\n' || s.buf[i] == '\r' {
			if s.buf[i] == '\r' && i+1 < s.end && s.buf[i+1] == '\n' {
				return i // findNewline returns position of \r, Next() will skip \r\n
			}
			return i
		}
	}
	return -1
}

func (s *LineSplitter) compact() {
	if s.start == 0 {
		if s.end == len(s.buf) {
			s.buf = append(s.buf, make([]byte, readChunkSize)...)
		}
		return
	}
	n := copy(s.buf, s.buf[s.start:s.end])
	s.end = n
	s.start = 0
	if s.end == len(s.buf) {
		s.buf = append(s.buf, make([]byte, readChunkSize)...)
	}
}
