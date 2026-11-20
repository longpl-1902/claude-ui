package app

import (
	"context"
	"encoding/json"
	"errors"
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
	"github.com/longpl-1902/claude-ui/internal/transcript"

	tea "charm.land/bubbletea/v2"
)

// controller is the runtime of one controlled claude session.
// *control.Session satisfies it.
type controller interface {
	Send(string) error
	Answer(string, ctlAnswer) error
	Interrupt() error
	SetModel(string) error
	SetMode(string) error
	Request(context.Context, control.ReqKind, map[string]any) (json.RawMessage, error)
	Stop(context.Context) error
	Close()
	Info() ctlInfo
	Pending() []core.Card
	Events() <-chan control.Event
}

type newControllerFunc func(l control.Launch) controller

// defaultNewController builds the production factory. It is set by
// controller.go (the file that links the real runtime).
var defaultNewController func(o Options) newControllerFunc

const maxNotices = 50

// controlledSession is a session whose claude child this process owns.
type controlledSession struct {
	key        core.SessionKey
	ctl        controller
	account    core.Account
	cwd        string
	forkedFrom string
	locked     string
	typing     string
	thinking   bool
	cards      []core.Card
	info       core.CtlInfo
	notices    []core.Item
	echo       *core.Item
	done       chan struct{}
	sent       bool // doSend handed it a prompt (R-19: never spawned before)
}

// keyID is the map key of a session: its id, or its draft id before init.
func keyID(k core.SessionKey) string {
	if k.SessionID != "" {
		return k.SessionID
	}
	return k.DraftID
}

// resolve maps a UI key to the store's current id (mu held).
func (s *Store) resolve(k core.SessionKey) string {
	id := keyID(k)
	if real, ok := s.alias[id]; ok {
		return real
	}
	return id
}

func (s *Store) accountByID(id core.AccountID) (core.Account, bool) {
	for _, a := range s.accounts {
		if a.ID == id {
			return a, true
		}
	}
	return core.Account{}, false
}

// pickAccount chooses the account for a new session in cwd (mu held).
func (s *Store) pickAccount(cwd string) core.Account {
	if name, ok := accounts.MatchFolder(s.cfg.Rules, cwd, s.home); ok {
		for _, a := range s.accounts {
			if string(a.ID) == name || strings.EqualFold(a.Name, name) {
				return a
			}
		}
	}
	return s.account
}

func shortID(id string) string {
	if len(id) > 8 {
		return id[:8]
	}
	return id
}

// ---- draft and controller creation (mu held) ----

func (s *Store) newDraftLocked(dir string, acct core.Account) core.SessionKey {
	s.forkSeq++
	draftID := fmt.Sprintf("draft-%d", s.forkSeq)
	key := core.SessionKey{Account: acct.ID, DraftID: draftID}
	proj := s.resolver.Provisional(dir)
	s.sessions[draftID] = &sessionState{
		summary: core.SessionSummary{
			Key:          key,
			Title:        "(new session)",
			ProjectKey:   proj.Key,
			ProjectName:  proj.Name,
			ProjectRoot:  proj.Root,
			Cwd:          dir,
			Status:       core.StatusWaiting,
			Ctl:          core.Ctl{Kind: core.CtlMine, PID: os.Getpid()},
			LastActivity: s.now(),
		},
	}
	return key
}

func (s *Store) newControlledLocked(key core.SessionKey, acct core.Account, cwd string, l control.Launch, forkedFrom string) *controlledSession {
	cs := &controlledSession{
		key:        key,
		ctl:        s.opts.NewController(l),
		account:    acct,
		cwd:        cwd,
		forkedFrom: forkedFrom,
		info:       core.CtlInfo{State: "draft", Mode: "default"},
		done:       make(chan struct{}),
	}
	s.controlSessions[keyID(key)] = cs
	go s.pump(cs)
	return cs
}

