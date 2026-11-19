import { useEffect, useMemo, useRef, useState } from 'react'
import type { KeyboardEvent, MouseEvent } from 'react'
import type { AccountView, ProjectStatus } from '@shared/types'
import { formatTokens } from '@shared/format'
import { WarningIcon } from '../ui/Icons'
import { useAttentionStore } from '../../store/useAttentionStore'
import { useConsoleStore } from '../../store/useConsoleStore'
import { IDLE_AFTER_MS, mergeProjects, useRailStore } from '../../store/useRailStore'
import { useWindowsStore } from '../../store/useWindowsStore'
import './rail.css'

export type WorstState = 'needs' | 'running' | 'waiting' | 'none'

/** Worst state wins: needs-you > running > waiting (idle items count as waiting). */
export function worstState(p: ProjectStatus, idleItems = 0): WorstState {
  if (p.needsYou > 0) return 'needs'
  if (p.running > 0) return 'running'
  if (p.waiting > 0 || idleItems > 0) return 'waiting'
  return 'none'
}

const initials = (name: string): string => {
  const parts = name.split(/[\s._-]+/).filter(Boolean)
  const s = parts.length > 1 ? parts[0]!.charAt(0) + parts[1]!.charAt(0) : name.slice(0, 2)
  return (s || '?').toUpperCase()
}

const findAccount = (accounts: AccountView[], id: string): AccountView | undefined =>
  id === '' ? accounts.find((x) => x.isDefaultDir) : accounts.find((x) => x.id === id)

/** Order: pinned (pin order) first, then the rest by last activity; `frozen` keeps the previous order while hovered. */
export function orderProjects(
  projects: readonly ProjectStatus[],
  pins: readonly string[],
  frozen: readonly string[] | null
): ProjectStatus[] {
  const pinned = pins.map((k) => projects.find((p) => p.key === k)).filter((p): p is ProjectStatus => !!p)
  const pinSet = new Set(pinned.map((p) => p.key))
  const rest = projects.filter((p) => !pinSet.has(p.key))
  if (frozen) {
    const rank = new Map(frozen.map((k, i) => [k, i]))
    rest.sort((a, b) => (rank.get(a.key) ?? 1e9) - (rank.get(b.key) ?? 1e9) || b.lastActivityMs - a.lastActivityMs)
  } else rest.sort((a, b) => b.lastActivityMs - a.lastActivityMs)
  return [...pinned, ...rest]
}

interface MenuState {
  key: string
  x: number
  y: number
}

export interface ProjectRailProps {
  /** Icon strip (1100-1439 px). */
  compact?: boolean
  /** Rendered inside the narrow-window drawer: always expanded, no collapse button. */
  inDrawer?: boolean
  /** Called after the user picked a project (the drawer closes). */
  onPicked?: () => void
}

