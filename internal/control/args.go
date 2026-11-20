package control

import (
	"encoding/json"
	"errors"
	"fmt"
	"regexp"
	"strings"
)

type Launch struct {
	ClaudePath  string
	ConfigDir   string
	Mode        string
	Model       string
	Effort      string
	OutputStyle string
	SessionID   string
	Fork        bool
	ResumeAt    string
	Cwd         string
}

var (
	modelRe   = regexp.MustCompile(`^[A-Za-z0-9._\[\]-]{1,64}$`)
	sessionRe = regexp.MustCompile(`^[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}$`)
	styleRe   = regexp.MustCompile(`^[A-Za-z0-9 _.-]{1,64}$`)
	modeSet   = map[string]bool{
		"default":     true,
		"acceptEdits": true,
		"plan":        true,
		"auto":        true,
		"dontAsk":     true,
	}
	effortSet = map[string]bool{
		"low":    true,
		"medium": true,
		"high":   true,
		"xhigh":  true,
		"max":    true,
	}

	dangerousFlags = []string{
		"--dangerously-skip-permissions",
		"--dangerously",
		"bypassPermissions",
		"--no-verify",
	}
)

func BuildArgs(l Launch) ([]string, error) {
	if l.Mode == "" {
		l.Mode = "default"
	}
	if !modeSet[l.Mode] {
		return nil, fmt.Errorf("invalid mode: %q", l.Mode)
	}

	args := []string{
		"-p",
		"--input-format", "stream-json",
		"--output-format", "stream-json",
		"--verbose",
		"--include-partial-messages",
		"--permission-prompt-tool", "stdio",
		"--permission-mode", l.Mode,
		"--replay-user-messages",
	}

	if l.Model != "" {
		if strings.HasPrefix(l.Model, "-") {
			return nil, fmt.Errorf("model must not start with '-': %q", l.Model)
		}
		if !modelRe.MatchString(l.Model) {
			return nil, fmt.Errorf("invalid model: %q", l.Model)
		}
		args = append(args, "--model", l.Model)
	}

	if l.Effort != "" {
		if !effortSet[l.Effort] {
			return nil, fmt.Errorf("invalid effort: %q", l.Effort)
		}
		args = append(args, "--effort", l.Effort)
	}

	if l.OutputStyle != "" {
		if !styleRe.MatchString(l.OutputStyle) {
			return nil, fmt.Errorf("invalid output style: %q", l.OutputStyle)
		}
		b, _ := json.Marshal(map[string]string{"outputStyle": l.OutputStyle})
		args = append(args, "--settings", string(b))
	}

	if l.SessionID != "" {
		if !sessionRe.MatchString(l.SessionID) {
			return nil, fmt.Errorf("invalid session id: %q", l.SessionID)
		}
		args = append(args, "--resume", l.SessionID)

		if l.Fork {
			args = append(args, "--fork-session")
			if l.ResumeAt != "" {
				if !sessionRe.MatchString(l.ResumeAt) {
					return nil, fmt.Errorf("invalid resume-at id: %q", l.ResumeAt)
				}
				args = append(args, "--resume-session-at", l.ResumeAt)
			}
		}
	} else if l.Fork {
		return nil, errors.New("fork requires a session id")
	}

	for _, a := range args {
		for _, d := range dangerousFlags {
			if strings.Contains(strings.ToLower(a), strings.ToLower(d)) {
				return nil, fmt.Errorf("refusing dangerous flag: %s", a)
			}
		}
	}

	return args, nil
}
