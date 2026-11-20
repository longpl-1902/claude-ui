package control

import (
	"encoding/json"
	"testing"
)

func TestStripANSI(t *testing.T) {
	tests := []struct {
		in, want string
	}{
		{"\x1b[31mred\x1b[0m", "red"},
		{"\x1b[1;32mbold green\x1b[0m", "bold green"},
		{"no ansi here", "no ansi here"},
		{"", ""},
	}
	for _, tt := range tests {
		got := stripANSI(tt.in)
		if got != tt.want {
			t.Errorf("stripANSI(%q) = %q, want %q", tt.in, got, tt.want)
		}
	}
}

func TestSessionScopedSuggestions(t *testing.T) {
	raw := json.RawMessage(`[{"type":"addRules","destination":"global"},{"type":"deleteFile","destination":"session"},{"type":"setMode","destination":"global"}]`)
	result := SessionScopedSuggestions(raw)
	var out []map[string]any
	if err := json.Unmarshal(result, &out); err != nil {
		t.Fatalf("invalid JSON: %v", err)
	}
	if len(out) != 2 {
		t.Fatalf("expected 2, got %d", len(out))
	}
	for _, s := range out {
		if s["destination"] != "session" {
			t.Errorf("destination = %v, want session", s["destination"])
		}
	}
}

func TestSessionScopedSuggestions_Nil(t *testing.T) {
	if result := SessionScopedSuggestions(nil); result != nil {
		t.Errorf("expected nil, got %s", result)
	}
}

func TestSessionScopedSuggestions_Empty(t *testing.T) {
	raw := json.RawMessage(`[{"type":"deleteFile"}]`)
	if result := SessionScopedSuggestions(raw); result != nil {
		t.Errorf("expected nil for no allowed types, got %s", result)
	}
}