func (s *Store) addNoticeLocked(cs *controlledSession, text string) {
	s.noteSeq++
	cs.notices = append(cs.notices, core.Item{
		ID:   fmt.Sprintf("notice-%d", s.noteSeq),
		Kind: core.ItemNotice,
		Time: s.now(),
		Text: text,
	})
	if len(cs.notices) > maxNotices {
		cs.notices = append([]core.Item(nil), cs.notices[len(cs.notices)-maxNotices:]...)
	}
}

// launchFor validates the account and cwd and builds the Launch (mu held).
func (s *Store) launchFor(acct core.Account, cwd string) (control.Launch, tea.Msg) {
	if !acct.SignedIn {
		return control.Launch{}, core.ErrMsg{Text: fmt.Sprintf("%s is not signed in — :account, then s to sign in", acct.Name)}
	}
	if s.claudePath == "" {
		return control.Launch{}, core.ErrMsg{Text: "claude.exe not found; set prefs.claudePath"}
	}
	if !filepath.IsAbs(acct.ConfigDir) {
		return control.Launch{}, core.ErrMsg{Text: "account config dir must be absolute: " + acct.ConfigDir}
	}
	if st, err := os.Stat(cwd); err != nil || !st.IsDir() {
		return control.Launch{}, core.ErrMsg{Text: "project folder is gone: " + cwd}
	}
	if s.opts.NewController == nil {
		return control.Launch{}, core.ErrMsg{Text: "control runtime unavailable in this build"}
	}
	return control.Launch{
		ClaudePath: s.claudePath,
		ConfigDir:  acct.ConfigDir,
		Mode:       "default",
		Cwd:        cwd,
	}, nil
}

// forkLocked creates a fork draft of ss with its controller; nothing is sent.
func (s *Store) forkLocked(ss *sessionState, acct core.Account, launch control.Launch, notice string) *controlledSession {
	parent := ss.summary.Key.SessionID
	fk := s.newDraftLocked(ss.summary.Cwd, acct)
	row := s.sessions[fk.DraftID]
	row.summary.Title = ss.summary.Title
	row.summary.ProjectKey = ss.summary.ProjectKey
	row.summary.ProjectName = ss.summary.ProjectName
	row.summary.ProjectRoot = ss.summary.ProjectRoot
	launch.SessionID = parent
	launch.Fork = true
	cs := s.newControlledLocked(fk, acct, ss.summary.Cwd, launch, parent)
	s.addNoticeLocked(cs, notice)
	return cs
}

// ---- send ----

type sendPlan struct {
	cs        *controlledSession
	open      bool
	created   bool   // controller created by this call
	freshRow  string // draft row created by this call
	answerReq string // case Q: answer this question card instead of sending
	answers   map[string]string
}

func (s *Store) doSend(a core.Action) tea.Msg {
	text := a.Text
	if strings.TrimSpace(text) == "" {
		return core.ChangedMsg{}
	}
	s.snapshotPIDs()

	s.mu.Lock()
	plan, errMsg := s.planSend(a.Key, text)
	s.mu.Unlock()
	if errMsg != nil {
		return errMsg
	}

	if plan.answerReq != "" {
		err := plan.cs.ctl.Answer(plan.answerReq, ctlAnswer{Allow: true, Answers: plan.answers})
		if err != nil {
			return answerErr(err)
		}
		return core.ChangedMsg{}
	}

	if err := plan.cs.ctl.Send(text); err != nil {
		s.failSend(plan)
		return core.ErrMsg{Text: "send failed: " + err.Error()}
	}
	if plan.open {
		s.mu.Lock()
		key := plan.cs.key
		s.mu.Unlock()
		return core.OpenMsg{Key: key}
	}
	return core.ChangedMsg{}
}

func answerErr(err error) tea.Msg {
	if errors.Is(err, errUnknownRequest) {
		return core.ErrMsg{Text: "already answered"}
	}
	return core.ErrMsg{Text: "answer failed: " + err.Error()}
}

