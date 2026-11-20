package accounts

import (
	"encoding/json"
	"fmt"
	"os"
	"path/filepath"
	"runtime"
	"strings"

	"github.com/longpl-1902/claude-ui/internal/pathx"
	"github.com/longpl-1902/claude-ui/internal/safefs"
)

type Display struct {
	SignedIn   bool
	Email      string
	Org        string
	Unreadable bool
}

func ParseDisplayFields(data []byte) Display {
	var raw struct {
		OAuthAccount *struct {
			EmailAddress     string `json:"emailAddress"`
			OrganizationName string `json:"organizationName"`
		} `json:"oauthAccount"`
	}
	if err := json.Unmarshal(data, &raw); err != nil {
		return Display{Unreadable: true}
	}
	if raw.OAuthAccount == nil {
		return Display{}
	}
	return Display{
		SignedIn: true,
		Email:    raw.OAuthAccount.EmailAddress,
		Org:      raw.OAuthAccount.OrganizationName,
	}
}

func ReadDisplay(configDir, home string) Display {
	claudeJSON := claudeJSONPath(configDir, home)
	data, err := safefs.ReadFile(claudeJSON)
	if err != nil {
		fallback := filepath.Join(configDir, ".config.json")
		data, err = safefs.ReadFile(fallback)
		if err != nil {
			return Display{Unreadable: true}
		}
	}
	return ParseDisplayFields(data)
}

func claudeJSONPath(configDir, home string) string {
	defaultDir := filepath.Join(home, ".claude")
	if pathx.Same(configDir, defaultDir) {
		return filepath.Join(home, ".claude.json")
	}
	return filepath.Join(configDir, ".claude.json")
}

type Detected struct {
	Dir     string
	Source  string
	Warning string
}

var configMarkers = []string{
	"settings.json", "projects", "history.jsonl", "sessions",
	"todos", "statsig", "shell-snapshots", "file-history", "plugins", "ide",
}

func Detect(home string, env []string, appDataDir string) []Detected {
	var results []Detected
	seen := map[string]bool{}
	add := func(dir, source, warning string) {
		norm := pathx.NormalizeForCompare(dir)
		if seen[norm] {
			return
		}
		seen[norm] = true
		results = append(results, Detected{Dir: dir, Source: source, Warning: warning})
	}

	defaultDir := filepath.Join(home, ".claude")
	if isConfigDir(defaultDir) {
		add(defaultDir, "default", "")
	}

	entries, _ := os.ReadDir(home)
	for _, e := range entries {
		if !e.IsDir() {
			continue
		}
		name := e.Name()
		if strings.HasPrefix(name, ".claude-") {
			dir := filepath.Join(home, name)
			if isConfigDir(dir) {
				add(dir, "pattern", "")
			}
		}
	}

	for _, kv := range env {
		k, v, ok := strings.Cut(kv, "=")
		if ok && strings.EqualFold(k, "CLAUDE_CONFIG_DIR") && v != "" {
			expanded := pathx.ExpandHome(v, home)
			warning := ""
			if !pathx.IsAbs(expanded) {
				warning = "CLAUDE_CONFIG_DIR is not absolute"
			}
			add(expanded, "env", warning)
		}
	}

	vscodeDirs := detectFromVSCode(home, appDataDir)
	for _, d := range vscodeDirs {
		add(d, "vscode", "")
	}

	return results
}

func isConfigDir(dir string) bool {
	claudeJSON := filepath.Join(dir, ".claude.json")
	if _, err := os.Stat(claudeJSON); err == nil {
		return true
	}

	count := 0
	for _, marker := range configMarkers {
		p := filepath.Join(dir, marker)
		if _, err := os.Stat(p); err == nil {
			count++
			if count >= 2 {
				return true
			}
		}
	}
	return false
}

func detectFromVSCode(home, appDataDir string) []string {
	var settingsPaths []string
	if runtime.GOOS == "windows" && appDataDir != "" {
		settingsPaths = append(settingsPaths,
			filepath.Join(appDataDir, "Code", "User", "settings.json"),
			filepath.Join(appDataDir, "Code - Insiders", "User", "settings.json"),
		)
	} else {
		settingsPaths = append(settingsPaths,
			filepath.Join(home, ".config", "Code", "User", "settings.json"),
			filepath.Join(home, ".config", "Code - Insiders", "User", "settings.json"),
		)
	}

	var dirs []string
	for _, sp := range settingsPaths {
		data, err := os.ReadFile(sp)
		if err != nil {
			continue
		}
		var settings map[string]json.RawMessage
		if UnmarshalJSONC(data, &settings) != nil {
			continue
		}
		envRaw, ok := settings["claudeCode.environmentVariables"]
		if !ok {
			continue
		}
		var envVars map[string]string
		if json.Unmarshal(envRaw, &envVars) != nil {
			continue
		}
		if dir, ok := envVars["CLAUDE_CONFIG_DIR"]; ok && dir != "" {
			dirs = append(dirs, pathx.ExpandHome(dir, home))
		}
	}
	return dirs
}

