package control

import (
	"strings"
	"testing"
)

func TestBuildArgs_Basic(t *testing.T) {
	args, err := BuildArgs(Launch{Mode: "default"})
	if err != nil {
		t.Fatal(err)
	}
	want := []string{
		"-p",
		"--input-format", "stream-json",
		"--output-format", "stream-json",
		"--verbose",
		"--include-partial-messages",
		"--permission-prompt-tool", "stdio",
		"--permission-mode", "default",
		"--replay-user-messages",
	}
	if len(args) != len(want) {
		t.Fatalf("args = %v, want %v", args, want)
	}
	for i := range want {
		if args[i] != want[i] {
			t.Errorf("args[%d] = %q, want %q", i, args[i], want[i])
		}
	}
}

func TestBuildArgs_DefaultMode(t *testing.T) {
	args, err := BuildArgs(Launch{})
	if err != nil {
		t.Fatal(err)
	}
	found := false
	for i, a := range args {
		if a == "--permission-mode" && i+1 < len(args) {
			if args[i+1] != "default" {
				t.Errorf("mode = %q", args[i+1])
			}
			found = true
		}
	}
	if !found {
		t.Error("--permission-mode not found")
	}
}

func TestBuildArgs_WithModel(t *testing.T) {
	args, err := BuildArgs(Launch{Model: "claude-opus-4"})
	if err != nil {
		t.Fatal(err)
	}
	found := false
	for i, a := range args {
		if a == "--model" && i+1 < len(args) && args[i+1] == "claude-opus-4" {
			found = true
		}
	}
	if !found {
		t.Error("--model claude-opus-4 not found")
	}
}

func TestBuildArgs_WithResume(t *testing.T) {
	args, err := BuildArgs(Launch{
		SessionID: "11111111-aaaa-4bbb-8ccc-000000000001",
	})
	if err != nil {
		t.Fatal(err)
	}
	found := false
	for i, a := range args {
		if a == "--resume" && i+1 < len(args) {
			found = true
		}
	}
	if !found {
		t.Error("--resume not found")
	}
}

func TestBuildArgs_WithFork(t *testing.T) {
	args, err := BuildArgs(Launch{
		SessionID: "11111111-aaaa-4bbb-8ccc-000000000001",
		Fork:      true,
	})
	if err != nil {
		t.Fatal(err)
	}
	hasFork := false
	for _, a := range args {
		if a == "--fork-session" {
			hasFork = true
		}
	}
	if !hasFork {
		t.Error("--fork-session not found")
	}
}

func TestBuildArgs_WithForkAndResumeAt(t *testing.T) {
	args, err := BuildArgs(Launch{
		SessionID: "11111111-aaaa-4bbb-8ccc-000000000001",
		Fork:      true,
		ResumeAt:  "22222222-bbbb-4ccc-8ddd-000000000002",
	})
	if err != nil {
		t.Fatal(err)
	}
	hasResumeAt := false
	for i, a := range args {
		if a == "--resume-session-at" && i+1 < len(args) {
			hasResumeAt = true
		}
	}
	if !hasResumeAt {
		t.Error("--resume-session-at not found")
	}
}

func TestBuildArgs_WithEffort(t *testing.T) {
	args, err := BuildArgs(Launch{Effort: "high"})
	if err != nil {
		t.Fatal(err)
	}
	found := false
	for i, a := range args {
		if a == "--effort" && i+1 < len(args) && args[i+1] == "high" {
			found = true
		}
	}
	if !found {
		t.Error("--effort high not found")
	}
}

func TestBuildArgs_InvalidModel_StartsDash(t *testing.T) {
	_, err := BuildArgs(Launch{Model: "-evil"})
	if err == nil {
		t.Fatal("expected error for model starting with -")
	}
}

func TestBuildArgs_InvalidModel_BadChars(t *testing.T) {
	_, err := BuildArgs(Launch{Model: "model; rm -rf /"})
	if err == nil {
		t.Fatal("expected error for invalid model")
	}
}

func TestBuildArgs_InvalidSessionID(t *testing.T) {
	_, err := BuildArgs(Launch{SessionID: "not-a-uuid"})
	if err == nil {
		t.Fatal("expected error for invalid session id")
	}
}

func TestBuildArgs_InvalidMode(t *testing.T) {
	_, err := BuildArgs(Launch{Mode: "bypassPermissions"})
	if err == nil {
		t.Fatal("expected error for invalid mode")
	}
}

func TestBuildArgs_InvalidEffort(t *testing.T) {
	_, err := BuildArgs(Launch{Effort: "ultra"})
	if err == nil {
		t.Fatal("expected error for invalid effort")
	}
}

func TestBuildArgs_ForkWithoutSession(t *testing.T) {
	_, err := BuildArgs(Launch{Fork: true})
	if err == nil {
		t.Fatal("expected error for fork without session")
	}
}

func TestBuildArgs_NeverDangerous(t *testing.T) {
	cases := []Launch{
		{},
		{Model: "opus", SessionID: "11111111-aaaa-4bbb-8ccc-000000000001", Fork: true},
		{Mode: "dontAsk"},
		{Effort: "high"},
	}
	dangerous := []string{"dangerously", "bypass", "--no-verify"}
	for _, l := range cases {
		args, err := BuildArgs(l)
		if err != nil {
			continue
		}
		joined := strings.Join(args, " ")
		lower := strings.ToLower(joined)
		for _, d := range dangerous {
			if strings.Contains(lower, d) {
				t.Errorf("args contain %q: %v", d, args)
			}
		}
	}
}

func TestBuildArgs_AllModes(t *testing.T) {
	for mode := range modeSet {
		_, err := BuildArgs(Launch{Mode: mode})
		if err != nil {
			t.Errorf("valid mode %q rejected: %v", mode, err)
		}
	}
}

func TestBuildArgs_AllEfforts(t *testing.T) {
	for effort := range effortSet {
		_, err := BuildArgs(Launch{Effort: effort})
		if err != nil {
			t.Errorf("valid effort %q rejected: %v", effort, err)
		}
	}
}
