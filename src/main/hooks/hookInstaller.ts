import type { HooksPreview, HooksState } from '../../shared/types'
import { HOOK_EVENTS } from './hookPayload'

export const HOOK_MARKER = 'agent-console-hook'
export interface HookEntry { type: 'command'; command: string; args: string[]; async: true; timeout: number }
type Obj = Record<string, unknown>

const isObj = (v: unknown): v is Obj => typeof v === 'object' && v !== null && !Array.isArray(v)

export function buildHookEntry(nodePath: string, scriptPath: string): HookEntry {
  return { type: 'command', command: nodePath, args: [scriptPath], async: true, timeout: 10 }
}

export function isOurHook(h: unknown): boolean {
  if (!isObj(h) || h.type !== 'command') return false
  if (typeof h.command === 'string' && h.command.includes(HOOK_MARKER)) return true
  return Array.isArray(h.args) && typeof h.args[0] === 'string' && h.args[0].includes(HOOK_MARKER)
}

const groupHooks = (g: unknown): unknown[] => (isObj(g) && Array.isArray(g.hooks) ? g.hooks : [])
const sameEntry = (a: unknown, b: HookEntry): boolean => JSON.stringify(a) === JSON.stringify(b)

// Returns the groups of one event with our hooks removed; groups we emptied are dropped, others are kept as-is.
function stripOurs(groups: unknown[]): { groups: unknown[]; changed: boolean } {
  let changed = false
  const out: unknown[] = []
  for (const g of groups) {
    const hs = groupHooks(g)
    if (!hs.some(isOurHook)) { out.push(g); continue }
    changed = true
    const rest = hs.filter((h) => !isOurHook(h))
    if (rest.length > 0) out.push({ ...(g as Obj), hooks: rest })
  }
  return { groups: out, changed }
}

export function mergeHooks(settings: Obj, entry: HookEntry): Obj {
  const out: Obj = { ...settings }
  const hooks: Obj = isObj(settings.hooks) ? { ...settings.hooks } : {}
  for (const ev of HOOK_EVENTS) {
    const existing = Array.isArray(hooks[ev]) ? (hooks[ev] as unknown[]) : []
    hooks[ev] = [...stripOurs(existing).groups, { hooks: [{ ...entry, args: [...entry.args] }] }]
  }
  out.hooks = hooks
  return out
}

export function unmergeHooks(settings: Obj): Obj {
  if (!isObj(settings.hooks)) return { ...settings }
  const hooks: Obj = {}
  let changed = false
  for (const [ev, groups] of Object.entries(settings.hooks)) {
    if (!Array.isArray(groups)) { hooks[ev] = groups; continue }
    const r = stripOurs(groups)
    if (!r.changed) { hooks[ev] = groups; continue }
    changed = true
    if (r.groups.length > 0) hooks[ev] = r.groups
  }
  if (!changed) return { ...settings }
  const out: Obj = { ...settings }
  if (Object.keys(hooks).length > 0) out.hooks = hooks
  else delete out.hooks
  return out
}

export function hooksState(settings: Obj | null, entry: HookEntry | null): HooksState {
  if (!settings || !isObj(settings.hooks)) return 'not-installed'
  const hooks = settings.hooks
  let present = 0
  let outdated = false
  for (const ev of HOOK_EVENTS) {
    const groups = Array.isArray(hooks[ev]) ? (hooks[ev] as unknown[]) : []
    const ours = groups.flatMap(groupHooks).filter(isOurHook)
    if (ours.length === 0) continue
    present++
    if (entry && !(ours.length === 1 && sameEntry(ours[0], entry))) outdated = true
  }
  if (present === 0) return 'not-installed'
  if (outdated) return 'outdated'
  return present === HOOK_EVENTS.length ? 'installed' : 'partial'
}

export interface InstallerFs {
  readText(p: string): Promise<string | null>
  writeTextAtomic(p: string, text: string): Promise<void>
  mkdirp(p: string): Promise<void>
  remove(p: string): Promise<void>
}

