package app

import (
	"context"
	"os"
	"path/filepath"
	"sort"
	"strings"
	"sync"
	"sync/atomic"
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

// Options configures a Store. Zero values get sensible defaults in
// NewWithOptions; tests inject NewController to avoid any real process.
type Options struct {
	Dirs          statefile.AppDirs
	ClaudePath    string
	Env           []string
	Spawner       ctlSpawner
	NewController newControllerFunc
	LaunchDir     string
	Home          string
	Now           func() time.Time
	NotifyDelay   time.Duration
}

type Store struct {
	mu       sync.Mutex
	account  core.Account
	accounts []core.Account
	cfg      accounts.Config
	dirs     statefile.AppDirs
	opts     Options
	home     string

	sessions map[string]*sessionState // session id (or draft id) -> state
	projects map[string]*gitx.Project // projectKey -> project
	resolver *gitx.Resolver
	notify   func()

	emptyScans map[string]scanSig // transcripts with no user prompt yet, by path
	resolving  map[string]bool    // cwds a git lookup is running for
	tailer     *transcript.Tailer

	controlSessions map[string]*controlledSession
	alias           map[string]string // draft id -> session id
	claudePath      string
	pids            map[int]bool // pids of our own children (snapshot, see snapshotPIDs)
	forkSeq         int
	noteSeq         int
	notifyPending   atomic.Bool
}

type sessionState struct {
	summary  core.SessionSummary
	records  []transcript.Record
	items    []core.Item
	itemsOK  bool
	skipped  bool // older history was not loaded (very large transcript)
	filePath string
}

// New builds a Store with production defaults.
func New(acct core.Account, allAccounts []core.Account, cfg accounts.Config) *Store {
	home, _ := os.UserHomeDir()
	o := Options{
		Dirs: statefile.GetDirs(),
		Env:  os.Environ(),
		Home: home,
	}
	o.ClaudePath = cfg.Prefs.ClaudePath
	if o.ClaudePath == "" {
		if p, err := control.ResolveClaude("", o.Env, home, fileExists); err == nil {
			o.ClaudePath = p
		}
	}
	o.LaunchDir, _ = os.Getwd()
	return NewWithOptions(acct, allAccounts, cfg, o)
}

func NewWithOptions(acct core.Account, allAccounts []core.Account, cfg accounts.Config, o Options) *Store {
	if o.Dirs.Config == "" && o.Dirs.Local == "" && o.Dirs.Locks == "" {
		o.Dirs = statefile.GetDirs()
	}
	if o.ClaudePath == "" {
		o.ClaudePath = cfg.Prefs.ClaudePath
	}
	if o.Home == "" {
		o.Home, _ = os.UserHomeDir()
	}
	if o.LaunchDir == "" {
		o.LaunchDir, _ = os.Getwd()
	}
	if o.Now == nil {
		o.Now = time.Now
	}
	if o.NotifyDelay <= 0 {
		o.NotifyDelay = 50 * time.Millisecond
	}
	if o.NewController == nil && defaultNewController != nil {
		o.NewController = defaultNewController(o)
	}

	return &Store{
		account:         acct,
		accounts:        append([]core.Account{}, allAccounts...),
		cfg:             cfg,
		dirs:            o.Dirs,
		opts:            o,
		home:            o.Home,
		sessions:        make(map[string]*sessionState),
		projects:        make(map[string]*gitx.Project),
		resolver:        gitx.NewResolver(),
		tailer:          transcript.NewTailer(fsReader{}),
		controlSessions: make(map[string]*controlledSession),
		alias:           make(map[string]string),
		pids:            make(map[int]bool),
		claudePath:      o.ClaudePath,
	}
}

func fileExists(path string) bool {
	_, err := os.Stat(path)
	return err == nil
}

func (s *Store) now() time.Time { return s.opts.Now() }

// fsReader adapts safefs to transcript.ByteReader.
type fsReader struct{}

func (fsReader) Stat(path string) (int64, time.Time, bool, error) {
	return safefs.StatForTailer(path)
}

func (fsReader) ReadRange(path string, start, end int64) ([]byte, error) {
	return safefs.ReadRange(path, start, end)
}

func (s *Store) Account() core.Account {
	s.mu.Lock()
	defer s.mu.Unlock()
	return s.account
}

func (s *Store) Accounts() []core.Account {
	s.mu.Lock()
	list := append([]core.Account{}, s.accounts...)
	s.mu.Unlock()
	return s.withAlwaysUse(list)
}

func (s *Store) Sessions(all bool) []core.SessionSummary {
	s.snapshotPIDs()
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
		if !result[i].LastActivity.Equal(result[j].LastActivity) {
			return result[i].LastActivity.After(result[j].LastActivity)
		}
		return keyID(result[i].Key) < keyID(result[j].Key)
	})

	return result
}

