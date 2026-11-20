package transcript

import (
	"strings"
	"testing"
)

// Lines shaped like real Claude Code transcripts: cwd/gitBranch/entrypoint are
// top-level on user and assistant lines, titles are their own record types.
const (
	realSnapshot = `{"type":"file-history-snapshot","messageId":"m0","snapshot":{"trackedFileBackups":{},"timestamp":"2026-03-01T09:59:59.000Z"},"isSnapshotUpdate":false}`
	realUser     = `{"parentUuid":null,"isSidechain":false,"userType":"external","cwd":"C:\\Users\\u\\work\\acme","sessionId":"s1","version":"2.0.0","gitBranch":"main","entrypoint":"cli","type":"user","message":{"role":"user","content":"Fix the   login\nredirect bug in the acme service because users get bounced to the wrong page"},"uuid":"u1","timestamp":"2026-03-01T10:00:00.000Z"}`
	realAssist   = `{"parentUuid":"u1","isSidechain":false,"cwd":"C:\\Users\\u\\work\\acme","sessionId":"s1","type":"assistant","message":{"id":"msg_1","role":"assistant","content":[{"type":"text","text":"ok"}]},"uuid":"a1","timestamp":"2026-03-01T10:00:05.000Z"}`
	realAI       = `{"type":"ai-title","sessionId":"s1","aiTitle":"Fix login redirect"}`
	realCustom   = `{"type":"custom-title","sessionId":"s1","customTitle":"My rename"}`
	realAgent    = `{"type":"agent-name","sessionId":"s1","agentName":"reviewer"}`
	realSummary  = `{"type":"summary","summary":"Login redirect fix","leafUuid":"a1"}`
)

func join(crlf bool, lines ...string) []byte {
	sep := "\n"
	if crlf {
		sep = "\r\n"
	}
	return []byte(strings.Join(lines, sep) + sep)
}

func TestScanMeta_CwdFromTopLevelUserLine(t *testing.T) {
	for _, crlf := range []bool{false, true} {
		m := ScanMeta(join(crlf, realSnapshot, realUser, realAssist), nil)
		if m.Cwd != `C:\Users\u\work\acme` {
			t.Errorf("crlf=%v Cwd = %q", crlf, m.Cwd)
		}
		if m.Branch != "main" || m.Entrypoint != "cli" {
			t.Errorf("crlf=%v branch=%q entrypoint=%q", crlf, m.Branch, m.Entrypoint)
		}
		if !m.HasPrompt {
			t.Errorf("crlf=%v HasPrompt = false", crlf)
		}
		if m.LastTs.IsZero() {
			t.Errorf("crlf=%v LastTs zero", crlf)
		}
	}
}

func TestScanMeta_TitlePrecedence(t *testing.T) {
	cases := []struct {
		name  string
		lines []string
		title string
		kind  string
	}{
		{"custom beats all", []string{realUser, realSummary, realAgent, realAI, realCustom}, "My rename", TitleCustom},
		{"ai beats agent/summary/prompt", []string{realUser, realSummary, realAgent, realAI}, "Fix login redirect", TitleAI},
		{"agent-name beats summary", []string{realUser, realSummary, realAgent}, "reviewer", TitleAgentName},
		{"summary beats prompt", []string{realUser, realSummary}, "Login redirect fix", TitleSummary},
		{"first prompt fallback", []string{realSnapshot, realUser}, "Fix the login redirect bug in the acme service because user…", TitlePrompt},
	}
	for _, c := range cases {
		m := ScanMeta(join(false, c.lines...), nil)
		if m.Title != c.title || m.TitleKind != c.kind {
			t.Errorf("%s: got %q (%s), want %q (%s)", c.name, m.Title, m.TitleKind, c.title, c.kind)
		}
	}
}

func TestScanMeta_TitleFromTailWinsOverHeadAndLastOfKindWins(t *testing.T) {
	head := join(false, realUser, realAI)
	tail := join(true, `{"type":"ai-title","sessionId":"s1","aiTitle":"Newer title"}`)
	m := ScanMeta(head, tail)
	if m.Title != "Newer title" {
		t.Errorf("Title = %q", m.Title)
	}
}