// planSend decides between the cases N, Q, M, D, R and F (mu held).
func (s *Store) planSend(key core.SessionKey, text string) (sendPlan, tea.Msg) {
	now := s.now()
	echo := &core.Item{ID: fmt.Sprintf("echo-%d", now.UnixNano()), Kind: core.ItemPrompt, Time: now, Text: text}

	// case N: no key, start a new session in the launch dir
	if key.IsZero() {
		cwd := s.opts.LaunchDir
		acct := s.pickAccount(cwd)
		launch, msg := s.launchFor(acct, cwd)
		if msg != nil {
			return sendPlan{}, msg
		}
		dk := s.newDraftLocked(cwd, acct)
		cs := s.newControlledLocked(dk, acct, cwd, launch, "")
		cs.echo = echo
		cs.sent = true
		return sendPlan{cs: cs, open: true, created: true, freshRow: dk.DraftID}, nil
	}

	id := s.resolve(key)
	if cs := s.controlSessions[id]; cs != nil {
		// case Q: a pending question takes the text as its "Other" answer
		if !strings.HasPrefix(text, "/") {
			for _, c := range cs.cards {
				if c.IsQuestion() && !c.IsPlan() {
					return sendPlan{
						cs:        cs,
						answerReq: c.RequestID,
						answers:   map[string]string{c.Questions[0].Text: text},
					}, nil
				}
			}
		}
		// case M
		cs.echo = echo
		cs.sent = true
		return sendPlan{cs: cs}, nil
	}

	ss, ok := s.sessions[id]
	if !ok {
		return sendPlan{}, core.ErrMsg{Text: "unknown session"}
	}

	// case D: a draft row without a controller yet
	if isDraft(ss.summary.Key) {
		cwd := ss.summary.Cwd
		acct := s.pickAccount(cwd)
		launch, msg := s.launchFor(acct, cwd)
		if msg != nil {
			return sendPlan{}, msg
		}
		ss.summary.Key.Account = acct.ID
		cs := s.newControlledLocked(ss.summary.Key, acct, cwd, launch, "")
		cs.echo = echo
		cs.sent = true
		return sendPlan{cs: cs, created: true}, nil
	}

	// transcript session: resume it, or fork it when it runs somewhere else
	acct, ok := s.accountByID(ss.summary.Key.Account)
	if !ok {
		acct = s.account
	}
	cwd := ss.summary.Cwd
	launch, msg := s.launchFor(acct, cwd)
	if msg != nil {
		return sendPlan{}, msg
	}
	sid := ss.summary.Key.SessionID

	s.refreshLive(acct, nil)
	where := ss.summary.CtlWhere
	if where == "" {
		got, info, err := AcquireLock(s.dirs.Locks, sid, acct.ID)
		if err != nil {
			return sendPlan{}, core.ErrMsg{Text: "could not lock session: " + err.Error()}
		}
		if got {
			launch.SessionID = sid
			cs := s.newControlledLocked(ss.summary.Key, acct, cwd, launch, "")
			cs.locked = sid
			cs.echo = echo
			cs.sent = true
			return sendPlan{cs: cs, created: true}, nil // case R
		}
		if info != nil {
			where = otherACWhere(*info)
		} else {
			where = "another ac"
		}
	}

	// case F
	notice := fmt.Sprintf("↳ forked from %s because it is running in %s", shortID(sid), where)
	cs := s.forkLocked(ss, acct, launch, notice)
	cs.echo = echo
	cs.sent = true
	return sendPlan{cs: cs, open: true, created: true, freshRow: cs.key.DraftID}, nil
}

// failSend undoes a send whose controller never spawned.
func (s *Store) failSend(p sendPlan) {
	spawned := p.cs.ctl.Info().Spawns > 0
	remove := p.created && !spawned

	s.mu.Lock()
	p.cs.echo = nil
	if remove {
		delete(s.controlSessions, keyID(p.cs.key))
		if p.cs.locked != "" {
			_ = ReleaseLock(s.dirs.Locks, p.cs.locked)
			p.cs.locked = ""
		}
		if p.freshRow != "" {
			delete(s.sessions, p.freshRow)
		}
	}
	s.mu.Unlock()
	if remove {
		p.cs.ctl.Close()
	}
}

