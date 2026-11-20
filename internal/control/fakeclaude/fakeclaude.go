// Package fakeclaude is a scripted stand-in for the claude binary. Test
// packages call MaybeRun first thing in TestMain and use os.Args[0] as the
// claude path. No real claude is ever started (R-19).
package fakeclaude

import (
	"bufio"
	"encoding/json"
	"fmt"
	"io"
	"os"
	"os/exec"
	"strconv"
	"strings"
	"sync"
	"time"
)

const (
	EnvScript = "AC_FAKE_CLAUDE"
	EnvLog    = "AC_FAKE_CLAUDE_LOG"

	// HangScript is the EnvScript value of the grandchild.
	HangScript = "hang-script"

	SessionUUID = "11111111-2222-4333-8444-555555555555"
	ForkUUID    = "11111111-2222-4333-8444-666666666666"
)

// MaybeRun runs the script named by EnvScript and exits; it returns at once
// when EnvScript is unset.
func MaybeRun() {
	script := os.Getenv(EnvScript)
	if script == "" {
		return
	}
	if script == HangScript {
		logLine(map[string]any{"hang_pid": os.Getpid()})
		sleepForever()
	}
	os.Exit(run(script))
}

var logMu sync.Mutex

func logLine(v any) {
	path := os.Getenv(EnvLog)
	if path == "" {
		return
	}
	b, err := json.Marshal(v)
	if err != nil {
		return
	}
	logMu.Lock()
	defer logMu.Unlock()
	f, err := os.OpenFile(path, os.O_APPEND|os.O_CREATE|os.O_WRONLY, 0o600)
	if err != nil {
		return
	}
	defer f.Close()
	_, _ = f.Write(append(b, '\n'))
}

type fake struct {
	in      *bufio.Reader
	lastReq string
}

// validateFrame mimics the real CLI's input validation: a control_request
// without a "request" object, or a user turn without a message object, makes
// the process exit 1 (this is what the invented protocol hit on Windows).
func validateFrame(m map[string]any) {
	switch m["type"] {
	case "control_request":
		if _, ok := m["request"].(map[string]any); !ok {
			fmt.Fprintln(os.Stderr, "Error: Missing request on control_request")
			os.Exit(1)
		}
	case "user":
		if _, ok := m["message"].(map[string]any); !ok {
			fmt.Fprintln(os.Stderr, "Error: Missing message on user frame")
			os.Exit(1)
		}
	case "control_response":
		if _, ok := m["response"].(map[string]any); !ok {
			fmt.Fprintln(os.Stderr, "Error: Missing response on control_response")
			os.Exit(1)
		}
	}
}

// readFrame returns the next stdin line (logged); io.EOF at end of input.
func (f *fake) readFrame() (map[string]any, error) {
	for {
		line, err := f.in.ReadBytes('\n')
		line = []byte(strings.TrimSpace(string(line)))
		if len(line) > 0 {
			var m map[string]any
			if jerr := json.Unmarshal(line, &m); jerr != nil {
				m = map[string]any{"_raw": string(line)}
			}
			logLine(map[string]any{"frame": m})
			validateFrame(m)
			if id, ok := m["request_id"].(string); ok {
				f.lastReq = id
			}
			return m, nil
		}
		if err != nil {
			return nil, err
		}
	}
}

