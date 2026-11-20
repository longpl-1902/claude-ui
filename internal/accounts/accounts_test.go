package accounts

import (
	"os"
	"path/filepath"
	"runtime"
	"testing"
)

func TestParseDisplayFields(t *testing.T) {
	tests := []struct {
		name string
		data string
		want Display
	}{
		{
			name: "signed in",
			data: `{"oauthAccount":{"emailAddress":"u@example.com","organizationName":"Acme Ltd"}}`,
			want: Display{SignedIn: true, Email: "u@example.com", Org: "Acme Ltd"},
		},
		{
			name: "not signed in",
			data: `{}`,
			want: Display{},
		},
		{
			name: "invalid json",
			data: `{broken`,
			want: Display{Unreadable: true},
		},
		{
			name: "oauth without email",
			data: `{"oauthAccount":{}}`,
			want: Display{SignedIn: true},
		},
	}
	for _, tt := range tests {
		t.Run(tt.name, func(t *testing.T) {
			got := ParseDisplayFields([]byte(tt.data))
			if got != tt.want {
				t.Errorf("got %+v, want %+v", got, tt.want)
			}
		})
	}
}

func TestDetect(t *testing.T) {
	home := t.TempDir()

	defaultDir := filepath.Join(home, ".claude")
	os.MkdirAll(defaultDir, 0755)
	os.WriteFile(filepath.Join(defaultDir, ".claude.json"), []byte(`{}`), 0644)

	extraDir := filepath.Join(home, ".claude-work")
	os.MkdirAll(extraDir, 0755)
	os.MkdirAll(filepath.Join(extraDir, "projects"), 0755)
	os.MkdirAll(filepath.Join(extraDir, "sessions"), 0755)

	env := []string{"CLAUDE_CONFIG_DIR=" + filepath.Join(home, ".claude-env")}
	os.MkdirAll(filepath.Join(home, ".claude-env"), 0755)

	detected := Detect(home, env, "")
	if len(detected) < 2 {
		t.Fatalf("expected at least 2 detected dirs, got %d: %+v", len(detected), detected)
	}

	sources := map[string]bool{}
	for _, d := range detected {
		sources[d.Source] = true
	}
	if !sources["default"] {
		t.Error("missing default dir")
	}
	if !sources["pattern"] {
		t.Error("missing pattern dir")
	}
}

func TestDetectVSCode(t *testing.T) {
	home := t.TempDir()

	// Detect looks under appDataDir on Windows and ~/.config elsewhere.
	appData := ""
	vsDir := filepath.Join(home, ".config", "Code", "User")
	if runtime.GOOS == "windows" {
		appData = filepath.Join(home, "AppData", "Roaming")
		vsDir = filepath.Join(appData, "Code", "User")
	}
	os.MkdirAll(vsDir, 0755)
	os.WriteFile(filepath.Join(vsDir, "settings.json"), []byte(`{
		// VS Code settings
		"claudeCode.environmentVariables": {
			"CLAUDE_CONFIG_DIR": "`+filepath.ToSlash(filepath.Join(home, ".claude-vs"))+`"
		},
	}`), 0644)

	os.MkdirAll(filepath.Join(home, ".claude-vs"), 0755)

	detected := Detect(home, nil, appData)
	found := false
	for _, d := range detected {
		if d.Source == "vscode" {
			found = true
		}
	}
	if !found {
		t.Error("VS Code config dir not detected")
	}
}