// ---- answer, interrupt, stop, fork, new ----

func (s *Store) controlledFor(k core.SessionKey) *controlledSession {
	s.mu.Lock()
	defer s.mu.Unlock()
	return s.controlSessions[s.resolve(k)]
}

func (s *Store) doAnswer(a core.Action) tea.Msg {
	s.mu.Lock()
	cs := s.controlSessions[s.resolve(a.Key)]
	found := false
	if cs != nil {
		for _, c := range cs.cards {
			if c.RequestID == a.RequestID {
				found = true
				break
			}
		}
	}
	s.mu.Unlock()
	if cs == nil {
		return core.ErrMsg{Text: "not controlled here"}
	}
	if !found {
		return core.ErrMsg{Text: "already answered"}
	}
	err := cs.ctl.Answer(a.RequestID, ctlAnswer{
		Allow:      a.Allow,
		ForSession: a.ForSession,
		Message:    a.Message,
		Answers:    a.Answers,
	})
	if err != nil {
		return answerErr(err)
	}
	return core.ChangedMsg{}
}

func (s *Store) doInterrupt(a core.Action) tea.Msg {
	cs := s.controlledFor(a.Key)
	if cs == nil {
		return core.ErrMsg{Text: "nothing to interrupt"}
	}
	if err := cs.ctl.Interrupt(); err != nil {
		if errors.Is(err, errNotBusy) {
			return core.ErrMsg{Text: "not running"}
		}
		return core.ErrMsg{Text: "interrupt failed: " + err.Error()}
	}
	return core.ChangedMsg{}
}

func (s *Store) doStop(a core.Action) tea.Msg {
	s.mu.Lock()
	id := s.resolve(a.Key)
	cs := s.controlSessions[id]
	if cs == nil {
		s.mu.Unlock()
		return core.ChangedMsg{}
	}
	if isDraft(cs.key) && !cs.sent {
		// never spawned: just forget the draft row
		delete(s.controlSessions, id)
		delete(s.sessions, id)
		s.mu.Unlock()
		cs.ctl.Close()
		return core.ChangedMsg{}
	}
	s.mu.Unlock()

	ctx, cancel := context.WithTimeout(context.Background(), 5*time.Second)
	_ = cs.ctl.Stop(ctx)
	cancel()
	cs.ctl.Close()
	select {
	case <-cs.done:
	case <-time.After(time.Second):
	}

	s.mu.Lock()
	delete(s.controlSessions, keyID(cs.key))
	if cs.locked != "" {
		_ = ReleaseLock(s.dirs.Locks, cs.locked)
		cs.locked = ""
	}
	if ss := s.sessions[keyID(cs.key)]; ss != nil {
		ss.summary.Ctl = core.Ctl{}
		ss.summary.CtlWhere = ""
		ss.summary.Status = core.StatusDone
		ss.summary.Blocked = false
		ss.summary.Reason = ""
	}
	s.mu.Unlock()
	return core.ChangedMsg{}
}

func (s *Store) doNewDraft(a core.Action) tea.Msg {
	s.mu.Lock()
	defer s.mu.Unlock()
	dir := a.Dir
	if dir == "" {
		dir = s.opts.LaunchDir
	}
	key := s.newDraftLocked(dir, s.pickAccount(dir))
	return core.OpenMsg{Key: key}
}

