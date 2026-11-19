import type { AttentionItem, AttentionPrefs, AttentionSnapshot } from '../../shared/types'

export interface NotifierDeps {
  show: (n: { title: string; body: string; onClick: () => void }) => void
  flash: (on: boolean) => void
  overlay: (count: number) => void
  isFocusedAndVisible: () => boolean
  prefs: () => AttentionPrefs
  onFocusItem: (id: string) => void
}

const TOAST_GAP_MS = 3000
const MAX_SEEN = 1000
const DETAIL_MAX = 80

const clip = (s: string, max: number): string => (s.length <= max ? s : s.slice(0, max - 1) + '…')

const phrase = (i: AttentionItem): string => {
  const d = clip(i.detail, DETAIL_MAX)
  switch (i.kind) {
    case 'permission': return `needs permission: ${d}`
    case 'question': return `has a question: ${d}`
    case 'plan': return `waits for plan approval: ${d}`
    case 'api-error': return `hit an API error: ${d}`
    default: return `needs input: ${d}`
  }
}

/** Toasts / taskbar flash / overlay count for attention items. A toast carries text only, never an Allow action. */
export function createNotifier(deps: NotifierDeps): { update(s: AttentionSnapshot): void } {
  const seen = new Set<string>()
  let lastToastAt = -Infinity
  let lastFlash: boolean | undefined
  let lastOverlay: number | undefined

  const markSeen = (id: string): void => {
    seen.add(id)
    if (seen.size > MAX_SEEN) seen.delete(seen.values().next().value as string)
  }

  return {
    update(s) {
      const prefs = deps.prefs()
      const muted = new Set(prefs.mutedProjects)
      const focused = deps.isFocusedAndVisible()
      const now = Date.now()

      const redUnmuted = s.items.filter((i) => i.severity === 'blocked' && !muted.has(i.projectKey))
      const overlay = redUnmuted.length
      if (overlay !== lastOverlay) { lastOverlay = overlay; deps.overlay(overlay) }
      const flash = overlay > 0 && !focused && !prefs.dnd
      if (flash !== lastFlash) { lastFlash = flash; deps.flash(flash) }

      const fresh = s.items.filter((i) => !seen.has(i.id))
      if (fresh.length === 0) return
      const eligible = fresh.filter((i) => {
        if (i.severity !== 'blocked') return false
        if (i.kind === 'api-error' && !prefs.notifyErrors) return false
        if (muted.has(i.projectKey) || prefs.dnd) return false
        if (focused && prefs.viewedProjectKey === i.projectKey) return false
        return true
      })
      const eligibleIds = new Set(eligible.map((i) => i.id))
      // Items that can never toast are consumed now; eligible ones wait while rate limited.
      const limited = eligible.length > 0 && now - lastToastAt < TOAST_GAP_MS
      for (const i of fresh) if (!eligibleIds.has(i.id) || !limited) markSeen(i.id)
      if (eligible.length === 0 || limited) return

      lastToastAt = now
      const first = eligible[0]!
      const more = eligible.length - 1
      deps.show({
        title: 'Agent Console',
        body: `${first.projectName} - ${first.agentName} ${phrase(first)}${more > 0 ? ` (+${more} more)` : ''}`,
        onClick: () => deps.onFocusItem(first.id)
      })
    }
  }
}