func TestChooseStartup(t *testing.T) {
	tests := []struct {
		name       string
		flag       string
		cfg        Config
		state      State
		detected   []Detected
		wantID     string
		wantPicker bool
		wantErr    bool
	}{
		{
			name:   "flag account",
			flag:   "work",
			cfg:    Config{Accounts: []Profile{{ID: "work", Name: "work", ConfigDir: "/c/work"}}},
			wantID: "work",
		},
		{
			name:       "flag unknown",
			flag:       "unknown",
			cfg:        Config{},
			wantErr:    true,
			wantPicker: true,
		},
		{
			name: "always use",
			cfg: Config{
				Accounts: []Profile{{ID: "work", Name: "work", ConfigDir: "/c/work"}},
				Prefs:    Prefs{AlwaysUseAccount: "work"},
			},
			wantID: "work",
		},
		{
			name:     "single account",
			detected: []Detected{{Dir: "/home/u/.claude", Source: "default"}},
			wantID:   ".claude",
		},
		{
			name: "flag beats prefs and state",
			flag: "personal",
			cfg: Config{
				Accounts: []Profile{
					{ID: "work", Name: "work", ConfigDir: "/c/work"},
					{ID: "personal", Name: "personal", ConfigDir: "/c/personal"},
				},
				Prefs: Prefs{AlwaysUseAccount: "work"},
			},
			state:  State{AlwaysUse: "work", LastAccount: "work"},
			wantID: "personal",
		},
		{
			name: "prefs beats state always use",
			cfg: Config{
				Accounts: []Profile{
					{ID: "work", Name: "work", ConfigDir: "/c/work"},
					{ID: "personal", Name: "personal", ConfigDir: "/c/personal"},
				},
				Prefs: Prefs{AlwaysUseAccount: "personal"},
			},
			state:  State{AlwaysUse: "work"},
			wantID: "personal",
		},
		{
			name: "state always use",
			cfg: Config{Accounts: []Profile{
				{ID: "work", Name: "work", ConfigDir: "/c/work"},
				{ID: "personal", Name: "personal", ConfigDir: "/c/personal"},
			}},
			state:  State{AlwaysUse: "personal", LastAccount: "work"},
			wantID: "personal",
		},
		{
			name: "state always use no longer exists",
			cfg: Config{Accounts: []Profile{
				{ID: "work", Name: "work", ConfigDir: "/c/work"},
				{ID: "personal", Name: "personal", ConfigDir: "/c/personal"},
			}},
			state:      State{AlwaysUse: "gone", LastAccount: "personal"},
			wantID:     "personal",
			wantPicker: true,
		},
		{
			name:   "single account ignores stale state",
			cfg:    Config{Accounts: []Profile{{ID: "work", Name: "work", ConfigDir: "/c/work"}}},
			state:  State{AlwaysUse: "gone", LastAccount: "gone"},
			wantID: "work",
		},
		{
			name: "multiple, show picker",
			cfg: Config{Accounts: []Profile{
				{ID: "work", Name: "work", ConfigDir: "/c/work"},
				{ID: "personal", Name: "personal", ConfigDir: "/c/personal"},
			}},
			state:      State{LastAccount: "work"},
			wantID:     "work",
			wantPicker: true,
		},
	}
	for _, tt := range tests {
		t.Run(tt.name, func(t *testing.T) {
			id, picker, err := ChooseStartup(tt.flag, tt.cfg, tt.state, tt.detected)
			if tt.wantErr {
				if err == nil {
					t.Error("expected error")
				}
				return
			}
			if err != nil {
				t.Fatal(err)
			}
			if id != tt.wantID {
				t.Errorf("id = %q, want %q", id, tt.wantID)
			}
			if picker != tt.wantPicker {
				t.Errorf("picker = %v, want %v", picker, tt.wantPicker)
			}
		})
	}
}

func TestMatchFolder(t *testing.T) {
	tests := []struct {
		name   string
		rules  []Rule
		folder string
		wantID string
		wantOK bool
	}{
		{
			name:   "glob match",
			rules:  []Rule{{Pattern: "/work/acme/**", Account: "work"}},
			folder: "/work/acme/api",
			wantID: "work",
			wantOK: true,
		},
		{
			name:   "exact match",
			rules:  []Rule{{Pattern: "/work/acme", Account: "work"}},
			folder: "/work/acme",
			wantID: "work",
			wantOK: true,
		},
		{
			name:   "no match",
			rules:  []Rule{{Pattern: "/work/acme/**", Account: "work"}},
			folder: "/personal/stuff",
			wantOK: false,
		},
	}
	for _, tt := range tests {
		t.Run(tt.name, func(t *testing.T) {
			id, ok := MatchFolder(tt.rules, tt.folder, "/home/u")
			if ok != tt.wantOK {
				t.Errorf("ok = %v, want %v", ok, tt.wantOK)
			}
			if id != tt.wantID {
				t.Errorf("id = %q, want %q", id, tt.wantID)
			}
		})
	}
}

func TestReadDisplay(t *testing.T) {
	home := t.TempDir()
	configDir := filepath.Join(home, ".claude")
	os.MkdirAll(configDir, 0755)

	// Default dir reads ~/.claude.json (not ~/.claude/.claude.json)
	os.WriteFile(filepath.Join(home, ".claude.json"),
		[]byte(`{"oauthAccount":{"emailAddress":"u@example.com","organizationName":"Acme"}}`), 0644)

	d := ReadDisplay(configDir, home)
	if !d.SignedIn {
		t.Error("expected signed in")
	}
	if d.Email != "u@example.com" {
		t.Errorf("email = %q", d.Email)
	}
}

func TestReadDisplayOtherDir(t *testing.T) {
	home := t.TempDir()
	configDir := filepath.Join(home, ".claude-work")
	os.MkdirAll(configDir, 0755)

	os.WriteFile(filepath.Join(configDir, ".claude.json"),
		[]byte(`{"oauthAccount":{"emailAddress":"dev@acme.example"}}`), 0644)

	d := ReadDisplay(configDir, home)
	if !d.SignedIn {
		t.Error("expected signed in")
	}
	if d.Email != "dev@acme.example" {
		t.Errorf("email = %q", d.Email)
	}
}
