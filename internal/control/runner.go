package control

import (
	"context"
	"encoding/json"
	"errors"
	"fmt"
	"io"
	"os"
	"strings"
	"sync"
	"time"

	"github.com/longpl-1902/claude-ui/internal/core"
)

const (
	eventBuffer   = 256
	stderrKeep    = 4096
	maxQueuedType = 1024
)

type pendingReq struct {
	reqID       string
	input       json.RawMessage
	suggestions json.RawMessage
	card        core.Card
}

type reqResult struct {
	body json.RawMessage
	err  error
}

// run is one spawned child process.
type run struct {
	proc   Proc
	stdin  io.WriteCloser
	wmu    sync.Mutex // serialises writes to stdin
	exitCh chan struct{}

	errMu  sync.Mutex
	errBuf []byte
}

func (r *run) addStderr(p []byte) {
	r.errMu.Lock()
	defer r.errMu.Unlock()
	r.errBuf = append(r.errBuf, p...)
	if len(r.errBuf) > stderrKeep {
		r.errBuf = append([]byte(nil), r.errBuf[len(r.errBuf)-stderrKeep:]...)
	}
}

func (r *run) stderrText() string {
	r.errMu.Lock()
	defer r.errMu.Unlock()
	return strings.TrimSpace(stripANSI(string(r.errBuf)))
}

type queued struct {
	ev Event
	at time.Time
}

// Session drives one claude child process through the stream-json control
// protocol. New spawns nothing; the first Send does.
type Session struct {
	d Deps

	mu       sync.Mutex
	cond     *sync.Cond
	l        Launch
	state    State
	cur      *run
	info     Info
	turns    int
	reqN     int
	pending  map[string]*pendingReq
	order    []string
	waiters  map[string]chan reqResult
	internal map[string]ReqKind
	typing   string
	thinking bool
	stopping bool
	closed   bool

	queue    []queued
	pumpOn   bool
	closing  bool
	closeCh  chan struct{}
	pumpDone chan struct{}
	events   chan Event
}

// New creates a session. It spawns nothing and writes nothing.
func New(l Launch, d Deps) *Session {
	if d.Spawner == nil {
		d.Spawner = DefaultSpawner
	}
	if d.BaseEnv == nil {
		d.BaseEnv = os.Environ()
	}
	if d.Now == nil {
		d.Now = time.Now
	}
	if d.StopGrace <= 0 {
		d.StopGrace = 3 * time.Second
	}
	if d.RequestTimeout <= 0 {
		d.RequestTimeout = 10 * time.Second
	}
	if d.BatchWindow <= 0 {
		d.BatchWindow = 50 * time.Millisecond
	}
	if l.Mode == "" {
		l.Mode = "default"
	}
	s := &Session{
		d:        d,
		l:        l,
		state:    StateDraft,
		pending:  map[string]*pendingReq{},
		waiters:  map[string]chan reqResult{},
		internal: map[string]ReqKind{},
		closeCh:  make(chan struct{}),
		pumpDone: make(chan struct{}),
		events:   make(chan Event, eventBuffer),
	}
	s.cond = sync.NewCond(&s.mu)
	s.info = Info{State: StateDraft, SessionID: l.SessionID, Model: l.Model, Mode: l.Mode}
	return s
}

// Events returns the event channel. It is closed only by Close.
func (s *Session) Events() <-chan Event { return s.events }

// Info returns a snapshot.
func (s *Session) Info() Info {
	s.mu.Lock()
	defer s.mu.Unlock()
	i := s.info
	i.State = s.state
	i.Commands = append([]string(nil), s.info.Commands...)
	i.Models = append([]string(nil), s.info.Models...)
	return i
}

// Pending returns copies of the pending cards, oldest first.
func (s *Session) Pending() []core.Card {
	s.mu.Lock()
	defer s.mu.Unlock()
	out := make([]core.Card, 0, len(s.order))
	for _, id := range s.order {
		if p := s.pending[id]; p != nil {
			c := p.card
			c.Questions = append([]core.Question(nil), c.Questions...)
			out = append(out, c)
		}
	}
	return out
}

// ---- event queue (all under s.mu) ----

