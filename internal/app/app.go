package app

import (
	"fmt"
	"os"
	"path/filepath"
	"sort"
	"strings"
	"sync"
	"time"

	"github.com/longpl-1902/claude-ui/internal/accounts"
	"github.com/longpl-1902/claude-ui/internal/control"
	"github.com/longpl-1902/claude-ui/internal/core"
	"github.com/longpl-1902/claude-ui/internal/gitx"
	"github.com/longpl-1902/claude-ui/internal/safefs"
	"github.com/longpl-1902/claude-ui/internal/statefile"
	"github.com/longpl-1902/claude-ui/internal/transcript"

	tea "charm.land/bubbletea/v2"
)

type Store struct {
	mu       sync.Mutex
	account  core.Account
	accounts []core.Account
	cfg      accounts.Config
	dirs     statefile.AppDirs

	sessions map[string]*sessionState // sessionID -> state
	projects map[string]*gitx.Project // projectKey -> project
	resolver *gitx.Resolver
	notify   func()

	controlSessions map[string]*controlledSession
	claudePath      string
}

type sessionState struct {
	summary  core.SessionSummary
	view     *core.SessionView
	records  []transcript.Record
	tailer   *transcript.Tailer
	filePath string
	lastRead time.Time
}

type controlledSession struct {
	key    core.SessionKey
	state  control.State
	events chan control.Event
}

func New(acct core.Account, allAccounts []core.Account, cfg accounts.Config) *Store {
	dirs := statefile.GetDirs()
	claudePath := cfg.Prefs.ClaudePath
	if claudePath == "" {
		p, err := control.ResolveClaude("", os.Environ(), os.Getenv("HOME"), fileExists)
		if err == nil {
			claudePath = p
		}
	}

	return &Store{
		account:         acct,
		accounts:        allAccounts,
		cfg:             cfg,
		dirs:            dirs,
		sessions:        make(map[string]*sessionState),
		projects:        make(map[string]*gitx.Project),
		resolver:        gitx.NewResolver(),
		controlSessions: make(map[string]*controlledSession),
		claudePath:      claudePath,
	}
}

func fileExists(path string) bool {
	_, err := os.Stat(path)
	return err == nil
}

func (s *Store) Account() core.Account {
	s.mu.Lock()
	defer s.mu.Unlock()
	return s.account
}

func (s *Store) Accounts() []core.Account {
	s.mu.Lock()
	defer s.mu.Unlock()
	return append([]core.Account{}, s.accounts...)
}

func (s *Store) Sessions(all bool) []core.SessionSummary {
	s.mu.Lock()
	defer s.mu.Unlock()

	s.scanSessions()

	var result []core.SessionSummary
	for _, ss := range s.sessions {
		if !all && ss.summary.Key.Account != s.account.ID {
			continue
		}
		result = append(result, ss.summary)
	}

	sort.Slice(result, func(i, j int) bool {
		return result[i].LastActivity.After(result[j].LastActivity)
	})

	return result
}

func (s *Store) View(key core.SessionKey, agentID string) (core.SessionView, bool) {
	s.mu.Lock()
	defer s.mu.Unlock()

	ss, ok := s.sessions[key.SessionID]
	if !ok {
		return core.SessionView{}, false
	}

	if ss.view != nil {
		return *ss.view, true
	}

	// Build a basic view from the transcript
	view := core.SessionView{
		Summary: ss.summary,
	}

	for _, rec := range ss.records {
		items := recordToItems(rec)
		view.Items = append(view.Items, items...)
	}

	// Check for pending cards from controlled session
	if cs, ok := s.controlSessions[key.SessionID]; ok {
		_ = cs // TODO: merge controlled session cards
	}

	ss.view = &view
	return view, true
}

func recordToItems(rec transcript.Record) []core.Item {
	var items []core.Item
	switch rec.T {
	case transcript.RecPrompt:
		if rec.PromptText != "" {
			items = append(items, core.Item{
				ID:   rec.UUID,
				Kind: core.ItemPrompt,
				Time: rec.Timestamp,
				Text: rec.PromptText,
			})
		}
	case transcript.RecAssistant:
		if rec.Text != "" {
			items = append(items, core.Item{
				ID:   rec.UUID,
				Kind: core.ItemText,
				Time: rec.Timestamp,
				Text: rec.Text,
			})
		}
		for _, tu := range rec.Tools {
			items = append(items, core.Item{
				ID:   tu.UseID,
				Kind: core.ItemTool,
				Time: rec.Timestamp,
				Tool: &core.ToolItem{
					UseID:  tu.UseID,
					Name:   tu.Name,
					Target: tu.Target,
					Input:  tu.InputPreview,
					Open:   true,
				},
			})
		}
	case transcript.RecToolResults:
		for _, tr := range rec.Results {
			items = append(items, core.Item{
				ID:   tr.UseID,
				Kind: core.ItemTool,
				Time: rec.Timestamp,
				Tool: &core.ToolItem{
					UseID:   tr.UseID,
					Result:  tr.Text,
					Failed:  tr.IsError,
					Open:    false,
					Added:   tr.Added,
					Removed: tr.Removed,
				},
			})
		}
	case transcript.RecInterrupted:
		items = append(items, core.Item{
			ID:   rec.UUID,
			Kind: core.ItemInterrupted,
			Time: rec.Timestamp,
			Text: "Request interrupted",
		})
	case transcript.RecSystem:
		if rec.ErrorText != "" {
			items = append(items, core.Item{
				ID:   rec.UUID,
				Kind: core.ItemNotice,
				Time: rec.Timestamp,
				Text: rec.ErrorText,
			})
		}
	}
	return items
}