// ensureLoaded reads any new complete transcript lines of ss (mu held).
func (s *Store) ensureLoaded(ss *sessionState) {
	if ss.filePath == "" {
		return
	}
	tr, err := s.tailer.Read(ss.filePath)
	if err != nil {
		return
	}
	changed := false
	if tr.Reset {
		ss.records = nil
		ss.skipped = false
		changed = true
	}
	if tr.Skipped > 0 {
		ss.skipped = true
		changed = true
	}
	for _, line := range tr.Lines {
		line = trimCR(line)
		if transcript.ShouldSkipRaw(line) {
			continue
		}
		rec, ok := transcript.ParseLine(line)
		if !ok {
			continue
		}
		ss.records = append(ss.records, rec)
		changed = true
	}
	if changed || !ss.itemsOK {
		ss.items = buildItems(ss.records)
		if ss.skipped {
			ss.items = append([]core.Item{{
				ID: "older-skipped", Kind: core.ItemNotice, Text: "older history not loaded",
			}}, ss.items...)
		}
		ss.itemsOK = true
	}
}

func trimCR(b []byte) []byte {
	if n := len(b); n > 0 && b[n-1] == '\r' {
		return b[:n-1]
	}
	return b
}

func (s *Store) View(key core.SessionKey, agentID string) (core.SessionView, bool) {
	s.mu.Lock()
	defer s.mu.Unlock()

	id := s.resolve(key)
	ss, ok := s.sessions[id]
	if !ok {
		return core.SessionView{}, false
	}
	s.ensureLoaded(ss)

	view := core.SessionView{Summary: ss.summary}
	cs := s.controlSessions[id]
	if cs == nil {
		view.Items = append([]core.Item(nil), ss.items...)
		return view, true
	}

	view.Items = mergeOverlay(ss.items, cs)
	view.Typing = cs.typing
	view.Thinking = cs.thinking
	view.Cards = append([]core.Card(nil), cs.cards...)
	info := cs.info
	info.Commands = append([]string(nil), info.Commands...)
	info.Models = append([]string(nil), info.Models...)
	view.Ctl = &info
	return view, true
}

// mergeOverlay merges the store-owned notices and the optimistic echo into
// the transcript items by time. Notices go before a transcript item with the
// same time. The echo is dropped once the transcript contains the prompt.
func mergeOverlay(items []core.Item, cs *controlledSession) []core.Item {
	if cs.echo != nil {
		for _, it := range items {
			if it.Kind == core.ItemPrompt && it.Text == cs.echo.Text &&
				!it.Time.Before(cs.echo.Time.Add(-2*time.Second)) {
				cs.echo = nil
				break
			}
		}
	}
	extra := make([]core.Item, 0, len(cs.notices)+1)
	extra = append(extra, cs.notices...)
	if cs.echo != nil {
		extra = append(extra, *cs.echo)
	}
	sort.SliceStable(extra, func(i, j int) bool { return extra[i].Time.Before(extra[j].Time) })

	out := make([]core.Item, 0, len(items)+len(extra))
	e := 0
	for _, it := range items {
		for e < len(extra) && !extra[e].Time.After(it.Time) {
			out = append(out, extra[e])
			e++
		}
		out = append(out, it)
	}
	out = append(out, extra[e:]...)
	return out
}