func (s *Session) emitLocked(ev Event) {
	if s.closing {
		return
	}
	now := time.Now()
	if ev.Kind == EvTyping && len(s.queue) > 0 {
		last := &s.queue[len(s.queue)-1]
		if last.ev.Kind == EvTyping && (now.Sub(last.at) < s.d.BatchWindow || len(s.queue) > maxQueuedType) {
			last.ev = ev
			return
		}
	}
	s.queue = append(s.queue, queued{ev: ev, at: now})
	if !s.pumpOn {
		s.pumpOn = true
		go s.pump()
	}
	s.cond.Signal()
}

func (s *Session) pump() {
	defer close(s.pumpDone)
	s.mu.Lock()
	for {
		for len(s.queue) == 0 && !s.closing {
			s.cond.Wait()
		}
		if len(s.queue) == 0 {
			break
		}
		head := s.queue[0]
		if head.ev.Kind == EvTyping && !s.closing {
			if wait := s.d.BatchWindow - time.Since(head.at); wait > 0 {
				s.mu.Unlock()
				select {
				case <-time.After(wait):
				case <-s.closeCh:
				}
				s.mu.Lock()
				continue
			}
		}
		s.queue = s.queue[1:]
		closing := s.closing
		s.mu.Unlock()
		if closing {
			select {
			case s.events <- head.ev:
			default:
			}
		} else {
			select {
			case s.events <- head.ev:
			case <-s.closeCh:
			}
		}
		s.mu.Lock()
	}
	s.mu.Unlock()
	close(s.events)
}

func (s *Session) setStateLocked(st State) {
	if s.state == st {
		return
	}
	s.state = st
	s.emitLocked(Event{Kind: EvState, Text: st.String()})
}

func (s *Session) noticeLocked(format string, a ...any) {
	s.emitLocked(Event{Kind: EvNotice, Text: fmt.Sprintf(format, a...)})
}

func (s *Session) nextIDLocked() string {
	s.reqN++
	return FormatRequestID(s.reqN)
}

func (s *Session) liveLocked() bool {
	return s.cur != nil && (s.state == StateStarting || s.state == StateIdle || s.state == StateBusy)
}

// ---- writing ----

// writeFrames writes frames in order. The caller may pass r.wmu already held.
func (s *Session) writeFrames(r *run, held bool, frames ...[]byte) error {
	if !held {
		r.wmu.Lock()
	}
	defer r.wmu.Unlock()
	for _, f := range frames {
		if _, err := r.stdin.Write(f); err != nil {
			s.mu.Lock()
			s.noticeLocked("write to claude failed: %v", err)
			s.mu.Unlock()
			return fmt.Errorf("write to claude: %w", err)
		}
	}
	return nil
}

// ---- spawn ----

// spawnLocked starts a child. Callers hold s.mu.
func (s *Session) spawnLocked() (*run, error) {
	l := s.l
	if s.state == StateExited && s.info.SessionID != "" {
		l.SessionID = s.info.SessionID
		l.Fork = false
		l.ResumeAt = ""
	}
	l.Mode = s.info.Mode
	if s.info.Model != "" {
		l.Model = s.info.Model
	}
	args, err := BuildArgs(l)
	if err != nil {
		return nil, err
	}
	env, err := ChildEnv(s.d.BaseEnv, l.ConfigDir)
	if err != nil {
		return nil, err
	}
	p, err := s.d.Spawner.Start(l.ClaudePath, args, env, l.Cwd)
	if err != nil {
		s.noticeLocked("could not start claude: %v", err)
		return nil, err
	}
	s.l = l
	r := &run{proc: p, stdin: p.Stdin(), exitCh: make(chan struct{})}
	s.cur = r
	s.turns = 0
	s.info.Spawns++
	s.info.PID = p.Pid()
	s.info.Error = ""
	s.stopping = false
	s.typing = ""
	s.thinking = false
	s.setStateLocked(StateStarting)

	outDone := make(chan struct{})
	errDone := make(chan struct{})
	go s.readStdout(r, p.Stdout(), outDone)
	go s.readStderr(r, p.Stderr(), errDone)
	go s.waitProc(r, outDone, errDone)
	return r, nil
}

func (s *Session) readStderr(r *run, rd io.Reader, done chan struct{}) {
	defer close(done)
	buf := make([]byte, 4096)
	for {
		n, err := rd.Read(buf)
		if n > 0 {
			r.addStderr(buf[:n])
		}
		if err != nil {
			return
		}
	}
}