const TTL_MS = 10 * 60 * 1000
const NO_FILE_MARKER = '{"agentConsoleBackup":"file did not exist"}'
const toText = (o: unknown): string => JSON.stringify(o, null, 2) + '\n'

interface Pending { root: string; settingsPath: string; backupPath: string; before: string | null; after: string | null; expiresAt: number }

function isNoFileMarker(bak: string | null): boolean {
  if (bak === null) return false
  try {
    const j: unknown = JSON.parse(bak)
    return isObj(j) && j.agentConsoleBackup === 'file did not exist'
  } catch {
    return false
  }
}

export function createHookInstaller(deps: { fs: InstallerFs; newId: () => string; platform: NodeJS.Platform }) {
  const { fs } = deps
  const pending = new Map<string, Pending>()

  const sepFor = (root: string): string => (root.includes('\\') && !root.includes('/') ? '\\' : '/')
  const dirFor = (root: string): string => root.replace(/[\\/]+$/, '') + sepFor(root) + '.claude'
  const settingsPathFor = (root: string): string => dirFor(root) + sepFor(root) + 'settings.local.json'

  async function read(root: string): Promise<{ text: string | null; json: Obj | null; error?: 'invalid-json' | 'not-object' }> {
    const text = await fs.readText(settingsPathFor(root))
    if (text === null) return { text: null, json: null }
    let parsed: unknown
    try { parsed = JSON.parse(text) } catch { return { text, json: null, error: 'invalid-json' } }
    if (!isObj(parsed)) return { text, json: null, error: 'not-object' }
    return { text, json: parsed }
  }

  async function preview(root: string, action: 'install' | 'uninstall', entry: HookEntry, scriptPath: string): Promise<HooksPreview | { ok: false; reason: string }> {
    const r = await read(root)
    if (r.error) return { ok: false, reason: r.error }
    const settingsPath = settingsPathFor(root)
    const backupPath = settingsPath + '.agent-console.bak'
    let after: string | null
    if (action === 'install') {
      if (hooksState(r.json, entry) === 'installed') return { ok: false, reason: 'nothing-to-do' }
      after = toText(mergeHooks(r.json ?? {}, entry))
    } else {
      if (!r.json || hooksState(r.json, null) === 'not-installed') return { ok: false, reason: 'nothing-to-do' }
      const rest = unmergeHooks(r.json)
      after = toText(rest)
      if (Object.keys(rest).length === 0 && isNoFileMarker(await fs.readText(backupPath))) after = null
    }
    const previewId = deps.newId()
    pending.set(previewId, { root, settingsPath, backupPath, before: r.text, after, expiresAt: Date.now() + TTL_MS })
    return {
      previewId, action, settingsPath, before: r.text, after, backupPath, scriptPath,
      notes: [
        `Settings file: ${settingsPath}`,
        `Backup of the original (written once): ${backupPath}`,
        `Hook script: ${scriptPath}`,
        'Hooks run asynchronously and never block Claude',
        'Restart running Claude sessions to load hooks'
      ]
    }
  }

  async function apply(previewId: string): Promise<{ ok: boolean; reason?: string }> {
    const p = pending.get(previewId)
    if (!p) return { ok: false, reason: 'expired' }
    pending.delete(previewId)
    if (Date.now() > p.expiresAt) return { ok: false, reason: 'expired' }
    const current = await fs.readText(p.settingsPath)
    if (current !== p.before) return { ok: false, reason: 'changed-since-preview' }
    try {
      await fs.mkdirp(dirFor(p.root))
      if ((await fs.readText(p.backupPath)) === null) await fs.writeTextAtomic(p.backupPath, p.before ?? NO_FILE_MARKER)
      if (p.after === null) await fs.remove(p.settingsPath)
      else await fs.writeTextAtomic(p.settingsPath, p.after)
      return { ok: true }
    } catch (e) {
      return { ok: false, reason: e instanceof Error ? e.message : 'write-failed' }
    }
  }

  return { settingsPathFor, read, preview, apply }
}