// --- Config / State types ---

type Config struct {
	Accounts []Profile `json:"accounts"`
	Rules    []Rule    `json:"rules"`
	Prefs    Prefs     `json:"prefs"`
}

type Profile struct {
	ID        string `json:"id"`
	Name      string `json:"name"`
	Color     string `json:"color"`
	ConfigDir string `json:"configDir"`
	Kind      string `json:"kind"`
}

type Rule struct {
	Pattern string `json:"pattern"`
	Account string `json:"account"`
}

type Prefs struct {
	ClaudePath            string `json:"claudePath,omitempty"`
	Editor                string `json:"editor,omitempty"`
	ListDays              int    `json:"listDays,omitempty"`
	Mouse                 bool   `json:"mouse,omitempty"`
	Toast                 bool   `json:"toast,omitempty"`
	WarnPersonalInCompany bool   `json:"warnPersonalInCompany,omitempty"`
	LockAccountPerFolder  bool   `json:"lockAccountPerFolder,omitempty"`
	AlwaysUseAccount      string `json:"alwaysUseAccount,omitempty"`
}

type State struct {
	LastAccount   string `json:"lastAccount"`
	LastAccountAt int64  `json:"lastAccountAt"`
	// AlwaysUse is the account remembered as "always use" (set from the picker).
	AlwaysUse string `json:"alwaysUse,omitempty"`
}

func MatchFolder(rules []Rule, folder, home string) (string, bool) {
	normFolder := pathx.NormalizeForCompare(folder)
	for _, r := range rules {
		pattern := pathx.ExpandHome(r.Pattern, home)
		pattern = pathx.NormalizeForCompare(pattern)

		if strings.Contains(pattern, "**") {
			prefix := strings.SplitN(pattern, "**", 2)[0]
			if strings.HasPrefix(normFolder, prefix) {
				return r.Account, true
			}
			continue
		}

		matched, _ := filepath.Match(pattern, normFolder)
		if matched || pathx.Same(pattern, folder) {
			return r.Account, true
		}
	}
	return "", false
}

func ChooseStartup(flagAccount string, cfg Config, state State, detected []Detected) (string, bool, error) {
	allAccounts := mergeAccounts(cfg, detected)

	if flagAccount != "" {
		for _, a := range allAccounts {
			if strings.EqualFold(a.ID, flagAccount) || strings.EqualFold(a.Name, flagAccount) ||
				pathx.Same(a.ConfigDir, flagAccount) {
				return a.ID, false, nil
			}
		}
		return "", true, fmt.Errorf("account %q not found", flagAccount)
	}

	if cfg.Prefs.AlwaysUseAccount != "" {
		for _, a := range allAccounts {
			if a.ID == cfg.Prefs.AlwaysUseAccount {
				return a.ID, false, nil
			}
		}
	}

	if state.AlwaysUse != "" {
		for _, a := range allAccounts {
			if a.ID == state.AlwaysUse {
				return a.ID, false, nil
			}
		}
	}

	if len(allAccounts) == 1 {
		return allAccounts[0].ID, false, nil
	}

	// Picker, preselecting the last used account.
	return state.LastAccount, true, nil
}

type mergedAccount struct {
	ID        string
	Name      string
	ConfigDir string
}

func mergeAccounts(cfg Config, detected []Detected) []mergedAccount {
	var result []mergedAccount
	seen := map[string]bool{}

	for _, p := range cfg.Accounts {
		norm := pathx.NormalizeForCompare(p.ConfigDir)
		if !seen[norm] {
			seen[norm] = true
			id := p.ID
			if id == "" {
				id = p.Name
			}
			result = append(result, mergedAccount{ID: id, Name: p.Name, ConfigDir: p.ConfigDir})
		}
	}

	for _, d := range detected {
		norm := pathx.NormalizeForCompare(d.Dir)
		if !seen[norm] {
			seen[norm] = true
			name := filepath.Base(d.Dir)
			result = append(result, mergedAccount{ID: name, Name: name, ConfigDir: d.Dir})
		}
	}
	return result
}

var DefaultAccentColors = []string{
	"#5B8DEF", // blue
	"#F5A623", // orange
	"#7ED321", // green
	"#D0021B", // red
	"#BD10E0", // purple
	"#4A90D9", // teal
}

func AssignColor(index int) string {
	return DefaultAccentColors[index%len(DefaultAccentColors)]
}