func (s *Session) readStdout(r *run, rd io.Reader, done chan struct{}) {
	defer close(done)
	ls := NewLineSplitter(rd)
	dropped := 0
	for {
		line, err := ls.Next()
		if d := ls.Dropped(); d > dropped {
			s.mu.Lock()
			s.noticeLocked("dropped %d over-long line(s)", d-dropped)
			s.mu.Unlock()
			dropped = d
		}
		if err != nil {
			return
		}
		if len(line) == 0 {
			continue
		}
		s.handleLine(r, line)
	}
}

func (s *Session) waitProc(r *run, outDone, errDone chan struct{}) {
	code, _ := r.proc.Wait()
	for _, ch := range []chan struct{}{outDone, errDone} {
		select {
		case <-ch:
		case <-time.After(2 * time.Second):
		}
	}
	_ = r.proc.KillTree() // sweep stragglers

	errText := ""
	if code != 0 {
		errText = r.stderrText()
	}

	s.mu.Lock()
	s.pending = map[string]*pendingReq{}
	s.order = nil
	for id, w := range s.waiters {
		w <- reqResult{err: ErrNotLive}
		delete(s.waiters, id)
	}
	s.internal = map[string]ReqKind{}
	s.turns = 0
	s.typing = ""
	s.thinking = false
	s.info.PID = 0
	if code != 0 {
		s.info.Error = errText
	}
	s.setStateLocked(StateExited)
	s.emitLocked(Event{Kind: EvExited, Code: code, Error: errText})
	s.mu.Unlock()
	close(r.exitCh)
}

// ---- Send ----

func (s *Session) Send(text string) error {
	if strings.TrimSpace(text) == "" {
		return errors.New("empty message")
	}
	s.mu.Lock()
	if s.closed {
		s.mu.Unlock()
		return ErrClosed
	}
	if s.state == StateStopping {
		s.mu.Unlock()
		return errors.New("session is stopping")
	}
	var frames [][]byte
	r := s.cur
	if s.state == StateDraft || s.state == StateExited || r == nil {
		nr, err := s.spawnLocked()
		if err != nil {
			s.mu.Unlock()
			return err
		}
		r = nr
		id := s.nextIDLocked()
		s.internal[id] = ReqInitialize
		frames = append(frames, EncodeRequest(id, ReqInitialize, nil))
	}
	frames = append(frames, EncodeUserTurn(text))
	s.turns++
	s.setStateLocked(StateBusy)
	r.wmu.Lock()
	s.mu.Unlock()

	if err := s.writeFrames(r, true, frames...); err != nil {
		s.mu.Lock()
		if s.cur == r && s.turns > 0 {
			s.turns--
			if s.turns == 0 && s.state == StateBusy {
				s.setStateLocked(StateIdle)
			}
		}
		s.mu.Unlock()
		return err
	}
	return nil
}

// ---- stdout handling ----

type rawPeek struct {
	Type      string          `json:"type"`
	Subtype   string          `json:"subtype"`
	RequestID string          `json:"request_id"`
	Parent    json.RawMessage `json:"parent_tool_use_id"`
	Event     struct {
		Type         string `json:"type"`
		ContentBlock struct {
			Type string `json:"type"`
		} `json:"content_block"`
	} `json:"event"`
}

func (p rawPeek) isSub() bool {
	t := strings.TrimSpace(string(p.Parent))
	return t != "" && t != "null" && t != `""`
}

