package accounts

import (
	"encoding/json"
	"testing"
)

func TestStripJSONC(t *testing.T) {
	tests := []struct {
		name  string
		input string
		key   string
		val   string
	}{
		{
			name:  "line comment",
			input: "{\"key\": \"val\" // comment\n}",
			key:   "key",
			val:   "val",
		},
		{
			name:  "block comment",
			input: `{"key": /* inline */ "val"}`,
			key:   "key",
			val:   "val",
		},
		{
			name:  "trailing comma object",
			input: `{"key": "val",}`,
			key:   "key",
			val:   "val",
		},
		{
			name:  "trailing comma array",
			input: `{"arr": ["a", "b",]}`,
			key:   "arr",
		},
		{
			name:  "comment in string preserved",
			input: `{"key": "val // not a comment"}`,
			key:   "key",
			val:   "val // not a comment",
		},
	}
	for _, tt := range tests {
		t.Run(tt.name, func(t *testing.T) {
			clean := stripJSONC([]byte(tt.input))
			var m map[string]json.RawMessage
			if err := json.Unmarshal(clean, &m); err != nil {
				t.Fatalf("unmarshal failed: %v\ncleaned: %s", err, clean)
			}
			if tt.val != "" {
				var got string
				json.Unmarshal(m[tt.key], &got)
				if got != tt.val {
					t.Errorf("got %q, want %q", got, tt.val)
				}
			}
		})
	}
}
