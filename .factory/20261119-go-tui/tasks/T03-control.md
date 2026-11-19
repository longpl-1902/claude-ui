# T03 — stream-json control (wave 1)

## Goal
Everything needed to run one controlled `claude -p` stream-json child: protocol parse/encode,
args, child env, binary resolution, Windows process handling, and the session state machine.
Standard library + `golang.org/x/sys/windows` only.

## Owns
`internal/control/**` (including `testdata/` and the fake-claude helper).

## Reference
`src/main/control/protocol.ts`, `args.ts`, `controlSession.ts`, `controlManager.ts` (batching
only), `processTree.ts`, `src/main/pty/childEnv.ts`, `claudeBinary.ts`; tests
`tests/main/control/{protocol,protocolV2,args,controlSession,controlV2,controlManager,processTree}.test.ts`,
`tests/main/control/harness.ts`, `tests/main/pty/{childEnv,claudeBinary}.test.ts`.

## Steps
1. `protocol.go`: `ParseOutputLine([]byte) (Msg, bool)` for all `OutMsg` variants (init incl.
   `tools`/`mcp_servers` extras, status, stream_event message_start/content_block_start/
   delta text|thinking|input_json (never signature)/message_stop, assistant (aborted, text cap
   4000), user vs user-echo, result (cost, denials, stop reason, usage, duration), can_use_tool
   (display name fallback, desc/reason cap 500, ANSI strip, blocked_path, suggestions),
   other control_request, control_response (body), commands_changed). Encoders:
   `EncodeUserTurn`, `EncodeAllow(reqID, input, sessionRules)`, `EncodeAllowWithAnswers`,
   `EncodeDeny`, `EncodeUnsupported`, `EncodeRequest(reqID, Req)` for initialize, interrupt,
   set_model, set_permission_mode, mcp_status, get_context_usage, rewind_files,
   rename_session (others may be added later). `SessionScopedSuggestions`. Response parsers:
   initialize (commands, agents, models, output styles), mcp_status, context usage, rewind.
   `LineSplitter` (io.Reader → lines, CRLF, max 16 MiB, drop counter). Never panics.
2. `args.go`: `BuildArgs(Launch) ([]string, error)` — exact flag order of `args.ts`; regexes for
   model / session id / effort; modes `default|acceptEdits|plan|auto|dontAsk` only.
3. `env.go`: `ChildEnv(base []string, configDirAbs string) ([]string, error)` — strip list from
   spec §3.5 (case-insensitive on Windows), absolute check, set `CLAUDE_CONFIG_DIR`,
   `CLAUDE_CODE_ENABLE_SDK_FILE_CHECKPOINTING=1`, default `TERM`/`COLORTERM`.
4. `binary.go`: `ResolveClaude(override string, env []string, home string, exists func(string) bool) (path string, err error)`
   — exe on PATH; npm `claude.cmd` → sibling `node_modules\@anthropic-ai\claude-code\bin\claude.exe`;
   `~/.local/bin/claude.exe`; a bare `.cmd` is an error ("set claudePath"), never cmd.exe.
5. `proc_windows.go` / `proc_other.go`: `Start(path, args, env, cwd) (Proc, error)` with
   `CREATE_NO_WINDOW|CREATE_NEW_PROCESS_GROUP`, `HideWindow`, pipes, a job object with
   `JOB_OBJECT_LIMIT_KILL_ON_JOB_CLOSE` (assign right after start), `Proc.KillTree()` =
   `TerminateJobObject`. Interface `Spawner` so tests inject a fake.
6. `session.go`: `New(l Launch, d Deps) *Session` (draft; nothing spawned). Methods `Send(text)`,
   `Answer(reqID, Answer)`, `Interrupt()`, `SetModel`, `SetMode`, `Request(ctx, Req) (json.RawMessage, error)`
   (10 s timeout, correlated by `ac-<n>` ids), `Stop(ctx)`, `Info() Info`, `Events() <-chan Event`
   (buffered; consecutive typing events coalesced by a 50 ms batcher). Port the state machine
   and R-19 ordering from `controlSession.ts`: on the first `Send` spawn → write `initialize`
   → write the user frame; `mcp_status` after `init`; `get_context_usage` after each `result`
   while live; respawn after exit with `--resume <sessionId>`; stop sequence (deny pending,
   interrupt if busy, close stdin, 3 s then KillTree); stderr ring 4 KiB shown on non-zero exit.
   All shared state behind one mutex; goroutines: stdout reader, stderr reader, waiter, batcher.
   `Event` kinds: `State, Init(sessionID, model, version, commands), Typing(text), TypingClear,
   Thinking(bool), Permission(Card data), PermissionResolved(reqID), TurnEnd(result, cost, usage),
   Notice(level,text), Details(models, commands, ctx, mcp), Exited(code, err)`.
7. Fake claude: in `fake_test.go` a `TestMain` that, when `AC_FAKE_CLAUDE=<script file>` is set,
   acts as the CLI: reads stdin frames, writes scripted stdout lines (`testdata/*.script`:
   `expect <json-subset>` / `emit <line>` / `exit <code>`), fails with a non-zero exit when an
   expectation is not met. Tests spawn `os.Args[0]` through the real `Spawner`.

## Tests to port / write
- All cases of `protocol.test.ts`, `protocolV2.test.ts`, `args.test.ts` (incl. "never contains
  dangerous flags" with a fuzz-ish table), `childEnv.test.ts`, `claudeBinary.test.ts`,
  `processTree` (taskkill no longer used: test job-object kill via the fake child spawning a
  grandchild that must die).
- `controlSession.test.ts` / `controlV2.test.ts` behaviour with a fake `Spawner`: draft never
  spawns; **no frame is written before the first Send**; initialize precedes the user frame;
  permission round-trip allow / allow-for-session (destination forced to session) / deny /
  AskUserQuestion answers; interrupt only when busy; stop sequence and grace kill; exit with
  stderr; respawn with `--resume`; request timeout; unknown control_request → unsupported.
- One end-to-end test with the re-exec fake claude over real pipes.

## Acceptance
`go vet ./...` · `go test -race ./internal/control/...` · `go build ./...` · `gofmt -l .` empty.
No real `claude` is executed.