func (s *Session) handleLine(r *run, line []byte) {
	var pk rawPeek
	_ = json.Unmarshal(line, &pk)

	if pk.Type == "control_cancel_request" {
		s.mu.Lock()
		if s.cur == r {
			s.removeCardLocked(pk.RequestID)
		}
		s.mu.Unlock()
		return
	}

	m, ok := ParseOutputLine(line)
	if !ok {
		return
	}

	var out [][]byte // frames to write after unlocking
	s.mu.Lock()
	if s.cur != r {
		s.mu.Unlock()
		return
	}
	switch m.Kind {
	case MsgInit:
		if m.SessionID != "" {
			s.info.SessionID = m.SessionID
		}
		if m.Model != "" {
			s.info.Model = m.Model
		}
		s.info.Version = m.Version
		s.info.Commands = m.Commands
		s.emitLocked(Event{Kind: EvInit, SessionID: m.SessionID, Model: m.Model, Version: m.Version, Commands: m.Commands})
		// Allowed by R-19: the user already sent a prompt to get here.
		out = append(out, s.internalReqLocked(ReqMcpStatus))

	case MsgStatus:
		if m.StatusText == "requesting" && s.state == StateIdle {
			s.setStateLocked(StateBusy)
		}

	case MsgStreamEvent:
		if pk.isSub() {
			break
		}
		switch pk.Event.Type {
		case "message_start":
			s.typing = ""
		case "content_block_start":
			bt := pk.Event.ContentBlock.Type
			s.setThinkingLocked(bt == "thinking" || bt == "redacted_thinking")
		case "content_block_delta":
			if m.DeltaType == "text_delta" {
				s.typing += m.DeltaText
				s.emitLocked(Event{Kind: EvTyping, Text: s.typing})
			}
		case "message_stop":
			s.setThinkingLocked(false)
		}

	case MsgAssistant:
		if pk.isSub() {
			break
		}
		s.setThinkingLocked(false)
		s.typing = ""
		s.emitLocked(Event{Kind: EvTypingClear})

	case MsgResult:
		s.setThinkingLocked(false)
		s.typing = ""
		s.emitLocked(Event{Kind: EvTypingClear})
		if s.turns > 0 {
			s.turns--
		}
		s.info.CostUSD += m.Cost
		if s.turns == 0 && (s.state == StateBusy || s.state == StateStarting) {
			s.setStateLocked(StateIdle)
		}
		s.emitLocked(Event{Kind: EvTurnEnd, Cost: m.Cost, Usage: m.Usage, Text: m.StopReason})
		if s.state != StateStopping {
			out = append(out, s.internalReqLocked(ReqGetContextUsage))
		}

	case MsgCanUseTool:
		card := CardFromMsg(m, s.d.Now())
		if _, dup := s.pending[m.RequestID]; !dup {
			s.order = append(s.order, m.RequestID)
		}
		s.pending[m.RequestID] = &pendingReq{reqID: m.RequestID, input: m.Input, suggestions: m.Suggestions, card: card}
		c := card
		s.emitLocked(Event{Kind: EvPermission, Card: &c, RequestID: m.RequestID})

	case MsgControlRequest:
		out = append(out, EncodeUnsupported(m.RequestID, m.ReqSubtype))
		s.noticeLocked("unsupported control request %q answered", m.ReqSubtype)

	case MsgControlResponse:
		s.settleLocked(m)
	}
	s.mu.Unlock()

	if len(out) > 0 {
		_ = s.writeFrames(r, false, out...)
	}
}

func (s *Session) setThinkingLocked(v bool) {
	if s.thinking == v {
		return
	}
	s.thinking = v
	s.emitLocked(Event{Kind: EvThinking, Thinking: v})
}

func (s *Session) internalReqLocked(k ReqKind) []byte {
	id := s.nextIDLocked()
	s.internal[id] = k
	return EncodeRequest(id, k, nil)
}

func (s *Session) removeCardLocked(id string) {
	if _, ok := s.pending[id]; !ok {
		return
	}
	delete(s.pending, id)
	for i, o := range s.order {
		if o == id {
			s.order = append(s.order[:i], s.order[i+1:]...)
			break
		}
	}
	s.emitLocked(Event{Kind: EvPermissionResolved, RequestID: id})
}

func (s *Session) settleLocked(m Msg) {
	id := m.CorrelationID
	if w, ok := s.waiters[id]; ok {
		delete(s.waiters, id)
		if m.OK {
			w <- reqResult{body: m.ResponseBody}
		} else {
			w <- reqResult{err: fmt.Errorf("control request failed: %s", m.Error)}
		}
		return
	}
	kind, ok := s.internal[id]
	if !ok {
		return
	}
	delete(s.internal, id)
	if !m.OK {
		s.noticeLocked("%s failed: %s", kind, m.Error)
		return
	}
	switch kind {
	case ReqGetContextUsage:
		if v, ok := parseCtxPct(m.ResponseBody); ok {
			s.info.CtxPct = v
		}
	case ReqInitialize:
		cmds, models := parseInitBody(m.ResponseBody)
		if len(cmds) > 0 {
			s.info.Commands = cmds
		}
		if len(models) > 0 {
			s.info.Models = models
		}
	}
	s.emitLocked(Event{Kind: EvDetails, Text: string(kind), Info: m.ResponseBody})
}

