package safefs

import (
	"errors"
	"os"
	"path/filepath"
	"testing"
)

func TestIsDenied(t *testing.T) {
	tests := []struct {
		path string
		want bool
	}{
		{"/home/u/.claude/.credentials.json", true},
		{`D:\Users\u\.claude\.credentials.json`, true},
		{"/home/u/.claude/sessions/12345.key", true},
		{"/home/u/.claude/sessions/abc.KEY", true},
		{"/home/u/.claude/settings.json", false},
		{"/home/u/.claude/projects/demo/session.jsonl", false},
		{"/home/u/.claude/.claude.json", false},
	}
	for _, tt := range tests {
		got := IsDenied(tt.path)
		if got != tt.want {
			t.Errorf("IsDenied(%q) = %v, want %v", tt.path, got, tt.want)
		}
	}
}

func TestIsReadable(t *testing.T) {
	tests := []struct {
		path string
		want bool
	}{
		{"/a/b/session.jsonl", true},
		{"/a/agent-abc.meta.json", true},
		{"/a/sessions/12345.json", true},
		{"/a/.claude.json", true},
		{"/a/.config.json", true},
		{"/a/settings.json", true},
		{"/a/config.json", true},
		{"/a/state.json", true},
		{"/a/.credentials.json", false},
		{"/a/something.key", false},
		{"/a/random.txt", false},
		{"/a/random.json", false},
	}
	for _, tt := range tests {
		got := IsReadable(tt.path)
		if got != tt.want {
			t.Errorf("IsReadable(%q) = %v, want %v", tt.path, got, tt.want)
		}
	}
}

func TestReadFileDenied(t *testing.T) {
	_, err := ReadFile("/any/.credentials.json")
	if !errors.Is(err, ErrDenied) {
		t.Errorf("ReadFile(.credentials.json) err = %v, want ErrDenied", err)
	}
	_, err = ReadFile("/any/secret.key")
	if !errors.Is(err, ErrDenied) {
		t.Errorf("ReadFile(.key) err = %v, want ErrDenied", err)
	}
}

func TestReadFileReal(t *testing.T) {
	dir := t.TempDir()
	p := filepath.Join(dir, "test.jsonl")
	if err := os.WriteFile(p, []byte("hello"), 0644); err != nil {
		t.Fatal(err)
	}
	data, err := ReadFile(p)
	if err != nil {
		t.Fatal(err)
	}
	if string(data) != "hello" {
		t.Errorf("got %q, want %q", data, "hello")
	}
}

func TestStatDenied(t *testing.T) {
	_, err := Stat("/any/.credentials.json")
	if !errors.Is(err, ErrDenied) {
		t.Errorf("Stat(.credentials.json) err = %v, want ErrDenied", err)
	}
}

func TestReadRange(t *testing.T) {
	dir := t.TempDir()
	p := filepath.Join(dir, "data.jsonl")
	if err := os.WriteFile(p, []byte("0123456789"), 0644); err != nil {
		t.Fatal(err)
	}
	data, err := ReadRange(p, 3, 7)
	if err != nil {
		t.Fatal(err)
	}
	if string(data) != "3456" {
		t.Errorf("ReadRange(3,7) = %q, want %q", data, "3456")
	}
}

func TestStatForTailerMissing(t *testing.T) {
	_, _, ok, err := StatForTailer("/nonexistent/path.jsonl")
	if err != nil {
		t.Fatal(err)
	}
	if ok {
		t.Error("expected ok=false for missing file")
	}
}