// doFork is the explicit :fork. It creates the fork draft and controller but
// sends nothing; the spawn happens with the first send (R-19).
func (s *Store) doFork(a core.Action) tea.Msg {
	s.mu.Lock()
	defer s.mu.Unlock()
	id := s.resolve(a.Key)
	ss, ok := s.sessions[id]
	if !ok || ss.summary.Key.SessionID == "" {
		return core.ErrMsg{Text: "nothing to fork yet"}
	}
	acct, ok := s.accountByID(ss.summary.Key.Account)
	if !ok {
		acct = s.account
	}
	launch, msg := s.launchFor(acct, ss.summary.Cwd)
	if msg != nil {
		return msg
	}
	cs := s.forkLocked(ss, acct, launch, "↳ forked from "+shortID(ss.summary.Key.SessionID))
	return core.OpenMsg{Key: cs.key}
}

func (s *Store) doSetModel(a core.Action) tea.Msg {
	cs := s.controlledFor(a.Key)
	if cs == nil {
		return core.ErrMsg{Text: "not controlled here"}
	}
	if err := cs.ctl.SetModel(a.Text); err != nil {
		return core.ErrMsg{Text: err.Error()}
	}
	s.mu.Lock()
	cs.info.Model = a.Text
	s.mu.Unlock()
	return core.ChangedMsg{}
}

func (s *Store) doSetMode(a core.Action) tea.Msg {
	cs := s.controlledFor(a.Key)
	if cs == nil {
		return core.ErrMsg{Text: "not controlled here"}
	}
	if err := cs.ctl.SetMode(a.Text); err != nil {
		return core.ErrMsg{Text: err.Error()}
	}
	s.mu.Lock()
	cs.info.Mode = a.Text
	s.mu.Unlock()
	return core.ChangedMsg{}
}

// doDetails answers :ctx and :mcp. R-19: only for a session that already
// received its first prompt.
func (s *Store) doDetails(a core.Action, kind control.ReqKind, title string) tea.Msg {
	s.mu.Lock()
	cs := s.controlSessions[s.resolve(a.Key)]
	live := cs != nil && cs.sent && cs.info.State != "exited" && cs.info.State != "draft"
	s.mu.Unlock()
	if !live {
		return core.ErrMsg{Text: "send a prompt first"}
	}
	ctx, cancel := context.WithTimeout(context.Background(), 10*time.Second)
	defer cancel()
	raw, err := cs.ctl.Request(ctx, kind, nil)
	if err != nil {
		if errors.Is(err, errNotLive) {
			return core.ErrMsg{Text: "send a prompt first"}
		}
		return core.ErrMsg{Text: title + ": " + err.Error()}
	}
	return core.InfoMsg{Title: title, Lines: summarizeJSON(raw)}
}

func summarizeJSON(raw json.RawMessage) []string {
	var m map[string]any
	if err := json.Unmarshal(raw, &m); err != nil {
		return []string{strings.TrimSpace(string(raw))}
	}
	keys := make([]string, 0, len(m))
	for k := range m {
		keys = append(keys, k)
	}
	sort.Strings(keys)
	var lines []string
	for _, k := range keys {
		switch v := m[k].(type) {
		case string, float64, bool:
			lines = append(lines, fmt.Sprintf("%s: %v", k, v))
		case []any:
			lines = append(lines, fmt.Sprintf("%s: %d", k, len(v)))
			for _, e := range v {
				if obj, ok := e.(map[string]any); ok {
					name, _ := obj["name"].(string)
					if name == "" {
						continue
					}
					st, _ := obj["status"].(string)
					lines = append(lines, strings.TrimSpace("  "+name+" "+st))
				}
			}
		}
		if len(lines) >= 20 {
			break
		}
	}
	return lines
}

// ---- event pump ----

func (s *Store) pump(cs *controlledSession) {
	for ev := range cs.ctl.Events() {
		s.mu.Lock()
		s.apply(cs, ev)
		s.mu.Unlock()
		s.kick()
	}
	close(cs.done)
}

// kick coalesces change notifications. It never calls notify with mu held:
// notify is p.Send, which blocks until Update runs, and Update calls back
// into the store.
func (s *Store) kick() {
	if s.notifyPending.CompareAndSwap(false, true) {
		time.AfterFunc(s.opts.NotifyDelay, func() {
			s.notifyPending.Store(false)
			s.mu.Lock()
			fn := s.notify
			s.mu.Unlock()
			if fn != nil {
				fn()
			}
		})
	}
}

