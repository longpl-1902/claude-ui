package safefs

import (
	"errors"
	"io"
	"os"
	"path/filepath"
	"regexp"
	"strings"
	"time"
)

var ErrDenied = errors.New("access denied: credential file")

var digitsPidRe = regexp.MustCompile(`^\d+\.json$`)

func IsDenied(path string) bool {
	base := baseName(path)
	if base == ".credentials.json" {
		return true
	}
	if strings.HasSuffix(strings.ToLower(base), ".key") {
		return true
	}
	return false
}

func baseName(path string) string {
	path = strings.ReplaceAll(path, `\`, "/")
	return filepath.Base(path)
}

func IsReadable(path string) bool {
	if IsDenied(path) {
		return false
	}
	base := filepath.Base(path)
	lower := strings.ToLower(base)

	switch {
	case strings.HasSuffix(lower, ".jsonl"):
		return true
	case strings.HasPrefix(lower, "agent-") && strings.HasSuffix(lower, ".meta.json"):
		return true
	case digitsPidRe.MatchString(lower):
		return true
	case lower == ".claude.json":
		return true
	case lower == ".config.json":
		return true
	case lower == "settings.json":
		return true
	case lower == "config.json":
		return true
	case lower == "state.json":
		return true
	}
	return false
}

func ReadFile(path string) ([]byte, error) {
	if IsDenied(path) {
		return nil, ErrDenied
	}
	return os.ReadFile(path)
}

func Stat(path string) (os.FileInfo, error) {
	if IsDenied(path) {
		return nil, ErrDenied
	}
	return os.Stat(path)
}

func ReadDir(path string) ([]os.DirEntry, error) {
	return os.ReadDir(path)
}

func ReadRange(path string, start, end int64) ([]byte, error) {
	if IsDenied(path) {
		return nil, ErrDenied
	}
	f, err := os.Open(path)
	if err != nil {
		return nil, err
	}
	defer f.Close()

	if _, err := f.Seek(start, io.SeekStart); err != nil {
		return nil, err
	}
	buf := make([]byte, end-start)
	n, err := io.ReadFull(f, buf)
	if err == io.ErrUnexpectedEOF {
		return buf[:n], nil
	}
	if err != nil {
		return nil, err
	}
	return buf[:n], nil
}

func StatForTailer(path string) (size int64, created time.Time, ok bool, err error) {
	if IsDenied(path) {
		return 0, time.Time{}, false, ErrDenied
	}
	fi, err := os.Stat(path)
	if err != nil {
		if os.IsNotExist(err) {
			return 0, time.Time{}, false, nil
		}
		return 0, time.Time{}, false, err
	}
	return fi.Size(), fi.ModTime(), true, nil
}
