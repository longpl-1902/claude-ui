package platform

import (
	"runtime"
	"strings"
	"testing"
)

func TestBuildWTCommand(t *testing.T) {
	// Absolute on the host OS: validation uses filepath.IsAbs.
	root := "/home/u"
	if runtime.GOOS == "windows" {
		root = "C:/Users/u"
	}
	tests := []struct {
		name    string
		o       WTOpen
		wantErr bool
		check   func([]string) error
	}{
		{
			name: "valid",
			o: WTOpen{
				Cwd:        root + "/work",
				Title:      "test session",
				ConfigDir:  root + "/.claude",
				ClaudePath: root + "/bin/claude",
				SessionID:  "11111111-aaaa-4bbb-8ccc-000000000001",
			},
		},
		{
			name: "relative cwd",
			o: WTOpen{
				Cwd:        "relative/path",
				Title:      "test",
				ConfigDir:  root + "/.claude",
				ClaudePath: root + "/bin/claude",
				SessionID:  "11111111-aaaa-4bbb-8ccc-000000000001",
			},
			wantErr: true,
		},
		{
			name: "relative configDir",
			o: WTOpen{
				Cwd:        root + "/work",
				Title:      "test",
				ConfigDir:  "relative/.claude",
				ClaudePath: root + "/bin/claude",
				SessionID:  "11111111-aaaa-4bbb-8ccc-000000000001",
			},
			wantErr: true,
		},
		{
			name: "bad session id",
			o: WTOpen{
				Cwd:        root + "/work",
				Title:      "test",
				ConfigDir:  root + "/.claude",
				ClaudePath: root + "/bin/claude",
				SessionID:  "not-a-uuid",
			},
			wantErr: true,
		},
		{
			name: "quotes in title",
			o: WTOpen{
				Cwd:        root + "/work",
				Title:      `test "quoted"`,
				ConfigDir:  root + "/.claude",
				ClaudePath: root + "/bin/claude",
				SessionID:  "11111111-aaaa-4bbb-8ccc-000000000001",
			},
			wantErr: true,
		},
	}

	for _, tt := range tests {
		t.Run(tt.name, func(t *testing.T) {
			args, err := BuildWTCommand(tt.o)
			if tt.wantErr {
				if err == nil {
					t.Error("expected error, got nil")
				}
				return
			}
			if err != nil {
				t.Fatalf("unexpected error: %v", err)
			}
			if len(args) == 0 {
				t.Fatal("empty args")
			}
			joined := strings.Join(args, " ")
			if !strings.Contains(joined, tt.o.SessionID) {
				t.Errorf("args don't contain session id: %s", joined)
			}
			if !strings.Contains(joined, "CLAUDE_CONFIG_DIR") {
				t.Errorf("args don't set CLAUDE_CONFIG_DIR: %s", joined)
			}
		})
	}
}

func TestEditorCmd(t *testing.T) {
	tests := []struct {
		editor     string
		inTerminal bool
	}{
		{"nvim", true},
		{"vim", true},
		{"hx", true},
		{"code", false},
		{"notepad", false},
	}

	for _, tt := range tests {
		t.Run(tt.editor, func(t *testing.T) {
			r := EditorCmd("/tmp/test.go", 42, tt.editor, "")
			if r.InTerminal != tt.inTerminal {
				t.Errorf("InTerminal = %v, want %v", r.InTerminal, tt.inTerminal)
			}
			if len(r.Cmd) == 0 {
				t.Fatal("empty cmd")
			}
		})
	}
}
