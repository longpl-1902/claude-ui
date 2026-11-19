import { useEffect } from 'react'
import { useConsoleStore } from '../store/useConsoleStore'
import { selectControlForSession, useControlStore } from '../store/useControlStore'
import { useLayoutStore } from '../store/useLayoutStore'

export interface ShortcutDef {
  keys: string
  action: string
}

/** Every shortcut of the app (help overlay and README). Keys that other modules bind are listed here too. */
export const SHORTCUTS: ShortcutDef[] = [
  { keys: 'Ctrl+K', action: 'Open the project / session switcher' },
  { keys: 'Ctrl+1 .. Ctrl+9', action: 'Go to pinned project 1..9' },
  { keys: 'Ctrl+J / Ctrl+Shift+J', action: 'Next / previous session that needs you' },
  { keys: 'Ctrl+L', action: 'Focus the lead prompt' },
  { keys: 'Ctrl+Shift+T', action: 'Team view' },
  { keys: 'Ctrl+Shift+A', action: 'Accounts' },
  { keys: 'Ctrl+Shift+C', action: 'Switch between Team and Chat view' },
  { keys: 'Ctrl+Shift+M', action: 'Maximize / restore the lead console' },
  { keys: 'Ctrl+B', action: 'Collapse / expand the left column' },
  { keys: 'Ctrl+I', action: 'Collapse / expand the inspector' },
  { keys: 'Ctrl+`', action: 'Toggle the raw terminal' },
  { keys: 'Ctrl+.', action: 'Interrupt the running lead (never sends a message)' },
  { keys: 'Alt+Up / Alt+Down', action: 'Previous / next agent' },
  { keys: 'A / D / Enter', action: 'Needs-you inbox row: Allow / Deny / Go to' },
  { keys: 'Esc', action: 'Close a dialog, drawer or the inbox' },
  { keys: '?', action: 'Show this help' }
]

/**
 * Calls into the project rail, needs-you inbox and switcher (T22). They live in another module, so App injects
 * the real actions with `setShortcutBridge`; missing entries are no-ops.
 */
export interface ShortcutBridge {
  /** useRailStore.goToPinned(n), n is 1..9 */
  goToPinned?(n: number): void
  /** useAttentionStore.focusNext() */
  focusNext?(): void
  /** useAttentionStore.focusPrev() */
  focusPrev?(): void
  /** useSwitcherStore.open() */
  openSwitcher?(): void
}

let bridge: ShortcutBridge = {}

/** Install (or clear with `{}`) the T22 actions the global shortcuts call. */
export function setShortcutBridge(b: ShortcutBridge): void {
  bridge = b
}

const TEXT_INPUT_TYPES = new Set(['text', 'search', 'url', 'tel', 'email', 'password', 'number', ''])

function isTextEntry(t: EventTarget | null): boolean {
  if (!(t instanceof HTMLElement)) return false
  if (t instanceof HTMLTextAreaElement || t instanceof HTMLSelectElement) return true
  if (t instanceof HTMLInputElement) return TEXT_INPUT_TYPES.has(t.type)
  return t.isContentEditable
}

/** Handle one keydown; returns true when it was a shortcut (and was prevented). */
export function handleShortcut(e: KeyboardEvent): boolean {
  if (e.isComposing || e.key === 'Process') return false
  const inInput = isTextEntry(e.target)
  const inTerminal = e.target instanceof HTMLElement && e.target.closest('.xterm') !== null
  const key = e.key.length === 1 ? e.key.toLowerCase() : e.key
  const ctrl = e.ctrlKey || e.metaKey
  const st = useConsoleStore.getState()

  const done = (): true => {
    e.preventDefault()
    return true
  }

  if (key === 'Escape' && !e.ctrlKey && !e.altKey && st.shortcutsOpen) {
    st.setShortcutsOpen(false)
    return done()
  }

  if (!ctrl && !e.altKey) {
    if (e.key === '?' && !inInput && !inTerminal) {
      st.setShortcutsOpen(!st.shortcutsOpen)
      return done()
    }
    return false
  }

  if (e.altKey && !ctrl) {
    if (inInput || inTerminal || e.shiftKey) return false
    if (key === 'ArrowUp' || key === 'ArrowDown') {
      if (st.screen !== 'team') return false
      st.selectAdjacentAgent(key === 'ArrowDown' ? 1 : -1)
      return done()
    }
    return false
  }

  if (!ctrl || e.altKey) return false
  // The terminal keeps plain Ctrl combos (Ctrl+B, Ctrl+L, ...) for the shell.
  if (inTerminal && !e.shiftKey && key !== '`') return false

  if (e.shiftKey) {
    switch (key) {
      case 't':
        st.navigate('team')
        return done()
      case 'a':
        st.navigate('accounts')
        return done()
      case 'j':
        if (!bridge.focusPrev) return false
        bridge.focusPrev()
        return done()
      default:
        return false
    }
  }

  if (key >= '1' && key <= '9' && key.length === 1) {
    if (!bridge.goToPinned) return false
    bridge.goToPinned(Number(key))
    return done()
  }

  switch (key) {
    case 'k':
      if (!bridge.openSwitcher) return false
      bridge.openSwitcher()
      return done()
    case 'j':
      if (!bridge.focusNext) return false
      bridge.focusNext()
      return done()
    case 'l': {
      if (st.screen !== 'team') st.navigate('team')
      const el = document.getElementById('ac-prompt')
      if (el instanceof HTMLInputElement && !el.disabled) {
        el.focus()
        return done()
      }
      return false
    }
    case 'b':
      useLayoutStore.getState().toggleLeft()
      return done()
    case 'i':
      useLayoutStore.getState().toggleRight()
      return done()
    case '`':
      st.toggleRawTerminal()
      return done()
    case '.': {
      const sid = st.teamMode === 'live' ? st.team.sessionId : undefined
      const ctl = useControlStore.getState()
      const control = selectControlForSession(sid)(ctl)
      if (control && control.state === 'busy') void ctl.interrupt(control.id)
      return done()
    }
    default:
      return false
  }
}

/** One window keydown listener for the global shortcuts (D12). */
export function useShortcuts(): void {
  useEffect(() => {
    const onKey = (e: KeyboardEvent): void => {
      handleShortcut(e)
    }
    window.addEventListener('keydown', onKey)
    return () => window.removeEventListener('keydown', onKey)
  }, [])
}
