package transcript

import (
	"encoding/json"
	"strings"
)

func EncodeProjectDir(cwd string) string {
	var b strings.Builder
	for _, r := range cwd {
		if (r >= 'A' && r <= 'Z') || (r >= 'a' && r <= 'z') || (r >= '0' && r <= '9') {
			b.WriteRune(r)
		} else {
			b.WriteByte('-')
		}
	}
	s := b.String()
	if len(s) > 200 {
		s = s[:200] + "-"
	}
	return s
}

func SameProjectDir(a, b string) bool {
	return strings.EqualFold(a, b)
}

type PathKind int

const (
	PathMain PathKind = iota
	PathSubAgent
	PathMeta
	PathUnknown
)

type PathInfo struct {
	Kind       PathKind
	SessionID  string
	AgentID    string
	ProjectDir string
}

func Classify(abs, projectsRoot string) PathInfo {
	absN := normKey(abs)
	rootN := normKey(projectsRoot)

	if !strings.HasPrefix(absN, rootN) {
		return PathInfo{Kind: PathUnknown}
	}
	rel := absN[len(rootN):]
	rel = strings.TrimPrefix(rel, "/")

	parts := strings.Split(rel, "/")
	if len(parts) < 2 {
		return PathInfo{Kind: PathUnknown}
	}

	projectDir := parts[0]

	// Main transcript: projects/<projdir>/<session>.jsonl
	if len(parts) == 2 && strings.HasSuffix(parts[1], ".jsonl") {
		sessionID := strings.TrimSuffix(parts[1], ".jsonl")
		return PathInfo{
			Kind:       PathMain,
			SessionID:  sessionID,
			ProjectDir: projectDir,
		}
	}

	// Subagent: projects/<projdir>/<session>/subagents/agent-<id>.jsonl
	if len(parts) >= 4 && parts[2] == "subagents" && strings.HasSuffix(parts[3], ".jsonl") {
		sessionID := parts[1]
		agentFile := strings.TrimSuffix(parts[3], ".jsonl")
		agentID := strings.TrimPrefix(agentFile, "agent-")
		return PathInfo{
			Kind:       PathSubAgent,
			SessionID:  sessionID,
			AgentID:    agentID,
			ProjectDir: projectDir,
		}
	}

	// Meta: projects/<projdir>/<session>/subagents/agent-<id>.meta.json
	if len(parts) >= 4 && parts[2] == "subagents" && strings.HasSuffix(parts[3], ".meta.json") {
		sessionID := parts[1]
		agentFile := strings.TrimSuffix(parts[3], ".meta.json")
		agentID := strings.TrimPrefix(agentFile, "agent-")
		return PathInfo{
			Kind:       PathMeta,
			SessionID:  sessionID,
			AgentID:    agentID,
			ProjectDir: projectDir,
		}
	}

	return PathInfo{Kind: PathUnknown}
}

type RegistryEntry struct {
	PID        int    `json:"pid"`
	SessionID  string `json:"sessionId"`
	Cwd        string `json:"cwd"`
	Status     string `json:"status"`
	WaitingFor string `json:"waitingFor,omitempty"`
	UpdatedAt  string `json:"updatedAt"`
	Name       string `json:"name,omitempty"`
	Entrypoint string `json:"entrypoint,omitempty"`
}

func ParseRegistryEntry(data []byte) (RegistryEntry, bool) {
	var e RegistryEntry
	if err := json.Unmarshal(data, &e); err != nil {
		return RegistryEntry{}, false
	}
	if e.PID == 0 || e.SessionID == "" {
		return RegistryEntry{}, false
	}
	return e, true
}

type SubagentMeta struct {
	ToolUseID string `json:"toolUseId"`
	AgentName string `json:"agentName"`
	AgentType string `json:"agentType"`
}

func ParseSubagentMeta(data []byte) (SubagentMeta, bool) {
	var m SubagentMeta
	if err := json.Unmarshal(data, &m); err != nil {
		return SubagentMeta{}, false
	}
	return m, true
}

func normKey(p string) string {
	p = strings.ToLower(p)
	p = strings.ReplaceAll(p, "\\", "/")
	for strings.Contains(p, "//") {
		p = strings.ReplaceAll(p, "//", "/")
	}
	p = strings.TrimRight(p, "/")
	return p
}
