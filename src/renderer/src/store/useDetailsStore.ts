import { create } from 'zustand'
import type {
  ControlDetails,
  ControlStartResult,
  Effort,
  FileSuggestion,
  ImageAttachment,
  OkResult,
  RewindPreview,
  SlashCommandInfo
} from '@shared/types'

const NO_API: OkResult = { ok: false, reason: 'unavailable' }
const SUGGEST_DEBOUNCE_MS = 120

const BUILTIN_DEFS: [string, string][] = [
  ['help', 'Show help and available commands'],
  ['clear', 'Clear the conversation'],
  ['compact', 'Compact the conversation'],
  ['model', 'Switch model'],
  ['cost', 'Show cost'],
  ['context', 'Show context usage'],
  ['mcp', 'Manage MCP servers'],
  ['agents', 'Manage agents'],
  ['memory', 'Edit memory files'],
  ['review', 'Review a pull request'],
  ['init', 'Initialize CLAUDE.md']
]
export const BUILTIN_COMMANDS: SlashCommandInfo[] = BUILTIN_DEFS.map(([name, description]) => ({
  name,
  description,
  source: 'builtin' as const
}))

export interface DetailsStoreState {
  byControl: Record<string, ControlDetails>
  init(): () => void
  load(id: string): Promise<ControlDetails | null>
  refreshContext(id: string): Promise<OkResult>
  mcpToggle(id: string, name: string, on: boolean): Promise<OkResult>
  mcpReconnect(id: string, name: string): Promise<OkResult>
  setEffort(id: string, effort: Effort | null): Promise<OkResult>
  setOutputStyle(id: string, style: string | null): Promise<OkResult>
  rename(id: string, title: string): Promise<OkResult>
  getPlan(id: string): Promise<{ exists: boolean; content?: string }>
  rewindPreview(id: string, uuid: string): Promise<RewindPreview>
  rewind(id: string, uuid: string): Promise<OkResult>
  forkAt(id: string, uuid: string): Promise<ControlStartResult>
  fileSuggestions(id: string | null, cwd: string, query: string): Promise<FileSuggestion[]>
  /** Explicit user send with images (R-19): only ever called from a user action. */
  sendRich(id: string, text: string, images: ImageAttachment[]): Promise<OkResult>
  applyDetails(d: ControlDetails): void
}

type Api = NonNullable<Window['api']>
type ControlApi = Api['control']

async function call<T>(fn: (c: ControlApi) => Promise<T>, fallback: T): Promise<T> {
  const api = typeof window === 'undefined' ? undefined : window.api
  if (!api?.control) return fallback
  try {
    return await fn(api.control)
  } catch {
    return fallback
  }
}

let suggestTimer: ReturnType<typeof setTimeout> | undefined
let suggestPending: ((r: FileSuggestion[]) => void) | undefined
let suggestSeq = 0

export const useDetailsStore = create<DetailsStoreState>((set, get) => ({
  byControl: {},

  init() {
    const api = typeof window === 'undefined' ? undefined : window.api
    if (!api?.control) return () => {}
    return api.control.onDetails((d) => get().applyDetails(d))
  },

  applyDetails(d) {
    set((s) => ({ byControl: { ...s.byControl, [d.controlId]: d } }))
  },

  async load(id) {
    const d = await call((c) => c.details(id), null)
    if (d) get().applyDetails(d)
    return d
  },

  refreshContext: (id) => call((c) => c.refreshContext(id), NO_API),
  mcpToggle: (id, name, on) => call((c) => c.mcpToggle(id, name, on), NO_API),
  mcpReconnect: (id, name) => call((c) => c.mcpReconnect(id, name), NO_API),
  setEffort: (id, e) => call((c) => c.setEffort(id, e), NO_API),
  setOutputStyle: (id, st) => call((c) => c.setOutputStyle(id, st), NO_API),
  rename: (id, title) => call((c) => c.rename(id, title), NO_API),
  getPlan: (id) => call((c) => c.getPlan(id), { exists: false }),
  rewindPreview: (id, uuid) =>
    call((c) => c.rewindPreview(id, uuid), {
      canRewind: false,
      filesChanged: [],
      insertions: 0,
      deletions: 0,
      error: 'unavailable'
    }),
  rewind: (id, uuid) => call((c) => c.rewind(id, uuid), NO_API),
  forkAt: (id, uuid) => call((c) => c.forkAt(id, uuid), { ok: false, reason: 'invalid-args' } as ControlStartResult),
  sendRich: (id, text, images) => call((c) => c.sendRich(id, text, images), NO_API),

  fileSuggestions(id, cwd, query) {
    // Debounced, latest wins: a superseded call resolves with [] without hitting IPC.
    if (suggestTimer) clearTimeout(suggestTimer)
    suggestPending?.([])
    const seq = ++suggestSeq
    return new Promise<FileSuggestion[]>((resolve) => {
      suggestPending = resolve
      suggestTimer = setTimeout(() => {
        suggestTimer = undefined
        suggestPending = undefined
        void call((c) => c.fileSuggestions(id, cwd, query), [] as FileSuggestion[]).then((r) =>
          resolve(seq === suggestSeq ? r : [])
        )
      }, SUGGEST_DEBOUNCE_MS)
    })
  }
}))

/** Details commands merged with the builtin fallback list, deduped by name (details win). */
export const selectCommands =
  (id: string | undefined) =>
  (s: DetailsStoreState): SlashCommandInfo[] => {
    const d = id ? s.byControl[id] : undefined
    if (!d) return BUILTIN_COMMANDS
    const seen = new Set<string>()
    const out: SlashCommandInfo[] = []
    for (const c of [...d.commands, ...BUILTIN_COMMANDS]) {
      if (seen.has(c.name)) continue
      seen.add(c.name)
      out.push(c)
    }
    return out
  }
