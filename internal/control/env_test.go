package control

import (
	"strings"
	"testing"
)

func TestChildEnv_StripsVars(t *testing.T) {
	base := []string{
		"PATH=/usr/bin",
		"HOME=/home/u",
		"ELECTRON_RUN_AS_NODE=1",
		"CLAUDE_CONFIG_DIR=/old",
		"CLAUDE_CODE_SESSION_ID=abc",
		"CLAUDECODE=1",
		"claude_pid=1234",
		"MCP_CONNECTION_NONBLOCKING=1",
		"CLAUDE_CODE_ENABLE_SDK_FILE_CHECKPOINTING=0",
		"CLAUDE_CODE_ENABLE_TASKS=1",
		"CLAUDE_CODE_QUESTION_PREVIEW_FORMAT=json",
		"OTHER_VAR=keep",
	}
	out, err := ChildEnv(base, "/home/u/.claude")
	if err != nil {
		t.Fatal(err)
	}

	env := envMap(out)

	for _, stripped := range []string{
		"ELECTRON_RUN_AS_NODE",
		"CLAUDE_CODE_SESSION_ID",
		"CLAUDECODE",
		"MCP_CONNECTION_NONBLOCKING",
		"CLAUDE_CODE_ENABLE_TASKS",
		"CLAUDE_CODE_QUESTION_PREVIEW_FORMAT",
	} {
		if _, ok := env[strings.ToUpper(stripped)]; ok {
			t.Errorf("%s should be stripped", stripped)
		}
	}

	if env["CLAUDE_CONFIG_DIR"] != "/home/u/.claude" {
		t.Errorf("CLAUDE_CONFIG_DIR = %q", env["CLAUDE_CONFIG_DIR"])
	}
	if env["CLAUDE_CODE_ENABLE_SDK_FILE_CHECKPOINTING"] != "1" {
		t.Errorf("CLAUDE_CODE_ENABLE_SDK_FILE_CHECKPOINTING = %q", env["CLAUDE_CODE_ENABLE_SDK_FILE_CHECKPOINTING"])
	}
	if env["PATH"] != "/usr/bin" {
		t.Errorf("PATH = %q", env["PATH"])
	}
	if env["OTHER_VAR"] != "keep" {
		t.Errorf("OTHER_VAR = %q", env["OTHER_VAR"])
	}
}

func TestChildEnv_SetsTerm(t *testing.T) {
	base := []string{"PATH=/usr/bin"}
	out, err := ChildEnv(base, "/home/u/.claude")
	if err != nil {
		t.Fatal(err)
	}
	env := envMap(out)
	if env["TERM"] != "xterm-256color" {
		t.Errorf("TERM = %q", env["TERM"])
	}
	if env["COLORTERM"] != "truecolor" {
		t.Errorf("COLORTERM = %q", env["COLORTERM"])
	}
}

func TestChildEnv_PreservesTerm(t *testing.T) {
	base := []string{"PATH=/usr/bin", "TERM=screen-256color", "COLORTERM=24bit"}
	out, err := ChildEnv(base, "/home/u/.claude")
	if err != nil {
		t.Fatal(err)
	}
	env := envMap(out)
	if env["TERM"] != "screen-256color" {
		t.Errorf("TERM = %q, want screen-256color", env["TERM"])
	}
	if env["COLORTERM"] != "24bit" {
		t.Errorf("COLORTERM = %q, want 24bit", env["COLORTERM"])
	}
}

func TestChildEnv_RelativePath(t *testing.T) {
	_, err := ChildEnv(nil, "relative/path")
	if err == nil {
		t.Fatal("expected error for relative path")
	}
}

func TestChildEnv_CaseInsensitiveStrip(t *testing.T) {
	base := []string{
		"Claude_Config_Dir=/old",
		"electron_run_as_node=1",
		"Claude_PID=999",
	}
	out, err := ChildEnv(base, "/home/u/.claude")
	if err != nil {
		t.Fatal(err)
	}
	for _, e := range out {
		name, _, _ := strings.Cut(e, "=")
		lower := strings.ToLower(name)
		if lower == "electron_run_as_node" || lower == "claude_pid" {
			t.Errorf("should have stripped %s", name)
		}
	}
}

func envMap(env []string) map[string]string {
	m := make(map[string]string)
	for _, e := range env {
		name, val, ok := strings.Cut(e, "=")
		if ok {
			m[strings.ToUpper(name)] = val
		}
	}
	return m
}
