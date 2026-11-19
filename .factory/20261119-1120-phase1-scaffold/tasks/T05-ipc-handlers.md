# T05 - Main-process IPC handlers (mock-backed stubs)

- Wave: 3
- Depends on: T01, T02
- Spec refs: R-03, R-17
- Tests: tests/main/ipcHandlers.test.ts

## Goal
Register a handler in the main process for every invoke channel in `@shared/ipc`, so the typed preload bridge works end to end. Phase 1 handlers return the mock snapshots or `{ ok: false, reason: 'not-implemented' }`. Phases 2-5 replace their bodies without changing the contract.

## Owned files
- create: src/main/ipc/handlers.ts
- modify: src/main/index.ts (only replace the `// T05:` marker with the import and the call)
- create: tests/main/ipcHandlers.test.ts

## Read-only context
- src/shared/ipc.ts, src/shared/types.ts, src/shared/mock/index.ts
- src/main/index.ts (T01)
- docs/spec.md, "Hard rules" 1 and 3 (no credentials, no silent edits)

## Notes
- `handlers.ts` exports the following:
  ```ts
  export type Handlers = { [C in InvokeChannel]: (...args: IpcInvokeMap[C]['args']) => Promise<IpcInvokeMap[C]['result']> | IpcInvokeMap[C]['result'] };
  export function createHandlers(deps?: { version?: string }): Handlers;
  export function registerIpcHandlers(ipc: Pick<IpcMain, 'handle'>, handlers?: Handlers): void;
  ```
  - `registerIpcHandlers` calls `ipc.handle(channel, (_event, ...args) => handlers[channel](...args))` for each of `INVOKE_CHANNELS`.
  - Import `IpcMain` as a type only, so the test runs without Electron.
- Phase 1 behaviour:
  - `team:get-snapshot` and `accounts:get-snapshot` return `structuredClone` of the mocks.
  - `accounts:set-default` returns `{ok: true}` (the in-memory mock default is updated in a module-level copy).
  - `accounts:start-sign-in` returns `{ok: false, reason: 'not-implemented'}`.
  - `accounts:check-sign-in` returns `{step: 'waiting'}`.
  - `accounts:cancel-sign-in` returns `{ok: true}`.
  - `agent:*`, `team:pause-all` and `worktree:open-in-editor` return `{ok: false, reason: 'not-implemented'}`. Do NOT spawn `code` yet; that is Phase 6 polish or Phase 5.
  - `app:get-version` returns `deps.version ?? '0.0.0'`. In index.ts, pass `app.getVersion()`.
- Validate args: a non-string id returns `{ok: false, reason: 'invalid-args'}`.
- No fs, network, child_process or credential access anywhere in this file (R-17).
- In index.ts, call `registerIpcHandlers(ipcMain, createHandlers({ version: app.getVersion() }))` inside `whenReady`, before the window is created.
- Test (node env):
  - Use a fake `{ handle: vi.fn() }`. Assert that it was called exactly once for each of `INVOKE_CHANNELS`.
  - Invoke the captured `team:get-snapshot` listener with `({}, )`. Assert it returns 6 agents, and that mutating the result does not change the next call.
  - Agent stop returns not-implemented.
  - An invalid arg returns invalid-args.
  - `app:get-version` returns the injected version.

## Acceptance commands
- npm test -- tests/main
- npm run typecheck
- npm run build

## Done when
- All acceptance commands pass.
- Only owned files changed.
