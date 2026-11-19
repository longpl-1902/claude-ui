// @vitest-environment jsdom
import './jestDom'
import { fireEvent, render } from '@testing-library/react'
import { afterEach, describe, expect, it, vi } from 'vitest'
import { selectNeedsYouCount } from '@renderer/store/useConsoleStore'
import { setShortcutBridge, useShortcuts } from '@renderer/hooks/useShortcuts'
import { useAttentionStore } from '@renderer/store/useAttentionStore'
import { useRailStore } from '@renderer/store/useRailStore'
import { useSwitcherStore } from '@renderer/store/useSwitcherStore'

describe('needs-you count (integration T18 + T22)', () => {
  it('adds controlled pending prompts to agents that need you', () => {
    expect(selectNeedsYouCount(2, 1)).toBe(3)
  })
  it('does not double count when the lead is needs-you because of the same prompt', () => {
    expect(selectNeedsYouCount(1, 1, true)).toBe(1)
    expect(selectNeedsYouCount(2, 2, true)).toBe(3)
  })
  it('lead needs-you with no pending prompt counts once', () => {
    expect(selectNeedsYouCount(1, 0, true)).toBe(1)
  })
})

function Harness() {
  useShortcuts()
  return <div />
}

describe('shortcut bridge wired to rail / inbox / switcher stores', () => {
  afterEach(() => setShortcutBridge({}))

  it('Ctrl+J / Ctrl+Shift+J / Ctrl+K / Ctrl+1 call the T22 store actions', () => {
    const focusNext = vi.fn(async () => {})
    const focusPrev = vi.fn(async () => {})
    const goToPinned = vi.fn(() => true)
    const open = vi.fn()
    useAttentionStore.setState({ focusNext, focusPrev } as never)
    useRailStore.setState({ goToPinned } as never)
    useSwitcherStore.setState({ open } as never)
    // Same wiring as App.tsx (getState() at call time).
    setShortcutBridge({
      goToPinned: (n) => useRailStore.getState().goToPinned(n),
      focusNext: () => useAttentionStore.getState().focusNext(),
      focusPrev: () => useAttentionStore.getState().focusPrev(),
      openSwitcher: () => useSwitcherStore.getState().open()
    })
    render(<Harness />)
    fireEvent.keyDown(document.body, { key: 'j', ctrlKey: true })
    fireEvent.keyDown(document.body, { key: 'J', ctrlKey: true, shiftKey: true })
    fireEvent.keyDown(document.body, { key: 'k', ctrlKey: true })
    fireEvent.keyDown(document.body, { key: '1', ctrlKey: true })
    expect(focusNext).toHaveBeenCalledTimes(1)
    expect(focusPrev).toHaveBeenCalledTimes(1)
    expect(open).toHaveBeenCalledTimes(1)
    expect(goToPinned).toHaveBeenCalledWith(1)
  })
})
