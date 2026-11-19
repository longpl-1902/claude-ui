import { useEffect, useMemo, useRef, useState } from 'react'
import type { KeyboardEvent } from 'react'
import { Dialog } from '../ui/Dialog'
import { sessionProjectKey, useConsoleStore } from '../../store/useConsoleStore'
import { useSwitcherStore } from '../../store/useSwitcherStore'
import { mergeProjects } from '../../store/useRailStore'
import { useAttentionStore } from '../../store/useAttentionStore'
import { useWindowsStore } from '../../store/useWindowsStore'
import './rail.css'

interface Entry {
  id: string
  kind: 'project' | 'session' | 'window'
  label: string
  detail: string
  projectKey: string
  accountId?: string
  sessionId?: string
  windowId?: number
}

/** Ctrl+K: filter over projects and their live sessions. Open it with useSwitcherStore.open(). */
export function ProjectSwitcher(): JSX.Element | null {
  const isOpen = useSwitcherStore((s) => s.isOpen)
  const close = useSwitcherStore((s) => s.close)
  const sessions = useConsoleStore((s) => s.sessions)
  const hubProjects = useAttentionStore((s) => s.snapshot.projects)
  const windowList = useWindowsStore((s) => s.list)
  const [query, setQuery] = useState('')
  const [active, setActive] = useState(0)
  const input = useRef<HTMLInputElement>(null)

  useEffect(() => {
    if (isOpen) {
      setQuery('')
      setActive(0)
    }
  }, [isOpen])

  const entries = useMemo(() => {
    const out: Entry[] = []
    const q = query.trim().toLowerCase()
    for (const p of mergeProjects(hubProjects, sessions).sort((a, b) => b.lastActivityMs - a.lastActivityMs)) {
      const live = sessions.filter((s) => s.live && sessionProjectKey(s) === p.key)
      const matchesProject = q === '' || p.name.toLowerCase().includes(q) || p.root.toLowerCase().includes(q)
      if (matchesProject) out.push({ id: `p:${p.key}`, kind: 'project', label: p.name, detail: p.root, projectKey: p.key })
      for (const s of live) {
        const title = s.title ?? s.sessionId.slice(0, 8)
        if (matchesProject || title.toLowerCase().includes(q) || s.sessionId.toLowerCase().startsWith(q)) {
          out.push({
            id: `s:${s.accountId}|${s.sessionId}`,
            kind: 'session',
            label: title,
            detail: `${p.name} · live session`,
            projectKey: p.key,
            accountId: s.accountId,
            sessionId: s.sessionId
          })
        }
      }
    }
    // Open windows (T34): "Window: Chat · acme / lead". The main window is where you already are.
    for (const w of windowList) {
      const spec = w.spec
      if (spec.kind === 'main') continue
      const projectName = mergeProjects(hubProjects, sessions).find((p) => p.key === spec.projectKey)?.name ?? spec.projectKey
      const sid = spec.kind === 'chat' ? (spec.sessionRef.split('|')[1] ?? '') : ''
      const title = spec.kind === 'chat' ? (sessions.find((s) => s.sessionId === sid)?.title ?? sid.slice(0, 8)) : ''
      const label = spec.kind === 'chat' ? `Chat · ${projectName} / ${title}` : `Project · ${projectName}`
      if (q === '' || label.toLowerCase().includes(q) || 'window'.startsWith(q)) {
        out.push({ id: `w:${w.id}`, kind: 'window', label: `Window: ${label}`, detail: w.focused ? 'focused' : 'open window', projectKey: spec.projectKey, windowId: w.id })
      }
    }
    return out
  }, [query, sessions, hubProjects, windowList])

  const activate = (e: Entry): void => {
    const c = useConsoleStore.getState()
    close()
    if (e.kind === 'window') {
      useWindowsStore.getState().focus(e.windowId!)
      return
    }
    c.navigate('team')
    if (c.projectKey !== e.projectKey) c.setProject(e.projectKey)
    if (e.kind === 'session') void c.selectSession({ mode: 'session', accountId: e.accountId!, sessionId: e.sessionId! })
  }

  const onKey = (ev: KeyboardEvent<HTMLInputElement>): void => {
    if (ev.nativeEvent.isComposing) return
    if (ev.key === 'ArrowDown' || ev.key === 'ArrowUp') {
      ev.preventDefault()
      if (entries.length > 0) setActive((i) => (i + (ev.key === 'ArrowDown' ? 1 : -1) + entries.length) % entries.length)
    } else if (ev.key === 'Enter') {
      ev.preventDefault()
      const e = entries[Math.min(active, entries.length - 1)]
      if (e) activate(e)
    }
  }

  return (
    <Dialog open={isOpen} title="Switch project or session" onClose={close} initialFocus={() => input.current}>
      <div className="ac-switch">
        <input
          ref={input}
          className="ac-switch__input"
          type="text"
          role="combobox"
          aria-label="Filter projects and sessions"
          aria-expanded="true"
          aria-controls="ac-switch-list"
          aria-activedescendant={entries[active] ? `ac-switch-${active}` : undefined}
          placeholder="Type a project or session name"
          value={query}
          onChange={(e) => {
            setQuery(e.target.value)
            setActive(0)
          }}
          onKeyDown={onKey}
        />
        <ul id="ac-switch-list" role="listbox" aria-label="Results" className="ac-switch__list">
          {entries.length === 0 && <li className="ac-switch__empty">No match</li>}
          {entries.map((e, i) => (
            <li
              key={e.id}
              id={`ac-switch-${i}`}
              role="option"
              aria-selected={i === active}
              className={`ac-switch__opt${i === active ? ' is-active' : ''}`}
              onMouseEnter={() => setActive(i)}
              onClick={() => activate(e)}
            >
              <span className="ac-switch__kind">{e.kind === 'project' ? 'Project' : e.kind === 'window' ? 'Window' : 'Session'}</span>
              <span className="ac-switch__label">{e.label}</span>
              <span className="ac-switch__detail">{e.detail}</span>
            </li>
          ))}
        </ul>
      </div>
    </Dialog>
  )
}