// buildItems converts records to items, merging every tool result into the
// item of its tool use (by UseID) instead of emitting a second item.
func buildItems(records []transcript.Record) []core.Item {
	var items []core.Item
	byUse := make(map[string]int)
	for _, rec := range records {
		for _, it := range recordToItems(rec) {
			if it.Kind != core.ItemTool || it.Tool == nil || it.Tool.UseID == "" {
				items = append(items, it)
				continue
			}
			idx, seen := byUse[it.Tool.UseID]
			if !seen {
				byUse[it.Tool.UseID] = len(items)
				items = append(items, it)
				continue
			}
			prev := items[idx].Tool
			if it.Tool.Name != "" { // a second use record: keep the first
				continue
			}
			prev.Result = it.Tool.Result
			prev.Failed = it.Tool.Failed
			prev.Interrupted = it.Tool.Interrupted
			prev.Added = it.Tool.Added
			prev.Removed = it.Tool.Removed
			prev.Open = false
		}
	}
	return items
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
					UseID:    tu.UseID,
					Name:     tu.Name,
					Target:   tu.Target,
					FilePath: tu.FilePath,
					Input:    tu.InputPreview,
					Open:     true,
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
					UseID:       tr.UseID,
					Result:      tr.Text,
					Failed:      tr.IsError,
					Interrupted: tr.Interrupted,
					Open:        false,
					Added:       tr.Added,
					Removed:     tr.Removed,
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

	for id, ss := range s.sessions {
		if !ss.summary.Blocked {
			continue
		}
		att := core.Attention{
			Key:      ss.summary.Key,
			Kind:     "waiting",
			Detail:   ss.summary.Reason,
			Severity: core.SeverityBlocked,
		}
		if cs := s.controlSessions[id]; cs != nil && len(cs.cards) > 0 {
			att.Kind = cardKindName(cs.cards[0])
			att.Since = cs.cards[0].Since
		}
		items = append(items, att)
		if ss.summary.Key.Account == s.account.ID {
			mine++
		} else {
			others++
		}
	}
	sort.Slice(items, func(i, j int) bool {
		if !items[i].Since.Equal(items[j].Since) {
			return items[i].Since.Before(items[j].Since)
		}
		return keyID(items[i].Key) < keyID(items[j].Key)
	})
	return
}

func cardKindName(c core.Card) string {
	switch {
	case c.IsPlan():
		return "plan"
	case c.IsQuestion():
		return "question"
	default:
		return "permission"
	}
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
	if a.Kind == core.ActionSignIn {
		return s.signInCmd(a)
	}
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
		case core.ActionSetModel:
			return s.doSetModel(a)
		case core.ActionSetMode:
			return s.doSetMode(a)
		case core.ActionCtx:
			return s.doDetails(a, control.ReqGetContextUsage, "context")
		case core.ActionMcp:
			return s.doDetails(a, control.ReqMcpStatus, "mcp")
		case core.ActionSwitchAccount:
			return s.doSwitchAccount(a)
		case core.ActionRefresh:
			s.snapshotPIDs()
			s.mu.Lock()
			s.scanSessions()
			s.mu.Unlock()
			return core.ChangedMsg{}
		default:
			return core.ChangedMsg{}
		}
	}
}