func (s *Store) Attention() (mine, others int, items []core.Attention) {
	s.mu.Lock()
	defer s.mu.Unlock()

	for _, ss := range s.sessions {
		if ss.summary.Blocked {
			att := core.Attention{
				Key:      ss.summary.Key,
				Kind:     "blocked",
				Detail:   ss.summary.Reason,
				Severity: core.SeverityBlocked,
			}
			items = append(items, att)
			if ss.summary.Key.Account == s.account.ID {
				mine++
			} else {
				others++
			}
		}
	}
	return
}

func (s *Store) UsageToday() int64 {
	s.mu.Lock()
	defer s.mu.Unlock()

	var total int64
	today := time.Now().Format("2006-01-02")
	for _, ss := range s.sessions {
		if ss.summary.Key.Account != s.account.ID {
			continue
		}
		for _, rec := range ss.records {
			if rec.T == transcript.RecAssistant && rec.Usage != nil {
				if rec.Timestamp.Format("2006-01-02") == today {
					total += rec.Usage.Input + rec.Usage.Output + rec.Usage.CacheCreation
				}
			}
		}
	}
	return total
}

func (s *Store) Do(a core.Action) tea.Cmd {
	return func() tea.Msg {
		switch a.Kind {
		case core.ActionSend:
			return s.doSend(a)
		case core.ActionAnswer:
			return s.doAnswer(a)
		case core.ActionInterrupt:
			return s.doInterrupt(a)
		case core.ActionStop:
			return s.doStop(a)
		case core.ActionNewDraft:
			return s.doNewDraft(a)
		case core.ActionFork:
			return s.doFork(a)
		case core.ActionRefresh:
			s.mu.Lock()
			s.scanSessions()
			s.mu.Unlock()
			return core.ChangedMsg{}
		default:
			return core.ChangedMsg{}
		}
	}
}

func (s *Store) doSend(a core.Action) tea.Msg {
	// TODO: implement controlled session send
	return core.ChangedMsg{}
}

func (s *Store) doAnswer(a core.Action) tea.Msg {
	// TODO: implement answer via control protocol
	return core.ChangedMsg{}
}

func (s *Store) doInterrupt(a core.Action) tea.Msg {
	// TODO: send interrupt to controlled session
	return core.ChangedMsg{}
}

func (s *Store) doStop(a core.Action) tea.Msg {
	// TODO: stop controlled session
	return core.ChangedMsg{}
}

func (s *Store) doNewDraft(a core.Action) tea.Msg {
	dir := a.Dir
	if dir == "" {
		dir, _ = os.Getwd()
	}
	draftID := fmt.Sprintf("draft-%d", time.Now().UnixNano())
	key := core.SessionKey{
		Account: s.account.ID,
		DraftID: draftID,
	}
	proj := s.resolver.Provisional(dir)

	s.mu.Lock()
	s.sessions[draftID] = &sessionState{
		summary: core.SessionSummary{
			Key:          key,
			Title:        "(new session)",
			ProjectKey:   proj.Key,
			ProjectName:  proj.Name,
			ProjectRoot:  proj.Root,
			Cwd:          dir,
			Status:       core.StatusWaiting,
			Ctl:          core.Ctl{Kind: core.CtlMine},
			LastActivity: time.Now(),
		},
	}
	s.mu.Unlock()
	return core.ChangedMsg{}
}

func (s *Store) doFork(a core.Action) tea.Msg {
	// TODO: fork via control protocol
	return core.ChangedMsg{}
}

func (s *Store) Completions(kind string, prefix string) []string {
	switch kind {
	case "account":
		var names []string
		for _, a := range s.accounts {
			if strings.HasPrefix(strings.ToLower(a.Name), strings.ToLower(prefix)) {
				names = append(names, a.Name)
			}
		}
		return names
	}
	return nil
}

func (s *Store) SetNotify(fn func()) {
	s.mu.Lock()
	defer s.mu.Unlock()
	s.notify = fn
}

func (s *Store) scanSessions() {
	for _, acct := range s.accounts {
		s.scanAccountSessions(acct)
	}
}

