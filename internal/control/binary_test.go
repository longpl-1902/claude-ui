package control

import (
	"path/filepath"
	"testing"
)

func TestResolveClaude_Override(t *testing.T) {
	p, err := ResolveClaude("/opt/claude.exe", nil, "/home/u", func(s string) bool {
		return s == "/opt/claude.exe"
	})
	if err != nil {
		t.Fatal(err)
	}
	if p != "/opt/claude.exe" {
		t.Errorf("path = %q", p)
	}
}

func TestResolveClaude_OverrideMissing(t *testing.T) {
	_, err := ResolveClaude("/opt/claude.exe", nil, "/home/u", func(string) bool { return false })
	if err == nil {
		t.Fatal("expected error")
	}
}

func TestResolveClaude_OverrideCmdRefused(t *testing.T) {
	_, err := ResolveClaude("/opt/claude.cmd", nil, "/home/u", func(string) bool { return true })
	if err == nil {
		t.Fatal("expected error for .cmd override")
	}
}

func TestResolveClaude_HomeFallback(t *testing.T) {
	home := t.TempDir()
	want := filepath.Join(home, ".local", "bin", "claude.exe")
	p, err := ResolveClaude("", nil, home, func(s string) bool {
		return s == want
	})
	if err != nil {
		t.Fatal(err)
	}
	if p != want {
		t.Errorf("path = %q", p)
	}
}

func TestResolveClaude_NothingFound(t *testing.T) {
	_, err := ResolveClaude("", nil, "/home/u", func(string) bool { return false })
	if err == nil {
		t.Fatal("expected error")
	}
	if err.Error() != "claude.exe not found; set claudePath in ac config" {
		t.Errorf("error = %q", err.Error())
	}
}

func TestIsCmdShim(t *testing.T) {
	tests := []struct {
		path string
		want bool
	}{
		{"claude.cmd", true},
		{"claude.CMD", true},
		{"claude.bat", true},
		{"claude.exe", false},
		{"claude", false},
	}
	for _, tt := range tests {
		if got := isCmdShim(tt.path); got != tt.want {
			t.Errorf("isCmdShim(%q) = %v, want %v", tt.path, got, tt.want)
		}
	}
}
