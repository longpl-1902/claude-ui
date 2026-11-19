package control

import (
	"errors"
	"os/exec"
	"path/filepath"
	"strings"
)

func ResolveClaude(override string, env []string, home string, exists func(string) bool) (string, error) {
	if override != "" {
		if isCmdShim(override) {
			return "", errors.New("claudePath must point to claude.exe, not a .cmd shim")
		}
		if exists(override) {
			return override, nil
		}
		return "", errors.New("claudePath set but file does not exist: " + override)
	}

	pathEnv := lookupEnv(env, "PATH")
	if p := findOnPath("claude.exe", pathEnv); p != "" {
		return p, nil
	}

	if cmdPath := findOnPath("claude.cmd", pathEnv); cmdPath != "" {
		dir := filepath.Dir(cmdPath)
		sibling := filepath.Join(dir, "node_modules", "@anthropic-ai", "claude-code", "bin", "claude.exe")
		if exists(sibling) {
			return sibling, nil
		}
	}

	fallback := filepath.Join(home, ".local", "bin", "claude.exe")
	if exists(fallback) {
		return fallback, nil
	}

	return "", errors.New("claude.exe not found; set claudePath in ac config")
}

func isCmdShim(p string) bool {
	return strings.EqualFold(filepath.Ext(p), ".cmd") || strings.EqualFold(filepath.Ext(p), ".bat")
}

func lookupEnv(env []string, key string) string {
	for i := len(env) - 1; i >= 0; i-- {
		name, val, ok := strings.Cut(env[i], "=")
		if ok && strings.EqualFold(name, key) {
			return val
		}
	}
	return ""
}

func findOnPath(name, pathStr string) string {
	for _, dir := range filepath.SplitList(pathStr) {
		p := filepath.Join(dir, name)
		if _, err := exec.LookPath(p); err == nil {
			return p
		}
	}
	return ""
}