func run(path string) int {
	data, err := os.ReadFile(path)
	if err != nil {
		fmt.Fprintln(os.Stderr, "fakeclaude: read script:", err)
		return 4
	}
	cwd, _ := os.Getwd()
	logLine(map[string]any{
		"argv":           os.Args[1:],
		"cwd":            cwd,
		"env_config_dir": os.Getenv("CLAUDE_CONFIG_DIR"),
		"pid":            os.Getpid(),
		"has_electron":   os.Getenv("ELECTRON_RUN_AS_NODE") != "",
	})

	f := &fake{in: bufio.NewReaderSize(os.Stdin, 1<<20)}
	out := os.Stdout

	for n, raw := range strings.Split(string(data), "\n") {
		line := strings.TrimSpace(raw)
		if line == "" || strings.HasPrefix(line, "#") {
			continue
		}
		cmd, arg, _ := strings.Cut(line, " ")
		arg = strings.TrimSpace(arg)
		switch cmd {
		case "expect":
			var want any
			if err := json.Unmarshal([]byte(arg), &want); err != nil {
				fmt.Fprintf(os.Stderr, "fakeclaude: line %d: bad expect json: %v\n", n+1, err)
				return 4
			}
			got, err := f.readFrame()
			if err != nil {
				fmt.Fprintf(os.Stderr, "fakeclaude: line %d: expected frame, got %v\n", n+1, err)
				return 3
			}
			if !subset(want, got) {
				b, _ := json.Marshal(got)
				fmt.Fprintf(os.Stderr, "fakeclaude: line %d: frame mismatch: want %s got %s\n", n+1, arg, b)
				return 3
			}
		case "reply":
			var body any
			if err := json.Unmarshal([]byte(arg), &body); err != nil {
				fmt.Fprintf(os.Stderr, "fakeclaude: line %d: bad reply json: %v\n", n+1, err)
				return 4
			}
			b, _ := json.Marshal(map[string]any{"type": "control_response", "response": map[string]any{
				"subtype": "success", "request_id": f.lastReq, "response": body}})
			_, _ = out.Write(append(b, '\n'))
		case "reply-error":
			b, _ := json.Marshal(map[string]any{"type": "control_response", "response": map[string]any{
				"subtype": "error", "request_id": f.lastReq, "error": arg}})
			_, _ = out.Write(append(b, '\n'))
		case "emit":
			arg = strings.ReplaceAll(arg, "{{session}}", SessionUUID)
			arg = strings.ReplaceAll(arg, "{{fork}}", ForkUUID)
			_, _ = out.WriteString(arg + "\n")
		case "sleep":
			ms, _ := strconv.Atoi(arg)
			time.Sleep(time.Duration(ms) * time.Millisecond)
		case "stderr":
			fmt.Fprintln(os.Stderr, arg)
		case "wait-eof":
			for {
				if _, err := f.readFrame(); err != nil {
					break
				}
			}
		case "hang":
			go func() { // keep draining stdin so the parent never blocks
				_, _ = io.Copy(io.Discard, f.in)
			}()
			sleepForever()
		case "grandchild":
			c := exec.Command(os.Args[0])
			c.Env = append(os.Environ(), EnvScript+"="+HangScript)
			if err := c.Start(); err != nil {
				fmt.Fprintln(os.Stderr, "fakeclaude: grandchild:", err)
				return 4
			}
			logLine(map[string]any{"grandchild_pid": c.Process.Pid})
		case "exit":
			code, _ := strconv.Atoi(arg)
			return code
		default:
			fmt.Fprintf(os.Stderr, "fakeclaude: line %d: unknown directive %q\n", n+1, cmd)
			return 4
		}
	}
	// Script finished without exit: keep logging frames until stdin closes.
	for {
		if _, err := f.readFrame(); err != nil {
			return 0
		}
	}
}

// subset reports whether every key/value in want appears in got.
func subset(want, got any) bool {
	switch w := want.(type) {
	case map[string]any:
		g, ok := got.(map[string]any)
		if !ok {
			return false
		}
		for k, wv := range w {
			gv, ok := g[k]
			if !ok || !subset(wv, gv) {
				return false
			}
		}
		return true
	case []any:
		g, ok := got.([]any)
		if !ok || len(g) != len(w) {
			return false
		}
		for i := range w {
			if !subset(w[i], g[i]) {
				return false
			}
		}
		return true
	default:
		return want == got
	}
}

// sleepForever blocks without tripping Go's all-goroutines-asleep detector,
// which would otherwise kill the fake as soon as nothing else is running.
func sleepForever() {
	for {
		time.Sleep(time.Hour)
	}
}
