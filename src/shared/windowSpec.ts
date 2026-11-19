import type { WindowOpenRequest, WindowSpec } from './types'

/** Secondary windows allowed at once (the main window is not counted). */
export const MAX_SECONDARY_WINDOWS = 8

const MAX_KEY = 1024
const isKeyString = (v: unknown): v is string => typeof v === 'string' && v.length > 0 && v.length <= MAX_KEY && !/[\u0000-\u001f]/.test(v)

/** Validates untrusted input (IPC or URL) into a WindowSpec; anything else is null. Extra fields are dropped. */
export function parseWindowSpec(v: unknown): WindowSpec | null {
  if (typeof v !== 'object' || v === null) return null
  const o = v as Record<string, unknown>
  if (o['kind'] === 'main') return { kind: 'main' }
  if (o['kind'] === 'project' && isKeyString(o['projectKey'])) return { kind: 'project', projectKey: o['projectKey'] }
  if (o['kind'] === 'chat' && isKeyString(o['projectKey']) && isKeyString(o['sessionRef']) && o['sessionRef'].includes('|')) {
    return { kind: 'chat', projectKey: o['projectKey'], sessionRef: o['sessionRef'] }
  }
  return null
}

/** Validates a window:open payload. */
export function parseOpenRequest(v: unknown): WindowOpenRequest | null {
  if (typeof v !== 'object' || v === null) return null
  const o = v as Record<string, unknown>
  const spec = parseWindowSpec(o['spec'])
  if (!spec) return null
  const at = o['at']
  if (at === undefined) return { spec }
  if (typeof at !== 'object' || at === null) return null
  const a = at as Record<string, unknown>
  const x = a['x']
  const y = a['y']
  if (typeof x !== 'number' || typeof y !== 'number' || !Number.isFinite(x) || !Number.isFinite(y)) return null
  if (Math.abs(x) > 100_000 || Math.abs(y) > 100_000) return null
  return { spec, at: { x: Math.round(x), y: Math.round(y) } }
}

/** Identity used for dedupe and placement memory. */
export function windowKey(spec: WindowSpec): string {
  switch (spec.kind) {
    case 'main':
      return 'main'
    case 'project':
      return `project:${spec.projectKey}`
    case 'chat':
      return `chat:${spec.projectKey}:${spec.sessionRef}`
  }
}

/** Query string (no leading '?') the renderer reads to pick its view. */
export function specToQuery(spec: WindowSpec): Record<string, string> {
  switch (spec.kind) {
    case 'main':
      return {}
    case 'project':
      return { kind: 'project', projectKey: spec.projectKey }
    case 'chat':
      return { kind: 'chat', projectKey: spec.projectKey, sessionRef: spec.sessionRef }
  }
}

/** Reads the spec from `location.search`; a missing or malformed query is the main window. */
export function specFromSearch(search: string): WindowSpec {
  const q = new URLSearchParams(search)
  const kind = q.get('kind')
  if (kind === null) return { kind: 'main' }
  return (
    parseWindowSpec({ kind, projectKey: q.get('projectKey') ?? undefined, sessionRef: q.get('sessionRef') ?? undefined }) ?? {
      kind: 'main'
    }
  )
}