func parseCtxPct(body json.RawMessage) (float64, bool) {
	var b struct {
		Percentage  *float64 `json:"percentage"`
		TotalTokens float64  `json:"totalTokens"`
		MaxTokens   float64  `json:"maxTokens"`
	}
	if json.Unmarshal(body, &b) != nil {
		return 0, false
	}
	var v float64
	switch {
	case b.MaxTokens > 0:
		v = b.TotalTokens / b.MaxTokens
	case b.Percentage != nil:
		v = *b.Percentage / 100
	default:
		return 0, false
	}
	if v < 0 {
		v = 0
	}
	if v > 1 {
		v = 1
	}
	return v, true
}

// parseInitBody tolerates strings or objects in commands/models.
func parseInitBody(body json.RawMessage) (cmds, models []string) {
	var b struct {
		Commands []json.RawMessage `json:"commands"`
		Models   []json.RawMessage `json:"models"`
	}
	if json.Unmarshal(body, &b) != nil {
		return nil, nil
	}
	pick := func(raw []json.RawMessage, keys ...string) []string {
		var out []string
		for _, r := range raw {
			var str string
			if json.Unmarshal(r, &str) == nil {
				out = append(out, str)
				continue
			}
			var o map[string]any
			if json.Unmarshal(r, &o) != nil {
				continue
			}
			for _, k := range keys {
				if v, _ := o[k].(string); v != "" {
					out = append(out, v)
					break
				}
			}
		}
		return out
	}
	return pick(b.Commands, "name"), pick(b.Models, "value", "id", "name")
}

// ---- Answer / Interrupt ----

func (s *Session) Answer(reqID string, a Answer) error {
	s.mu.Lock()
	p, ok := s.pending[reqID]
	if !ok {
		s.mu.Unlock()
		return ErrUnknownRequest
	}
	r := s.cur
	s.removeCardLocked(reqID)
	s.mu.Unlock()
	if r == nil {
		return ErrNotLive
	}

	var frame []byte
	switch {
	case !a.Allow:
		msg := a.Message
		if msg == "" {
			if p.card.Kind == core.CardPlan {
				msg = "User rejected the plan"
			} else {
				msg = "Denied by user"
			}
		}
		frame = EncodeDeny(reqID, msg)
	case p.card.Kind == core.CardQuestion:
		frame = EncodeAllowWithAnswers(reqID, p.input, a.Answers)
	default:
		var rules json.RawMessage
		if a.ForSession {
			rules = SessionScopedSuggestions(p.suggestions)
		}
		frame = EncodeAllow(reqID, p.input, rules)
	}
	return s.writeFrames(r, false, frame)
}

// denyAllLocked removes every pending card and returns deny frames.
func (s *Session) denyAllLocked(msg string) [][]byte {
	var frames [][]byte
	ids := append([]string(nil), s.order...)
	for _, id := range ids {
		frames = append(frames, EncodeDeny(id, msg))
		s.removeCardLocked(id)
	}
	return frames
}

func (s *Session) Interrupt() error {
	s.mu.Lock()
	if s.cur == nil || (s.state != StateBusy && s.state != StateStarting) {
		s.mu.Unlock()
		return ErrNotBusy
	}
	r := s.cur
	frames := s.denyAllLocked("Interrupted by user")
	frames = append(frames, EncodeRequest(s.nextIDLocked(), ReqInterrupt, nil))
	s.typing = ""
	s.emitLocked(Event{Kind: EvTypingClear})
	s.mu.Unlock()
	return s.writeFrames(r, false, frames...)
}

// ---- model / mode / generic request ----

func (s *Session) SetModel(model string) error {
	if strings.HasPrefix(model, "-") || !modelRe.MatchString(model) {
		return fmt.Errorf("invalid model: %q", model)
	}
	s.mu.Lock()
	live := s.liveLocked()
	if !live {
		s.info.Model = model
		s.l.Model = model
		s.mu.Unlock()
		return nil
	}
	s.mu.Unlock()
	if _, err := s.Request(context.Background(), ReqSetModel, map[string]any{"model": model}); err != nil {
		return err
	}
	s.mu.Lock()
	s.info.Model = model
	s.l.Model = model
	s.mu.Unlock()
	return nil
}

