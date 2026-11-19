# T05 - Local hook server, endpoint handoff, hook script, runtime helpers

- Wave: 2
- Depends on: T01
- Spec refs: R-15, R-16, hard rule 4, spec "1. Hook events"
- Tests: tests/main/hooks/hookServer.test.ts, tests/main/hooks/hookScript.test.ts

## Goal
An HTTP server on 127.0.0.1 with a random port and a per-launch token, the endpoint handoff file, the bundled Node
hook script that forwards stdin to it, and helpers to find node and install the script into userData.

## Owned files
- create: src/main/hooks/hookServer.ts
- create: src/main/hooks/endpointFile.ts
- create: src/main/hooks/hookRuntime.ts
- create: resources/hook/agent-console-hook.cjs
- create: tests/main/hooks/hookServer.test.ts
- create: tests/main/hooks/hookScript.test.ts

## Read-only context
- plan.md Decision D11, Verified fact 11
- src/main/pty/claudeBinary.ts (PATH scanning style for resolveNode)
- src/shared/types.ts (HookEvent)

## Notes
hookServer.ts (node:http, node:crypto only):
```ts
export const TOKEN_HEADER = 'x-agent-console-token'
export const MAX_BODY = 1024 * 1024
export function createHookServer(deps: { parse: (body: unknown, receivedMs: number) => HookEvent | null; onEvent: (e: HookEvent) => void; endpoint: { write(info: { port: number; token: string; pid: number }): Promise<void>; remove(): Promise<void> }; token?: () => string; nowMs?: () => number; pid?: number }): {
  start(): Promise<{ port: number }>; stop(): Promise<void>; info(): { listening: boolean; port?: number }; stats(): { received: number; rejected: number; lastEventMs?: number }
}
```
Listen `127.0.0.1` port 0. Token = 32 random bytes hex. Request rules, in order: method POST and path `/hook` else
404/405; `Host` must be `127.0.0.1:<port>` (DNS-rebinding guard) else 403; token header compared with
`crypto.timingSafeEqual` (length-checked) else 401; body > MAX_BODY -> 413 and destroy; invalid JSON or parse null ->
400; else 204 then `onEvent` (exceptions in onEvent swallowed). Never log bodies or the token. `stop()` closes the
server and removes the endpoint file. Re-`start()` after stop gets a new token.

endpointFile.ts: `createEndpointFile(dir: string, fsImpl?)` -> `{ path, write(info), remove() }`; writes
`endpoint.json` via temp file + rename with mode 0o600; `remove` ignores ENOENT.

hookRuntime.ts:
```ts
export function resolveNode(o: { platform: NodeJS.Platform; env: Readonly<Record<string, string | undefined>>; exists: (p: string) => boolean }): string | null // absolute node(.exe) on PATH (case-insensitive Path on win32), never a .cmd
export async function ensureScriptInstalled(o: { srcPath: string; destDir: string; fs: { readText(p: string): Promise<string | null>; writeTextAtomic(p: string, t: string): Promise<void>; mkdirp(p: string): Promise<void> } }): Promise<string> // copies when content differs; returns dest path `<destDir>/agent-console-hook.cjs`
```

resources/hook/agent-console-hook.cjs (CommonJS, Node >= 18 builtins only, < 80 lines):
- Hard deadline: `setTimeout(() => process.exit(0), 1500).unref()`; every error path -> exit 0; no output on stdout/stderr.
- Read stdin up to 1 MiB (stop reading beyond), then read `path.join(__dirname, 'endpoint.json')`; missing/invalid -> exit 0 (app closed).
- `http.request({ host: '127.0.0.1', port, path: '/hook', method: 'POST', headers: { 'content-type': 'application/json', 'x-agent-console-token': token }, timeout: 1000 })`, write raw stdin, exit 0 on response/error/timeout.
- Never writes any file.

Tests: server - 204 + onEvent with a fake parse; 401 wrong/missing token; 403 bad Host; 404/405; 413 big body; 400
bad JSON; binds 127.0.0.1 only (`address().address`); endpoint written on start and removed on stop; a console spy
proves the body/token are never logged. Script - spawn `process.execPath <tmpdir copy of script>` with a JSON stdin:
(a) with a live test server + endpoint.json -> event received, exit 0, < 1.5 s; (b) no endpoint.json -> exit 0 fast;
(c) endpoint pointing at a closed port -> exit 0; (d) server that never responds -> exit 0 within ~1.6 s. Use
`os.tmpdir()` + `fs.mkdtemp`, clean up.

## Acceptance commands
- npm test -- tests/main/hooks/hookServer.test.ts tests/main/hooks/hookScript.test.ts
- npm run typecheck

## Done when
- All acceptance commands pass
- Only owned files changed