func stateStatus(state string) core.Status {
	switch state {
	case "starting", "busy":
		return core.StatusRunning
	case "idle":
		return core.StatusWaiting
	case "stopping", "exited":
		return core.StatusDone
	default:
		return core.StatusWaiting
	}
}

func cardReason(c core.Card) string {
	switch {
	case c.IsPlan():
		return "plan"
	case c.IsQuestion():
		return "question"
	default:
		return "permission: " + c.DisplayName
	}
}

// syncSummary copies the controlled state into the session row (mu held).
func (s *Store) syncSummary(cs *controlledSession) {
	ss := s.sessions[keyID(cs.key)]
	if ss == nil {
		return
	}
	ss.summary.Ctl = core.Ctl{Kind: core.CtlMine, PID: os.Getpid()}
	ss.summary.CtlWhere = ""
	ss.summary.Status = stateStatus(cs.info.State)
	if len(cs.cards) > 0 {
		ss.summary.Status = core.StatusNeedsYou
		ss.summary.Blocked = true
		ss.summary.Reason = cardReason(cs.cards[0])
	} else {
		ss.summary.Blocked = false
		ss.summary.Reason = ""
	}
	if cs.info.Model != "" {
		ss.summary.Model = cs.info.Model
	}
}

// apply folds one runtime event into the store (mu held).
func (s *Store) apply(cs *controlledSession, ev control.Event) {
	switch ev.Kind {
	case control.EvState:
		cs.info.State = ev.Text
		if ss := s.sessions[keyID(cs.key)]; ss != nil {
			ss.summary.LastActivity = s.now()
		}
	case control.EvInit:
		cs.info.Model = ev.Model
		cs.info.Version = ev.Version
		if len(ev.Commands) > 0 {
			cs.info.Commands = ev.Commands
		}
		if cs.key.SessionID == "" && ev.SessionID != "" {
			s.adoptSessionID(cs, ev.SessionID)
		}
	case control.EvTyping:
		cs.typing = ev.Text
	case control.EvTypingClear:
		cs.typing = ""
	case control.EvThinking:
		cs.thinking = ev.Thinking
	case control.EvPermission:
		if ev.Card == nil {
			break
		}
		c := *ev.Card
		if c.RequestID == "" {
			c.RequestID = ev.RequestID
		}
		for _, old := range cs.cards {
			if old.RequestID == c.RequestID {
				return
			}
		}
		cs.cards = append(cs.cards, c)
	case control.EvPermissionResolved:
		kept := cs.cards[:0]
		for _, c := range cs.cards {
			if c.RequestID != ev.RequestID {
				kept = append(kept, c)
			}
		}
		cs.cards = kept
	case control.EvTurnEnd:
		cs.info.CostUSD += ev.Cost
		cs.typing = ""
		cs.thinking = false
	case control.EvNotice:
		s.addNoticeLocked(cs, ev.Text)
	case control.EvDetails:
		switch ev.Text {
		case "get_context_usage":
			if pct, ok := parseCtxPct(ev.Info); ok {
				cs.info.CtxPct = pct
			}
		case "initialize":
			models, commands := parseInitInfo(ev.Info)
			if len(models) > 0 {
				cs.info.Models = models
			}
			if len(commands) > 0 {
				cs.info.Commands = commands
			}
		}
	case control.EvExited:
		cs.info.State = "exited"
		cs.cards = nil
		cs.typing = ""
		cs.thinking = false
		if ev.Code != 0 {
			msg := strings.TrimSpace(ev.Error)
			cs.info.Error = msg
			first, _, _ := strings.Cut(msg, "\n")
			s.addNoticeLocked(cs, fmt.Sprintf("claude exited (code %d): %s", ev.Code, strings.TrimSpace(first)))
		}
	}
	s.syncSummary(cs)
}