func TestScanMeta_FirstPromptIsOneLineAndShort(t *testing.T) {
	m := ScanMeta(join(false, realUser), nil)
	if strings.ContainsAny(m.Title, "\n\r\t") || strings.Contains(m.Title, "  ") {
		t.Errorf("title not one line: %q", m.Title)
	}
	if n := len([]rune(m.Title)); n > MaxTitleRunes {
		t.Errorf("title has %d runes", n)
	}
	if !strings.HasPrefix(m.Title, "Fix the login redirect bug") {
		t.Errorf("Title = %q", m.Title)
	}
}

func TestScanMeta_NonPromptUserLinesAreIgnored(t *testing.T) {
	lines := []string{
		realSnapshot,
		`{"type":"user","isMeta":true,"cwd":"C:\\Users\\u\\work\\acme","message":{"role":"user","content":"Caveat: local commands"},"uuid":"x1","timestamp":"2026-03-01T10:00:00.000Z"}`,
		`{"type":"user","message":{"role":"user","content":"<system-reminder>be nice</system-reminder>"},"uuid":"x2","timestamp":"2026-03-01T10:00:01.000Z"}`,
		`{"type":"user","message":{"role":"user","content":[{"type":"tool_result","tool_use_id":"t1","content":"out"}]},"uuid":"x3","timestamp":"2026-03-01T10:00:02.000Z"}`,
		`{"type":"user","message":{"role":"user","content":[{"type":"text","text":"[Request interrupted by user]"}]},"uuid":"x4","timestamp":"2026-03-01T10:00:03.000Z"}`,
		`{"type":"user","isSidechain":true,"message":{"role":"user","content":"sub-agent task"},"uuid":"x5","timestamp":"2026-03-01T10:00:04.000Z"}`,
	}
	m := ScanMeta(join(false, lines...), nil)
	if m.HasPrompt || m.Title != "" || m.FirstPrompt != "" {
		t.Errorf("expected no prompt, got %+v", m)
	}
}

func TestScanMeta_SlashCommandPrompt(t *testing.T) {
	line := `{"type":"user","cwd":"/w/acme","message":{"role":"user","content":"<command-message>review</command-message>\n<command-name>/review</command-name>\n<command-args>123</command-args>"},"uuid":"c1","timestamp":"2026-03-01T10:00:00.000Z"}`
	m := ScanMeta(join(false, line), nil)
	if m.Title != "/review 123" {
		t.Errorf("Title = %q", m.Title)
	}
}

func TestScanMeta_OversizedFirstLine(t *testing.T) {
	// 300 KiB snapshot first line, then a normal session.
	big := `{"type":"file-history-snapshot","messageId":"m0","snapshot":{"x":"` + strings.Repeat("a", 300*1024) + `"}}`
	data := join(false, big, realUser, realAI)
	m := ScanMeta(data, nil)
	if m.Cwd != `C:\Users\u\work\acme` || m.Title != "Fix login redirect" || !m.HasPrompt {
		t.Errorf("got %+v", m)
	}

	// The head window ends inside a huge pasted first prompt: the prompt line
	// is cut, yet the session still counts and its cwd is recovered.
	prompt := `{"type":"user","cwd":"C:\\Users\\u\\work\\acme","sessionId":"s1","message":{"role":"user","content":"` + strings.Repeat("p", 300*1024) + `"},"uuid":"u9","timestamp":"2026-03-01T10:00:00.000Z"}`
	cut := []byte(prompt)[:100*1024]
	m = ScanMeta(cut, nil)
	if !m.HasPrompt || m.Cwd != `C:\Users\u\work\acme` {
		t.Errorf("cut prompt: got %+v", m)
	}
}

func TestScanMeta_TailStartsMidLine(t *testing.T) {
	tail := []byte(`ddle of a line"}}` + "\n" + realAI + "\n")
	m := ScanMeta(nil, tail)
	if m.Title != "Fix login redirect" || m.HasPrompt {
		t.Errorf("got %+v", m)
	}
}

func TestScanMeta_EmptySessionHasNoPrompt(t *testing.T) {
	m := ScanMeta(join(false, realSnapshot, realAI), nil)
	if m.HasPrompt {
		t.Error("snapshot/title-only transcript must not count as a session")
	}
}

func TestOneLine(t *testing.T) {
	if got := OneLine("  a \n\t b  ", 10); got != "a b" {
		t.Errorf("got %q", got)
	}
	if got := OneLine("abcdefghij", 5); got != "abcd…" {
		t.Errorf("got %q", got)
	}
}
