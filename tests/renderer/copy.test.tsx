// @vitest-environment jsdom
import './jestDom'
import { act, fireEvent, render, screen, within } from '@testing-library/react'
import userEvent from '@testing-library/user-event'
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest'
import { ChatView } from '@renderer/components/chat/ChatView'
import { CopyButton } from '@renderer/components/chat/CopyButton'
import { Markdown } from '@renderer/components/chat/Markdown'
import { ToolCallRow } from '@renderer/components/chat/ToolCallRow'
import { LeadConsole } from '@renderer/components/team/LeadConsole'
import { resetConsoleStore, useConsoleStore } from '@renderer/store/useConsoleStore'
import { useControlStore } from '@renderer/store/useControlStore'
import { mockTeamSnapshot } from '@shared/mock'
import { readFileSync } from 'node:fs'

let clip: ReturnType<typeof vi.fn>
beforeEach(() => {
  clip = vi.fn().mockResolvedValue(undefined)
  Object.defineProperty(navigator, 'clipboard', { configurable: true, value: { writeText: clip } })
  resetConsoleStore()
  useControlStore.setState({ sessions: [], streams: {} })
})
afterEach(() => {
  delete (navigator as { clipboard?: unknown }).clipboard
})

describe('T33 copy buttons', () => {
  it('copies the exact text, announces Copied in an aria-live region, then clears', async () => {
    vi.useFakeTimers({ shouldAdvanceTime: true })
    render(<CopyButton text={'  exact\ttext\n'} label="message" />)
    const b = screen.getByRole('button', { name: 'Copy message' })
    await act(async () => {
      b.click()
    })
    expect(clip).toHaveBeenCalledWith('  exact\ttext\n')
    const live = document.querySelector('.ac-copy__msg')!
    expect(live).toHaveAttribute('aria-live', 'polite')
    expect(live).toHaveTextContent('Copied')
    act(() => void vi.advanceTimersByTime(2000))
    expect(live).toHaveTextContent('')
    vi.useRealTimers()
  })

  it('says so when the clipboard refuses', async () => {
    clip.mockRejectedValue(new Error('denied'))
    render(<CopyButton text="x" label="code" />)
    await userEvent.click(screen.getByRole('button', { name: 'Copy code' }))
    expect(document.querySelector('.ac-copy__msg')).toHaveTextContent('Copy failed')
  })

  it('is keyboard reachable: a real button that activates with Enter and Space', async () => {
    render(<CopyButton text="kb" label="path" />)
    await userEvent.tab()
    const b = screen.getByRole('button', { name: 'Copy path' })
    expect(b).toHaveFocus()
    await userEvent.keyboard('{Enter}')
    await userEvent.keyboard(' ')
    expect(clip).toHaveBeenCalledTimes(2)
  })

  it('CSS shows the button on hover and on keyboard focus', () => {
    const css = readFileSync('src/renderer/src/components/chat/chat.css', 'utf8')
    expect(css).toMatch(/:hover > \.ac-copy/)
    expect(css).toMatch(/:focus-within > \.ac-copy/)
    expect(css).toMatch(/\.ac-copy:focus-within/)
  })

  it('code blocks copy the code without the fence', async () => {
    render(<Markdown text={'```js\nlet a = 1\nlet b = 2\n```'} />)
    await userEvent.click(screen.getByRole('button', { name: 'Copy code' }))
    expect(clip).toHaveBeenCalledWith('let a = 1\nlet b = 2')
  })

  it('tool rows copy the full, untruncated and unshortened input', async () => {
    const rest = 'D:/work/alpha/src/a.ts ' + 'q'.repeat(1500)
    render(<ToolCallRow text={`Edit ${rest}`} projectRoot="D:/work/alpha" />)
    await userEvent.click(screen.getByRole('button', { name: 'Copy tool input' }))
    expect(clip).toHaveBeenCalledWith(rest)
  })

  it('chat messages copy their original text; the session id is copyable', async () => {
    const t = {
      ...structuredClone(mockTeamSnapshot),
      source: 'live' as const,
      sessionId: 'abcdef123456',
      cwd: 'D:/work/alpha',
      console: [{ time: '1', who: 'lead', text: 'Hello **world**' }]
    }
    useConsoleStore.setState({ team: t, liveTeam: t, teamMode: 'live' })
    render(<ChatView />)
    await userEvent.click(screen.getByRole('button', { name: 'Copy message' }))
    expect(clip).toHaveBeenLastCalledWith('Hello **world**')
    await userEvent.click(screen.getByRole('button', { name: 'Copy session id' }))
    expect(clip).toHaveBeenLastCalledWith('abcdef123456')
  })

  it('console lines have a Copy line button with the exact line text', async () => {
    const t = {
      ...structuredClone(mockTeamSnapshot),
      source: 'live' as const,
      console: [{ time: '1', who: 'lead', text: 'all green: done' }]
    }
    useConsoleStore.setState({ team: t, liveTeam: t, teamMode: 'live' })
    useControlStore.setState({ sessions: [] })
    render(<LeadConsole />)
    const line = document.querySelector('.ac-tc-line') as HTMLElement
    await userEvent.click(within(line).getByRole('button', { name: 'Copy line' }))
    expect(clip).toHaveBeenCalledWith('all green: done')
  })

  it('console and chat text is selectable', () => {
    const css = readFileSync('src/renderer/src/components/chat/chat.css', 'utf8')
    expect(css).toMatch(/\.ac-tc-log[^{]*\{ user-select: text/)
    expect(css).not.toMatch(/user-select:\s*none/)
    fireEvent.contextMenu(document.body) // no renderer-side handler swallows the native menu
  })
})