// adoptSessionID gives a draft or fork its real id (mu held): the row, the
// controller entry and the lock move to the id; old draft keys keep working
// through alias.
func (s *Store) adoptSessionID(cs *controlledSession, id string) {
	old := keyID(cs.key)
	row := s.sessions[old]
	delete(s.sessions, old)
	delete(s.controlSessions, old)

	cs.key.SessionID = id
	s.alias[old] = id
	if row != nil {
		row.summary.Key.SessionID = id
		row.filePath = filepath.Join(cs.account.ConfigDir, "projects", transcript.EncodeProjectDir(cs.cwd), id+".jsonl")
		row.itemsOK = false
		s.sessions[id] = row
	}
	s.controlSessions[id] = cs

	got, _, err := AcquireLock(s.dirs.Locks, id, cs.account.ID)
	switch {
	case err != nil:
		s.addNoticeLocked(cs, "could not lock session: "+err.Error())
	case !got:
		s.addNoticeLocked(cs, "session lock is held by another ac")
	default:
		cs.locked = id
	}
}

func parseCtxPct(raw json.RawMessage) (float64, bool) {
	var v struct {
		Percentage *float64 `json:"percentage"`
		Used       *float64 `json:"used"`
		Total      *float64 `json:"total"`
	}
	if json.Unmarshal(raw, &v) != nil {
		return 0, false
	}
	switch {
	case v.Percentage != nil:
		p := *v.Percentage
		if p > 1 {
			p /= 100
		}
		return clamp01(p), true
	case v.Used != nil && v.Total != nil && *v.Total > 0:
		return clamp01(*v.Used / *v.Total), true
	}
	return 0, false
}

func clamp01(f float64) float64 {
	if f < 0 {
		return 0
	}
	if f > 1 {
		return 1
	}
	return f
}

func parseInitInfo(raw json.RawMessage) (models, commands []string) {
	var v struct {
		Models   []json.RawMessage `json:"models"`
		Commands []json.RawMessage `json:"commands"`
	}
	if json.Unmarshal(raw, &v) != nil {
		return nil, nil
	}
	names := func(in []json.RawMessage) []string {
		var out []string
		for _, r := range in {
			var str string
			if json.Unmarshal(r, &str) == nil && str != "" {
				out = append(out, str)
				continue
			}
			var obj struct {
				Value string `json:"value"`
				ID    string `json:"id"`
				Name  string `json:"name"`
			}
			if json.Unmarshal(r, &obj) != nil {
				continue
			}
			switch {
			case obj.Value != "":
				out = append(out, obj.Value)
			case obj.ID != "":
				out = append(out, obj.ID)
			case obj.Name != "":
				out = append(out, obj.Name)
			}
		}
		return out
	}
	return names(v.Models), names(v.Commands)
}

// ---- shutdown ----

// Close stops every controlled session, closes the runtimes and releases the
// locks. It is idempotent.
func (s *Store) Close() {
	s.mu.Lock()
	list := make([]*controlledSession, 0, len(s.controlSessions))
	for _, cs := range s.controlSessions {
		list = append(list, cs)
	}
	s.controlSessions = make(map[string]*controlledSession)
	s.mu.Unlock()

	var wg sync.WaitGroup
	for _, cs := range list {
		wg.Add(1)
		go func(cs *controlledSession) {
			defer wg.Done()
			ctx, cancel := context.WithTimeout(context.Background(), 4*time.Second)
			defer cancel()
			_ = cs.ctl.Stop(ctx)
			cs.ctl.Close()
			select {
			case <-cs.done:
			case <-time.After(time.Second):
			}
		}(cs)
	}
	wg.Wait()

	s.mu.Lock()
	for _, cs := range list {
		if cs.locked != "" {
			_ = ReleaseLock(s.dirs.Locks, cs.locked)
			cs.locked = ""
		}
	}
	s.mu.Unlock()
}
