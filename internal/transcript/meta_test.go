package transcript

import (
	"os"
	"testing"
)

func TestScanMeta_LeadBasic(t *testing.T) {
	data, err := os.ReadFile("testdata/lead_basic.jsonl")
	if err != nil {
		t.Fatal(err)
	}

	m := ScanMeta(data, nil)
	if m.Cwd != `d:\work\demo` {
		t.Errorf("Cwd = %q", m.Cwd)
	}
	if m.Title != "fix login redirect" {
		t.Errorf("Title = %q", m.Title)
	}
	if m.TitleKind != "ai" {
		t.Errorf("TitleKind = %q", m.TitleKind)
	}
	if m.FirstPrompt != "Fix the login redirect bug" {
		t.Errorf("FirstPrompt = %q", m.FirstPrompt)
	}
	if m.LastTs.IsZero() {
		t.Error("LastTs is zero")
	}
}

func TestScanMeta_TitlePriority(t *testing.T) {
	head := []byte(`{"uuid":"a","timestamp":"2026-01-01T00:00:00Z","type":"system","message":{"subtype":"init","cwd":"/tmp","agentName":"my-agent"}}
{"uuid":"b","timestamp":"2026-01-01T00:00:01Z","type":"title","message":{"title":"AI Generated","titleType":"ai-title"}}
`)
	tail := []byte(`{"uuid":"c","timestamp":"2026-01-01T00:00:02Z","type":"title","message":{"title":"My Custom Title","titleType":"custom-title"}}
`)

	m := ScanMeta(head, tail)
	if m.Title != "My Custom Title" {
		t.Errorf("expected custom title to win, got %q (kind %q)", m.Title, m.TitleKind)
	}
	if m.TitleKind != "custom" {
		t.Errorf("TitleKind = %q", m.TitleKind)
	}
}

func TestScanMeta_AgentNameOnly(t *testing.T) {
	data := []byte(`{"uuid":"a","timestamp":"2026-01-01T00:00:00Z","type":"system","message":{"subtype":"init","cwd":"/tmp","agentName":"reviewer"}}
`)
	m := ScanMeta(data, nil)
	if m.Title != "reviewer" {
		t.Errorf("Title = %q", m.Title)
	}
	if m.TitleKind != "agent-name" {
		t.Errorf("TitleKind = %q", m.TitleKind)
	}
}

func TestScanMeta_Empty(t *testing.T) {
	m := ScanMeta(nil, nil)
	if m.Cwd != "" || m.Title != "" || m.FirstPrompt != "" {
		t.Errorf("expected empty meta, got %+v", m)
	}
}

func TestScanMeta_Garbage(t *testing.T) {
	data, err := os.ReadFile("testdata/garbage.jsonl")
	if err != nil {
		t.Fatal(err)
	}
	// Must not panic
	_ = ScanMeta(data, nil)
}
