import type { PtyInfo, PtyPurpose } from '@shared/types'

export interface PtyClaudeRequest { purpose: PtyPurpose; cwd: string; configDirAbs: string | null; args?: string[]; cols?: number; rows?: number; accountId?: string; configDirDisplay: string }
export type PtySpawnOutcome = { ok: true; id: string } | { ok: false; reason: 'pty-unavailable' | 'claude-not-found' | 'spawn-failed' }
export interface PtyManagerApi {
  available(): Promise<boolean>
  spawnClaude(req: PtyClaudeRequest): Promise<PtySpawnOutcome>
  write(id: string, data: string): boolean
  resize(id: string, cols: number, rows: number): boolean
  kill(id: string): boolean
  buffer(id: string): string
  list(): PtyInfo[]
  onData(cb: (id: string, data: string) => void): () => void
  onExit(cb: (id: string, exitCode: number) => void): () => void
  disposeAll(): void
}