func (s *Session) SetMode(mode string) error {
	if !modeSet[mode] {
		return fmt.Errorf("invalid mode: %q", mode)
	}
	s.mu.Lock()
	live := s.liveLocked()
	if !live {
		s.info.Mode = mode
		s.l.Mode = mode
		s.mu.Unlock()
		return nil
	}
	s.mu.Unlock()
	if _, err := s.Request(context.Background(), ReqSetPermissionMode, map[string]any{"mode": mode}); err != nil {
		return err
	}
	s.mu.Lock()
	s.info.Mode = mode
	s.l.Mode = mode
	s.mu.Unlock()
	return nil
}

func (s *Session) Request(ctx context.Context, kind ReqKind, params map[string]any) (json.RawMessage, error) {
	s.mu.Lock()
	if s.closed {
		s.mu.Unlock()
		return nil, ErrClosed
	}
	if !s.liveLocked() {
		s.mu.Unlock()
		return nil, ErrNotLive
	}
	r := s.cur
	id := s.nextIDLocked()
	ch := make(chan reqResult, 1)
	s.waiters[id] = ch
	timeout := s.d.RequestTimeout
	s.mu.Unlock()

	forget := func() {
		s.mu.Lock()
		delete(s.waiters, id)
		s.mu.Unlock()
	}
	if err := s.writeFrames(r, false, EncodeRequest(id, kind, params)); err != nil {
		forget()
		return nil, err
	}
	timer := time.NewTimer(timeout)
	defer timer.Stop()
	select {
	case res := <-ch:
		return res.body, res.err
	case <-ctx.Done():
		forget()
		return nil, ctx.Err()
	case <-timer.C:
		forget()
		return nil, fmt.Errorf("request %s timed out after %s", kind, timeout)
	}
}

// ---- Stop / Close ----

func (s *Session) Stop(ctx context.Context) error {
	s.mu.Lock()
	switch {
	case s.state == StateDraft:
		s.setStateLocked(StateExited)
		s.mu.Unlock()
		return nil
	case s.cur == nil || s.state == StateExited:
		s.mu.Unlock()
		return nil
	}
	r := s.cur
	var frames [][]byte
	if !s.stopping {
		s.stopping = true
		wasBusy := s.state == StateBusy || s.state == StateStarting
		s.setStateLocked(StateStopping)
		if len(s.order) > 0 {
			s.noticeLocked("denied %d pending request(s): session stopped", len(s.order))
		}
		frames = s.denyAllLocked("Stopped by user")
		if wasBusy {
			frames = append(frames, EncodeRequest(s.nextIDLocked(), ReqInterrupt, nil))
		}
	}
	grace := s.d.StopGrace
	s.mu.Unlock()

	if len(frames) > 0 {
		_ = s.writeFrames(r, false, frames...)
	}
	_ = r.stdin.Close()

	if dl, ok := ctx.Deadline(); ok {
		if rem := time.Until(dl); rem < grace {
			grace = rem
		}
	}
	if grace < 0 {
		grace = 0
	}
	timer := time.NewTimer(grace)
	defer timer.Stop()
	select {
	case <-r.exitCh:
		return nil
	case <-timer.C:
	case <-ctx.Done():
	}
	_ = r.proc.KillTree()
	select {
	case <-r.exitCh:
		return nil
	case <-time.After(5 * time.Second):
		return errors.New("claude did not exit after kill")
	}
}

// Close stops the session (3 s) and closes Events().
func (s *Session) Close() {
	s.mu.Lock()
	if s.closed {
		s.mu.Unlock()
		return
	}
	s.mu.Unlock()

	ctx, cancel := context.WithTimeout(context.Background(), 3*time.Second)
	_ = s.Stop(ctx)
	cancel()

	s.mu.Lock()
	if s.closed {
		s.mu.Unlock()
		return
	}
	s.closed = true
	s.closing = true
	close(s.closeCh)
	on := s.pumpOn
	s.cond.Broadcast()
	s.mu.Unlock()
	if !on {
		close(s.events)
		return
	}
	<-s.pumpDone
}
