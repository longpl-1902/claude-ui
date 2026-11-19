package main

import (
	"flag"
	"fmt"
	"io"
	"log"
	"os"
	"path/filepath"

	"github.com/longpl-1902/claude-ui/internal/accounts"
	"github.com/longpl-1902/claude-ui/internal/app"
	"github.com/longpl-1902/claude-ui/internal/core"
	"github.com/longpl-1902/claude-ui/internal/statefile"
	"github.com/longpl-1902/claude-ui/internal/ui"

	tea "charm.land/bubbletea/v2"
)

var version = "dev"

func main() {
	showVersion := flag.Bool("version", false, "Print version and exit")
	acctFlag := flag.String("account", "", "Start with this account")
	debugLog := flag.String("debug-log", "", "Write debug log to file")
	flag.Parse()

	if *showVersion {
		fmt.Println("ac " + version)
		os.Exit(0)
	}

	if *debugLog != "" {
		f, err := os.OpenFile(*debugLog, os.O_CREATE|os.O_WRONLY|os.O_TRUNC, 0644)
		if err != nil {
			fmt.Fprintf(os.Stderr, "Cannot open debug log: %v\n", err)
			os.Exit(1)
		}
		defer f.Close()
		log.SetOutput(f)
	} else {
		log.SetOutput(io.Discard)
	}

	home, _ := os.UserHomeDir()
	dirs := statefile.GetDirs()

	cfg, err := loadConfig(dirs.Config)
	if err != nil {
		log.Printf("config load: %v", err)
	}

	state, err := loadState(dirs.Config)
	if err != nil {
		log.Printf("state load: %v", err)
	}

	detected := accounts.Detect(home, os.Environ(), os.Getenv("APPDATA"))

	allAccounts := buildAccounts(cfg, detected, home)
	if len(allAccounts) == 0 {
		fmt.Fprintln(os.Stderr, "No Claude accounts detected. Ensure Claude is installed and signed in.")
		os.Exit(1)
	}

	startID, showPicker, startErr := accounts.ChooseStartup(*acctFlag, cfg, state, detected)
	if startErr != nil {
		fmt.Fprintf(os.Stderr, "Error: %v\n", startErr)
		os.Exit(1)
	}

	var active core.Account
	if showPicker || startID == "" {
		active = allAccounts[0]
	} else {
		for _, a := range allAccounts {
			if string(a.ID) == startID {
				active = a
				break
			}
		}
		if active.ID == "" {
			active = allAccounts[0]
		}
	}

	store := app.New(active, allAccounts, cfg)
	model := ui.NewModel(store)

	p := tea.NewProgram(model)

	store.SetNotify(func() {
		p.Send(core.ChangedMsg{})
	})

	if _, err := p.Run(); err != nil {
		fmt.Fprintf(os.Stderr, "Error: %v\n", err)
		os.Exit(1)
	}

	state.LastAccount = string(active.ID)
	_ = statefile.WriteJSONAtomic(filepath.Join(dirs.Config, "state.json"), state)
}

func loadConfig(configDir string) (accounts.Config, error) {
	path := filepath.Join(configDir, "config.json")
	data, err := os.ReadFile(path)
	if err != nil {
		return accounts.Config{}, err
	}
	var cfg accounts.Config
	if err := accounts.UnmarshalJSONC(data, &cfg); err != nil {
		return accounts.Config{}, err
	}
	return cfg, nil
}

func loadState(configDir string) (accounts.State, error) {
	path := filepath.Join(configDir, "state.json")
	data, err := os.ReadFile(path)
	if err != nil {
		return accounts.State{}, err
	}
	var state accounts.State
	if err := accounts.UnmarshalJSONC(data, &state); err != nil {
		return accounts.State{}, err
	}
	return state, nil
}

func buildAccounts(cfg accounts.Config, detected []accounts.Detected, home string) []core.Account {
	var result []core.Account
	seen := make(map[string]bool)

	for i, p := range cfg.Accounts {
		if seen[p.ConfigDir] {
			continue
		}
		seen[p.ConfigDir] = true
		color := p.Color
		if color == "" {
			color = accounts.AssignColor(i)
		}
		display := accounts.ReadDisplay(p.ConfigDir, home)
		id := p.ID
		if id == "" {
			id = p.Name
		}
		result = append(result, core.Account{
			ID:        core.AccountID(id),
			Name:      p.Name,
			Color:     color,
			ConfigDir: p.ConfigDir,
			Kind:      p.Kind,
			Email:     display.Email,
			Org:       display.Org,
			SignedIn:  display.SignedIn,
		})
	}

	for _, d := range detected {
		if seen[d.Dir] {
			continue
		}
		seen[d.Dir] = true
		name := filepath.Base(d.Dir)
		display := accounts.ReadDisplay(d.Dir, home)
		result = append(result, core.Account{
			ID:        core.AccountID(name),
			Name:      name,
			Color:     accounts.AssignColor(len(result)),
			ConfigDir: d.Dir,
			Email:     display.Email,
			Org:       display.Org,
			SignedIn:  display.SignedIn,
		})
	}

	return result
}
