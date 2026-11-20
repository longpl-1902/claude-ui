package control

import (
	"errors"
	"path/filepath"
	"strings"
)

var stripVars = map[string]bool{
	"claudecode":                                true,
	"claude_code_session_id":                    true,
	"claude_code_child_session":                 true,
	"claude_code_entrypoint":                    true,
	"claude_code_execpath":                      true,
	"claude_code_messaging_socket":              true,
	"claude_code_messaging_token":               true,
	"claude_code_session_attended":              true,
	"claude_pid":                                true,
	"claude_agent_sdk_version":                  true,
	"claude_code_emit_startup_timing":           true,
	"claude_code_startup_failure_results":       true,
	"claude_code_enable_sdk_file_checkpointing": true,
	"claude_code_question_preview_format":       true,
	"claude_code_enable_tasks":                  true,
	"mcp_connection_nonblocking":                true,
	"electron_run_as_node":                      true,
	"claude_config_dir":                         true,
}

func ChildEnv(base []string, configDirAbs string) ([]string, error) {
	if !filepath.IsAbs(configDirAbs) {
		return nil, errors.New("CLAUDE_CONFIG_DIR must be absolute")
	}

	var out []string
	hasTerm := false
	hasColorTerm := false

	for _, e := range base {
		name, _, _ := strings.Cut(e, "=")
		if stripVars[strings.ToLower(name)] {
			continue
		}
		if strings.EqualFold(name, "TERM") {
			hasTerm = true
		}
		if strings.EqualFold(name, "COLORTERM") {
			hasColorTerm = true
		}
		out = append(out, e)
	}

	out = append(out, "CLAUDE_CONFIG_DIR="+configDirAbs)
	out = append(out, "CLAUDE_CODE_ENABLE_SDK_FILE_CHECKPOINTING=1")

	if !hasTerm {
		out = append(out, "TERM=xterm-256color")
	}
	if !hasColorTerm {
		out = append(out, "COLORTERM=truecolor")
	}

	return out, nil
}
