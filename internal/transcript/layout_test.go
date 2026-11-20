package transcript

import (
	"os"
	"testing"
)

func TestEncodeProjectDir(t *testing.T) {
	tests := []struct {
		cwd  string
		want string
	}{
		{"d:\\work\\demo", "d--work-demo"},
		{"C:\\Users\\u\\project", "C--Users-u-project"},
		{"/home/u/code", "-home-u-code"},
		{"simple", "simple"},
	}
	for _, tt := range tests {
		t.Run(tt.cwd, func(t *testing.T) {
			got := EncodeProjectDir(tt.cwd)
			if got != tt.want {
				t.Errorf("EncodeProjectDir(%q) = %q, want %q", tt.cwd, got, tt.want)
			}
		})
	}
}

func TestEncodeProjectDir_LongPath(t *testing.T) {
	long := ""
	for i := 0; i < 250; i++ {
		long += "a"
	}
	got := EncodeProjectDir(long)
	if len(got) > 201 {
		t.Errorf("encoded length %d, expected <= 201", len(got))
	}
}

func TestSameProjectDir(t *testing.T) {
	if !SameProjectDir("d--work-demo", "D--Work-Demo") {
		t.Error("expected case-insensitive match")
	}
	if SameProjectDir("d--work-demo", "d--work-other") {
		t.Error("expected no match")
	}
}

func TestClassify(t *testing.T) {
	root := "C:/Users/u/.claude/projects"

	tests := []struct {
		name string
		abs  string
		want PathInfo
	}{
		{
			"main transcript",
			"C:/Users/u/.claude/projects/d--work-demo/11111111-aaaa-4bbb-8ccc-000000000001.jsonl",
			PathInfo{Kind: PathMain, SessionID: "11111111-aaaa-4bbb-8ccc-000000000001", ProjectDir: "d--work-demo"},
		},
		{
			"subagent",
			"C:/Users/u/.claude/projects/d--work-demo/11111111-aaaa-4bbb-8ccc-000000000001/subagents/agent-a1.jsonl",
			PathInfo{Kind: PathSubAgent, SessionID: "11111111-aaaa-4bbb-8ccc-000000000001", AgentID: "a1", ProjectDir: "d--work-demo"},
		},
		{
			"meta",
			"C:/Users/u/.claude/projects/d--work-demo/11111111-aaaa-4bbb-8ccc-000000000001/subagents/agent-a1.meta.json",
			PathInfo{Kind: PathMeta, SessionID: "11111111-aaaa-4bbb-8ccc-000000000001", AgentID: "a1", ProjectDir: "d--work-demo"},
		},
		{
			"case insensitive",
			"c:/users/u/.claude/projects/D--Work-Demo/session.jsonl",
			PathInfo{Kind: PathMain, SessionID: "session", ProjectDir: "d--work-demo"},
		},
		{
			"outside root",
			"/some/other/path/file.jsonl",
			PathInfo{Kind: PathUnknown},
		},
		{
			"too few parts",
			"C:/Users/u/.claude/projects/file",
			PathInfo{Kind: PathUnknown},
		},
	}
	for _, tt := range tests {
		t.Run(tt.name, func(t *testing.T) {
			got := Classify(tt.abs, root)
			if got.Kind != tt.want.Kind {
				t.Errorf("Kind = %v, want %v", got.Kind, tt.want.Kind)
			}
			if got.SessionID != tt.want.SessionID {
				t.Errorf("SessionID = %q, want %q", got.SessionID, tt.want.SessionID)
			}
			if got.AgentID != tt.want.AgentID {
				t.Errorf("AgentID = %q, want %q", got.AgentID, tt.want.AgentID)
			}
			if got.Kind != PathUnknown && got.ProjectDir != tt.want.ProjectDir {
				t.Errorf("ProjectDir = %q, want %q", got.ProjectDir, tt.want.ProjectDir)
			}
		})
	}
}

func TestParseRegistryEntry(t *testing.T) {
	data, err := os.ReadFile("testdata/registry/12345.json")
	if err != nil {
		t.Fatal(err)
	}

	entry, ok := ParseRegistryEntry(data)
	if !ok {
		t.Fatal("ParseRegistryEntry failed")
	}
	if entry.PID != 12345 {
		t.Errorf("PID = %d", entry.PID)
	}
	if entry.SessionID != "11111111-aaaa-4bbb-8ccc-000000000001" {
		t.Errorf("SessionID = %q", entry.SessionID)
	}
	if entry.Status != "busy" {
		t.Errorf("Status = %q", entry.Status)
	}
	if entry.Entrypoint != "cli" {
		t.Errorf("Entrypoint = %q", entry.Entrypoint)
	}
}

func TestParseRegistryEntry_Invalid(t *testing.T) {
	tests := []struct {
		name string
		data string
	}{
		{"empty", ""},
		{"no pid", `{"sessionId":"aaa","status":"busy"}`},
		{"no session", `{"pid":123,"status":"busy"}`},
		{"garbage", "not json"},
	}
	for _, tt := range tests {
		t.Run(tt.name, func(t *testing.T) {
			_, ok := ParseRegistryEntry([]byte(tt.data))
			if ok {
				t.Error("expected ParseRegistryEntry to fail")
			}
		})
	}
}

func TestNormKey(t *testing.T) {
	tests := []struct {
		input string
		want  string
	}{
		{`D:\Work\Demo`, "d:/work/demo"},
		{`C:\Users\u\`, "c:/users/u"},
		{"/home//user///code/", "/home/user/code"},
		{"UPPER", "upper"},
	}
	for _, tt := range tests {
		t.Run(tt.input, func(t *testing.T) {
			got := normKey(tt.input)
			if got != tt.want {
				t.Errorf("normKey(%q) = %q, want %q", tt.input, got, tt.want)
			}
		})
	}
}