export function ProjectRail({ compact = false, inDrawer = false, onPicked }: ProjectRailProps): JSX.Element {
  const snapshot = useAttentionStore((s) => s.snapshot)
  const pins = useAttentionStore((s) => s.pins)
  const prefs = useAttentionStore((s) => s.prefs)
  const pin = useAttentionStore((s) => s.pin)
  const unpin = useAttentionStore((s) => s.unpin)
  const mute = useAttentionStore((s) => s.mute)
  const sessions = useConsoleStore((s) => s.sessions)
  const accounts = useConsoleStore((s) => s.accounts.accounts)
  const projectKey = useConsoleStore((s) => s.projectKey)
  const setProject = useConsoleStore((s) => s.setProject)
  const nowMs = useConsoleStore((s) => s.nowMs)
  const expandedPref = useRailStore((s) => s.expanded)
  const toggleExpanded = useRailStore((s) => s.toggleExpanded)
  const idleOpen = useRailStore((s) => s.idleOpen)
  const toggleIdle = useRailStore((s) => s.toggleIdle)
  const reduced =
    typeof window.matchMedia === 'function' && window.matchMedia('(prefers-reduced-motion: reduce)').matches

  useEffect(() => useAttentionStore.getState().init(), [])

  const expanded = inDrawer ? true : compact ? false : expandedPref
  const projects = useMemo(() => mergeProjects(snapshot.projects, sessions), [snapshot.projects, sessions])
  const idleItems = useMemo(() => {
    const m = new Map<string, number>()
    for (const i of snapshot.items) if (i.severity === 'idle') m.set(i.projectKey, (m.get(i.projectKey) ?? 0) + 1)
    return m
  }, [snapshot.items])

  // The order is frozen while the pointer is over the rail so rows do not jump under the cursor.
  const [hovered, setHovered] = useState(false)
  const frozen = useRef<string[] | null>(null)
  const live = orderProjects(projects, pins, null)
  if (hovered && frozen.current === null) frozen.current = live.map((p) => p.key)
  if (!hovered) frozen.current = null
  const ordered = hovered ? orderProjects(projects, pins, frozen.current) : live

  const isIdle = (p: ProjectStatus): boolean =>
    !pins.includes(p.key) &&
    p.key !== projectKey &&
    p.liveSessions === 0 &&
    p.needsYou === 0 &&
    p.running === 0 &&
    (idleItems.get(p.key) ?? 0) === 0 &&
    nowMs - p.lastActivityMs > IDLE_AFTER_MS
  const main = ordered.filter((p) => !isIdle(p))
  const idle = ordered.filter(isIdle)

  const [menu, setMenu] = useState<MenuState | null>(null)
  const menuRef = useRef<HTMLDivElement>(null)
  const menuOpener = useRef<HTMLElement | null>(null)
  useEffect(() => {
    if (!menu) return
    menuRef.current?.querySelector<HTMLElement>('[role="menuitem"]')?.focus()
    const onDown = (e: globalThis.MouseEvent): void => {
      if (menuRef.current && !menuRef.current.contains(e.target as Node)) setMenu(null)
    }
    document.addEventListener('mousedown', onDown)
    return () => document.removeEventListener('mousedown', onDown)
  }, [menu])
  const closeMenu = (): void => {
    setMenu(null)
    menuOpener.current?.focus()
  }

  const pick = (key: string): void => {
    if (key !== projectKey) setProject(key)
    onPicked?.()
  }
  const openMenuAt = (key: string, el: HTMLElement, x?: number, y?: number): void => {
    menuOpener.current = el
    const r = el.getBoundingClientRect()
    setMenu({ key, x: x ?? r.left + 8, y: y ?? r.bottom })
  }
  const onRowKey = (e: KeyboardEvent<HTMLButtonElement>, key: string): void => {
    if (e.key === 'ContextMenu' || (e.key === 'F10' && e.shiftKey)) {
      e.preventDefault()
      openMenuAt(key, e.currentTarget)
    }
  }
  const onMenuKey = (e: KeyboardEvent<HTMLDivElement>): void => {
    if (e.key === 'Escape') {
      e.preventDefault()
      e.stopPropagation()
      closeMenu()
      return
    }
    if (e.key === 'ArrowDown' || e.key === 'ArrowUp') {
      e.preventDefault()
      const items = Array.from(menuRef.current?.querySelectorAll<HTMLElement>('[role="menuitem"]') ?? [])
      const i = items.indexOf(document.activeElement as HTMLElement)
      items[(i + (e.key === 'ArrowDown' ? 1 : -1) + items.length) % items.length]?.focus()
    }
  }

  const row = (p: ProjectStatus): JSX.Element => {
    const idleN = idleItems.get(p.key) ?? 0
    const worst = worstState(p, idleN)
    const ids = p.accountIds.length > 0 ? p.accountIds : ['']
    const colors = ids.map((id) => findAccount(accounts, id)?.color ?? 'var(--ac-text-muted)')
    const stripe = p.mixedAccounts && colors.length > 1
    const partial = p.liveSessions > 0 && !p.hooksActive
    const pinned = pins.includes(p.key)
    const muted = prefs.mutedProjects.includes(p.key)
    const badgeText =
      worst === 'needs' ? String(p.needsYou) : worst === 'running' ? String(p.running) : String(p.waiting + idleN || '')
    const state =
      worst === 'needs'
        ? `${p.needsYou} need you`
        : worst === 'running'
          ? `${p.running} running`
          : worst === 'waiting'
            ? 'waiting for you'
            : 'quiet'
    const tip = `${p.name} - ${p.liveSessions} live session${p.liveSessions === 1 ? '' : 's'}, ${p.running} running, tokens today ${formatTokens(p.tokensToday)}${
      stripe ? ' - sessions use two accounts' : ''
    }${partial ? ' - hooks not installed: sub-agent prompts of external sessions are not detected' : ''}`
    return (
      <li key={p.key} className="ac-rail__li">
        <button
          type="button"
          className={`ac-rail__row${p.key === projectKey ? ' is-current' : ''}`}
          data-state={worst}
          aria-current={p.key === projectKey ? 'true' : undefined}
          aria-label={`${p.name}, ${state}${stripe ? ', two accounts' : ''}${partial ? ', hooks not installed' : ''}${pinned ? ', pinned' : ''}${muted ? ', muted' : ''}`}
          title={tip}
          onClick={() => pick(p.key)}
          onContextMenu={(e: MouseEvent<HTMLButtonElement>) => {
            e.preventDefault()
            openMenuAt(p.key, e.currentTarget, e.clientX, e.clientY)
          }}
          onKeyDown={(e) => onRowKey(e, p.key)}
        >
          <span
            className={`ac-rail__stripe${stripe ? ' is-split' : ''}`}
            style={{
              background: stripe ? `linear-gradient(${colors[0]} 50%, ${colors[1]} 50%)` : colors[0]
            }}
            data-testid={`stripe-${p.key}`}
          />
          <span className="ac-rail__avatar" aria-hidden="true">
            {initials(p.name)}
            {worst !== 'none' && (
              <span
                className={`ac-rail__badge ac-rail__badge--${worst}${reduced ? '' : ' is-animated'}`}
                data-testid={`badge-${p.key}`}
                data-state={worst}
              >
                {badgeText}
              </span>
            )}
            {partial && <span className="ac-rail__ring" data-testid={`partial-${p.key}`} />}
          </span>
          {expanded && (
            <span className="ac-rail__text">
              <span className="ac-rail__name">
                {p.name}
                {pinned && <span className="ac-rail__flag"> pinned</span>}
                {muted && <span className="ac-rail__flag"> muted</span>}
              </span>
              <span className="ac-rail__sub">
                {p.liveSessions} live · {formatTokens(p.tokensToday)} today
              </span>
            </span>
          )}
          {stripe && expanded && (
            <span className="ac-rail__warn" title="Sessions of this project use two different accounts">
              <WarningIcon size={14} color="var(--ac-warn-text)" />
            </span>
          )}
        </button>
      </li>
    )
  }

  const menuProject = menu ? projects.find((p) => p.key === menu.key) : undefined
  const openInEditor = (root: string): void => {
    void window.api?.worktree?.openInEditor?.(root)?.catch?.(() => undefined)
  }

  return (
    <nav
      className={`ac-rail${expanded ? ' is-expanded' : ' is-icons'}`}
      aria-label="Projects"
      onMouseEnter={() => setHovered(true)}
      onMouseLeave={() => setHovered(false)}
    >
      {!inDrawer && !compact && (
        <button
          type="button"
          className="ac-rail__toggle"
          aria-expanded={expanded}
          aria-label={expanded ? 'Collapse project rail' : 'Expand project rail'}
          onClick={toggleExpanded}
        >
          {expanded ? '‹' : '›'}
        </button>
      )}
      <ul className="ac-rail__list" role="list">
        {projects.length === 0 && expanded && <li className="ac-rail__empty">No projects yet</li>}
        {main.map(row)}
      </ul>
      {idle.length > 0 && (
        <div className="ac-rail__idle">
          <button
            type="button"
            className="ac-rail__idle-btn"
            aria-expanded={idleOpen}
            aria-label={`Idle (${idle.length})`}
            title={`Idle (${idle.length}): no live session, quiet for over 24 h`}
            onClick={toggleIdle}
          >
            {expanded ? `Idle (${idle.length})` : `…${idle.length}`}
          </button>
          {idleOpen && (
            <ul className="ac-rail__list" role="list">
              {idle.map(row)}
            </ul>
          )}
        </div>
      )}
      {menu && menuProject && (
        <div
          ref={menuRef}
          role="menu"
          aria-label={`${menuProject.name} actions`}
          className="ac-rail__menu"
          style={{ left: Math.max(0, menu.x), top: Math.max(0, menu.y) }}
          onKeyDown={onMenuKey}
        >
          <button
            type="button"
            role="menuitem"
            onClick={() => {
              if (pins.includes(menu.key)) unpin(menu.key)
              else pin(menu.key)
              closeMenu()
            }}
          >
            {pins.includes(menu.key) ? 'Unpin' : 'Pin'}
          </button>
          <button
            type="button"
            role="menuitem"
            onClick={() => {
              void useWindowsStore.getState().open({ kind: 'project', projectKey: menu.key })
              closeMenu()
            }}
          >
            Open in new window
          </button>
          <button
            type="button"
            role="menuitem"
            onClick={() => {
              mute(menu.key, !prefs.mutedProjects.includes(menu.key))
              closeMenu()
            }}
          >
            {prefs.mutedProjects.includes(menu.key) ? 'Unmute notifications' : 'Mute notifications'}
          </button>
          <button
            type="button"
            role="menuitem"
            disabled={!menuProject.root}
            onClick={() => {
              openInEditor(menuProject.root)
              closeMenu()
            }}
          >
            Open in VS Code
          </button>
        </div>
      )}
    </nav>
  )
}