func (s *Store) Completions(kind string, prefix string) []string {
	switch kind {
	case "account":
		s.mu.Lock()
		defer s.mu.Unlock()
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

// scanSessions rescans every account (mu held).
func (s *Store) scanSessions() {
	locks := ListLocks(s.dirs.Locks)
	for _, acct := range s.accounts {
		s.scanTranscripts(acct)
		s.refreshLive(acct, locks)
	}
}

// scanTranscripts discovers new transcript files of acct and refreshes the
// activity time of known ones (mu held).
func (s *Store) scanTranscripts(acct core.Account) {
	projectsDir := filepath.Join(acct.ConfigDir, "projects")
	entries, err := safefs.ReadDir(projectsDir)
	if err != nil {
		return
	}

	listDays := s.cfg.Prefs.ListDays
	if listDays <= 0 {
		listDays = 7
	}
	cutoff := s.now().AddDate(0, 0, -listDays)

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

			sessionID := strings.TrimSuffix(f.Name(), ".jsonl")

			if known, exists := s.sessions[sessionID]; exists {
				if info.ModTime().After(known.summary.LastActivity) {
					known.summary.LastActivity = info.ModTime()
					// A better title (ai/custom) usually lands after the first prompt.
					if _, mine := s.controlSessions[sessionID]; !mine && known.filePath == fpath {
						if m := s.scanSessionMeta(fpath, info.Size()); m.TitleKind != "" {
							known.summary.Title = m.Title
						}
					}
				}
				continue
			}
			if info.ModTime().Before(cutoff) {
				continue
			}

			sig := scanSig{mtime: info.ModTime(), size: info.Size()}
			if prev, ok := s.emptyScans[fpath]; ok && prev == sig {
				continue
			}
			meta := s.scanSessionMeta(fpath, info.Size())
			if !meta.HasPrompt {
				// Only snapshots or meta lines so far: not a session yet.
				if s.emptyScans == nil {
					s.emptyScans = map[string]scanSig{}
				}
				s.emptyScans[fpath] = sig
				continue
			}
			delete(s.emptyScans, fpath)
			proj := s.projectFor(meta.Cwd, projEntry.Name())
			last := meta.LastTs
			if last.IsZero() {
				last = info.ModTime()
			}

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
					LastActivity: last,
				},
				filePath: fpath,
			}
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

// scanSig identifies a transcript version, so a file with nothing to list is
// not re-read until it changes.
type scanSig struct {
	mtime time.Time
	size  int64
}

const (
	metaHeadBytes = 1 << 20   // a pasted prompt or snapshot can make line 1 huge
	metaTailBytes = 256 << 10 // latest titles live near the end
)

func (s *Store) scanSessionMeta(path string, size int64) transcript.Meta {
	headEnd := size
	if headEnd > metaHeadBytes {
		headEnd = metaHeadBytes
	}
	head, err := safefs.ReadRange(path, 0, headEnd)
	if err != nil {
		return transcript.Meta{}
	}
	var tail []byte
	if size > headEnd {
		start := size - metaTailBytes
		if start < headEnd {
			start = headEnd
		}
		tail, _ = safefs.ReadRange(path, start, size)
	}
	return transcript.ScanMeta(head, tail)
}

// projectFor groups a session by its cwd's git root (once git has answered;
// until then by the cwd itself). Without a cwd the project is inferred from
// the encoded project directory name and keyed "dir:" so it never merges
// with a real path.
func (s *Store) projectFor(cwd, projectDir string) gitx.Project {
	if cwd == "" {
		return projectFromDir(projectDir)
	}
	if p, ok := s.resolver.Cached(cwd); ok {
		return p
	}
	if !s.resolving[cwd] {
		if s.resolving == nil {
			s.resolving = map[string]bool{}
		}
		s.resolving[cwd] = true
		go s.resolveProject(cwd)
	}
	return s.resolver.Provisional(cwd)
}

func (s *Store) resolveProject(cwd string) {
	ctx, cancel := context.WithTimeout(context.Background(), 10*time.Second)
	defer cancel()
	p := s.resolver.Resolve(ctx, cwd)
	s.mu.Lock()
	delete(s.resolving, cwd)
	for _, ss := range s.sessions {
		if ss.summary.Cwd == cwd {
			ss.summary.ProjectKey, ss.summary.ProjectName, ss.summary.ProjectRoot = p.Key, p.Name, p.Root
		}
	}
	s.mu.Unlock()
	s.kick()
}

// projectFromDir is the last resort when a transcript never named its cwd.
// Claude encodes a path by turning every non-alphanumeric rune into "-", which
// cannot be reversed; the last segment is the best readable name.
func projectFromDir(dir string) gitx.Project {
	trimmed := strings.TrimRight(dir, "-")
	name := trimmed
	if i := strings.LastIndex(trimmed, "-"); i >= 0 {
		name = trimmed[i+1:]
	}
	if name == "" {
		name = dir
	}
	return gitx.Project{Key: "dir:" + strings.ToLower(dir), Name: name}
}