func (s *Store) scanAccountSessions(acct core.Account) {
	projectsDir := filepath.Join(acct.ConfigDir, "projects")
	entries, err := safefs.ReadDir(projectsDir)
	if err != nil {
		return
	}

	listDays := s.cfg.Prefs.ListDays
	if listDays <= 0 {
		listDays = 7
	}
	cutoff := time.Now().AddDate(0, 0, -listDays)

	for _, projEntry := range entries {
		if !projEntry.IsDir() {
			continue
		}
		projDir := filepath.Join(projectsDir, projEntry.Name())
		files, err := safefs.ReadDir(projDir)
		if err != nil {
			continue
		}

		for _, f := range files {
			if !strings.HasSuffix(f.Name(), ".jsonl") {
				continue
			}
			fpath := filepath.Join(projDir, f.Name())
			info, err := safefs.Stat(fpath)
			if err != nil {
				continue
			}
			if info.ModTime().Before(cutoff) {
				continue
			}

			sessionID := strings.TrimSuffix(f.Name(), ".jsonl")

			if _, exists := s.sessions[sessionID]; exists {
				continue
			}

			meta := s.scanSessionMeta(fpath)
			proj := s.resolver.Provisional(meta.Cwd)

			s.sessions[sessionID] = &sessionState{
				summary: core.SessionSummary{
					Key:          core.SessionKey{Account: acct.ID, SessionID: sessionID},
					Title:        meta.Title,
					ProjectKey:   proj.Key,
					ProjectName:  proj.Name,
					ProjectRoot:  proj.Root,
					Cwd:          meta.Cwd,
					Status:       core.StatusDone,
					Source:       core.SourceFromString(meta.Entrypoint),
					LastActivity: meta.LastTs,
				},
				filePath: fpath,
			}
		}
	}

	// Check registry for live sessions
	sessDir := filepath.Join(acct.ConfigDir, "sessions")
	regEntries, err := safefs.ReadDir(sessDir)
	if err != nil {
		return
	}
	for _, re := range regEntries {
		if !strings.HasSuffix(re.Name(), ".json") || strings.HasSuffix(re.Name(), ".key") {
			continue
		}
		name := re.Name()
		pidStr := strings.TrimSuffix(name, ".json")
		isDigits := true
		for _, c := range pidStr {
			if c < '0' || c > '9' {
				isDigits = false
				break
			}
		}
		if !isDigits {
			continue
		}

		data, err := safefs.ReadFile(filepath.Join(sessDir, name))
		if err != nil {
			continue
		}
		entry, ok := transcript.ParseRegistryEntry(data)
		if !ok {
			continue
		}

		if ss, exists := s.sessions[entry.SessionID]; exists {
			ss.summary.Status = registryStatus(entry.Status)
			ss.summary.Source = core.SourceFromString(entry.Entrypoint)
			if entry.Name != "" {
				ss.summary.Title = entry.Name
			}
			ss.summary.Ctl = core.Ctl{Kind: core.CtlElsewhere, PID: entry.PID}
		}
	}
}

func registryStatus(s string) core.Status {
	switch s {
	case "busy":
		return core.StatusRunning
	case "idle":
		return core.StatusWaiting
	case "waiting":
		return core.StatusNeedsYou
	default:
		return core.StatusDone
	}
}

func (s *Store) scanSessionMeta(path string) transcript.Meta {
	data, err := safefs.ReadFile(path)
	if err != nil {
		return transcript.Meta{}
	}

	// Read first 64KiB and last 256KiB
	const headSize = 64 * 1024
	const tailSize = 256 * 1024

	head := data
	if len(head) > headSize {
		head = head[:headSize]
	}
	tail := data
	if len(data) > tailSize {
		tail = data[len(data)-tailSize:]
	}

	return transcript.ScanMeta(head, tail)
}

func (s *Store) LoadSession(sessionID string) {
	s.mu.Lock()
	defer s.mu.Unlock()

	ss, ok := s.sessions[sessionID]
	if !ok || ss.filePath == "" {
		return
	}

	data, err := safefs.ReadFile(ss.filePath)
	if err != nil {
		return
	}

	var records []transcript.Record
	for _, line := range splitLines(data) {
		if transcript.ShouldSkipRaw(line) {
			continue
		}
		rec, ok := transcript.ParseLine(line)
		if ok {
			records = append(records, rec)
		}
	}

	ss.records = records
	ss.view = nil
	ss.lastRead = time.Now()
}

func splitLines(data []byte) [][]byte {
	var lines [][]byte
	start := 0
	for i := 0; i < len(data); i++ {
		if data[i] == '\n' {
			line := data[start:i]
			if len(line) > 0 && line[len(line)-1] == '\r' {
				line = line[:len(line)-1]
			}
			lines = append(lines, line)
			start = i + 1
		}
	}
	if start < len(data) {
		lines = append(lines, data[start:])
	}
	return lines
}
