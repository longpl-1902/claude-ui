// @vitest-environment jsdom
import './jestDom'
import { render, screen, waitFor, act } from '@testing-library/react'
import userEvent from '@testing-library/user-event'
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest'
import { TerminalView } from '@renderer/components/terminal/TerminalView'
import { RawTerminalPane } from '@renderer/components/team/RawTerminalPane'
import { resetConsoleStore, useConsoleStore } from '@renderer/store/useConsoleStore'
import { seedMockAccounts } from './seedAccounts'

const xterm = vi.hoisted(() => ({
  open: vi.fn(),
  write: vi.fn(),
  dispose: vi.fn(),
  loadAddon: vi.fn(),
  fit: vi.fn(),
  onDataCb: undefined as undefined | ((d: string) => void)
}))

vi.mock('@xterm/xterm', () => ({
  Terminal: class {
    cols = 100
    rows = 30
    open = xterm.open
    write = xterm.write
    dispose = xterm.dispose
    loadAddon = xterm.loadAddon
    onData = (cb: (d: string) => void) => {
      xterm.onDataCb = cb
      return { dispose: vi.fn() }
    }
  }
}))
vi.mock('@xterm/addon-fit', () => ({
  FitAddon: class {
    fit = xterm.fit
  }
}))
vi.mock('@xterm/xterm/css/xterm.css', () => ({}))

type DataEv = { ptyId: string; data: string; end: number }
type ExitEv = { ptyId: string; exitCode: number }

function makeApi() {
  const dataCbs: Array<(e: DataEv) => void> = []
  const exitCbs: Array<(e: ExitEv) => void> = []
  const api = {
    pty: {
      spawn: vi.fn().mockResolvedValue({ ok: true, ptyId: 'p1' }),
      write: vi.fn().mockResolvedValue({ ok: true }),
      resize: vi.fn().mockResolvedValue({ ok: true }),
      kill: vi.fn().mockResolvedValue({ ok: true }),
      list: vi.fn().mockResolvedValue([]),
      getBuffer: vi.fn().mockResolvedValue({ data: 'BUFFER', end: 6 }),
      onData: vi.fn((cb: (e: DataEv) => void) => {
        dataCbs.push(cb)
        return vi.fn()
      }),
      onExit: vi.fn((cb: (e: ExitEv) => void) => {
        exitCbs.push(cb)
        return vi.fn()
      })
    },
    accounts: {
      resolveFolder: vi.fn().mockResolvedValue({ accountId: 'company', ruleIndex: 0, pattern: '~/work/**' }),
      checkLaunch: vi.fn().mockResolvedValue({ allowed: true, warnings: [], matched: { accountId: 'company', ruleIndex: 0 } })
    },
    app: {
      getDefaultCwd: vi.fn().mockResolvedValue('C:/work/proj'),
      pickFolder: vi.fn().mockResolvedValue(null)
    }
  }
  return {
    api,
    emitData: (e: DataEv) => dataCbs.forEach((c) => c(e)),
    emitExit: (e: ExitEv) => exitCbs.forEach((c) => c(e))
  }
}
const setApi = (a: unknown): void => {
  ;(window as unknown as { api: unknown }).api = a
}

beforeEach(() => {
  resetConsoleStore()
  xterm.onDataCb = undefined
  ;[xterm.open, xterm.write, xterm.dispose, xterm.loadAddon, xterm.fit].forEach((f) => f.mockClear())
})
afterEach(() => setApi(undefined))

describe('R-13 TerminalView', () => {
  it('writes the buffer, then only data events for its pty', async () => {
    const h = makeApi()
    setApi(h.api)
    render(<TerminalView ptyId="p1" />)
    await waitFor(() => expect(xterm.write).toHaveBeenCalledWith('BUFFER'))
    act(() => {
      h.emitData({ ptyId: 'p1', data: 'hello', end: 11 })
      h.emitData({ ptyId: 'other', data: 'nope', end: 4 })
    })
    expect(xterm.write).toHaveBeenCalledWith('hello')
    expect(xterm.write).not.toHaveBeenCalledWith('nope')
    expect(xterm.write.mock.calls[0]![0]).toBe('BUFFER')
  })

  it('a chunk that is in the buffer and also pushed before getBuffer resolves is written once; a straddling chunk is trimmed', async () => {
    const h = makeApi()
    let resolveBuf!: (v: { data: string; end: number }) => void
    h.api.pty.getBuffer.mockReturnValue(new Promise((r) => (resolveBuf = r)))
    setApi(h.api)
    render(<TerminalView ptyId="p1" />)
    await waitFor(() => expect(h.api.pty.getBuffer).toHaveBeenCalled())
    act(() => {
      h.emitData({ ptyId: 'p1', data: 'BCDE', end: 5 }) // fully inside the buffer
      h.emitData({ ptyId: 'p1', data: 'EFG', end: 7 }) // straddles: only 'FG' is new
      h.emitData({ ptyId: 'p1', data: 'HI', end: 9 }) // new
    })
    await act(async () => resolveBuf({ data: 'ABCDE', end: 5 }))
    const written = xterm.write.mock.calls.map((c) => c[0] as string).join('')
    expect(written).toBe('ABCDEFGHI')
    // live chunks after ready keep the same rule
    act(() => {
      h.emitData({ ptyId: 'p1', data: 'HI', end: 9 })
      h.emitData({ ptyId: 'p1', data: 'J', end: 10 })
    })
    expect(xterm.write.mock.calls.map((c) => c[0] as string).join('')).toBe('ABCDEFGHIJ')
  })

  it('typing calls pty.write with the ptyId', async () => {
    const h = makeApi()
    setApi(h.api)
    render(<TerminalView ptyId="p1" />)
    await waitFor(() => expect(xterm.onDataCb).toBeDefined())
    xterm.onDataCb!('ls\r')
    expect(h.api.pty.write).toHaveBeenCalledWith('p1', 'ls\r')
  })

  it('does not forward typing when not interactive', async () => {
    const h = makeApi()
    setApi(h.api)
    render(<TerminalView ptyId="p1" interactive={false} />)
    await waitFor(() => expect(xterm.open).toHaveBeenCalled())
    expect(xterm.onDataCb).toBeUndefined()
  })

  it('unmount disposes xterm and never kills the pty', async () => {
    const h = makeApi()
    setApi(h.api)
    const { unmount } = render(<TerminalView ptyId="p1" />)
    await waitFor(() => expect(xterm.open).toHaveBeenCalled())
    unmount()
    expect(xterm.dispose).toHaveBeenCalled()
    expect(h.api.pty.kill).not.toHaveBeenCalled()
  })

  it('exit writes the exit line and sets data-exited', async () => {
    const h = makeApi()
    setApi(h.api)
    render(<TerminalView ptyId="p1" ariaLabel="T" />)
    await waitFor(() => expect(xterm.write).toHaveBeenCalledWith('BUFFER'))
    act(() => h.emitExit({ ptyId: 'p1', exitCode: 3 }))
    expect(xterm.write).toHaveBeenCalledWith('\r\n[process exited with code 3]\r\n')
    expect(screen.getByRole('region', { name: 'T' })).toHaveAttribute('data-exited', 'true')
  })

  it('renders only the container without window.api', () => {
    setApi(undefined)
    render(<TerminalView ptyId="p1" />)
    expect(screen.getByRole('region', { name: 'Terminal' })).toBeInTheDocument()
    expect(xterm.open).not.toHaveBeenCalled()
  })
})

describe('R-13 RawTerminalPane', () => {
  beforeEach(() => seedMockAccounts())

  it('shows the resolved account and starts claude, setting leadPty', async () => {
    const h = makeApi()
    setApi(h.api)
    render(<RawTerminalPane />)
    expect(await screen.findByText(/Uses Company \(rule: ~\/work\/\*\*\)/)).toBeInTheDocument()
    expect(h.api.accounts.resolveFolder).toHaveBeenCalledWith('C:/work/proj')
    await userEvent.click(screen.getByRole('button', { name: 'Start claude' }))
    await waitFor(() =>
      expect(h.api.pty.spawn).toHaveBeenCalledWith({ cwd: 'C:/work/proj', accountId: 'company', cols: 120, rows: 30, confirmed: false })
    )
    await waitFor(() =>
      expect(useConsoleStore.getState().leadPty).toEqual({ ptyId: 'p1', folder: 'C:/work/proj', accountId: 'company' })
    )
    expect(await screen.findByRole('region', { name: 'Lead session terminal' })).toBeInTheDocument()
  })

  it('ask resolution shows a picker and spawns with the picked account', async () => {
    const h = makeApi()
    h.api.accounts.resolveFolder.mockResolvedValue({ accountId: 'ask', ruleIndex: -1 })
    setApi(h.api)
    render(<RawTerminalPane />)
    const select = await screen.findByRole('combobox', { name: 'Account' })
    expect(screen.getByRole('button', { name: 'Start claude' })).toBeDisabled()
    await userEvent.selectOptions(select, 'personal')
    await userEvent.click(screen.getByRole('button', { name: 'Start claude' }))
    await waitFor(() => expect(h.api.pty.spawn).toHaveBeenCalledWith(expect.objectContaining({ accountId: 'personal' })))
  })

  it.each([
    ['account-locked', 'This folder already has a session on another account. Stop it first, or turn off the lock in Accounts.'],
    ['pty-unavailable', 'Terminal support (node-pty) is not available in this build.'],
    ['claude-not-found', 'Could not find the claude CLI on PATH.']
  ])('blocked %s shows an inline error and does not spawn', async (reason, text) => {
    const h = makeApi()
    h.api.accounts.checkLaunch.mockResolvedValue({
      allowed: false,
      warnings: [],
      blockedReason: reason,
      matched: { accountId: 'company', ruleIndex: 0 }
    })
    setApi(h.api)
    render(<RawTerminalPane />)
    await screen.findByText(/Uses Company/)
    await userEvent.click(screen.getByRole('button', { name: 'Start claude' }))
    expect(await screen.findByRole('alert')).toHaveTextContent(text)
    expect(h.api.pty.spawn).not.toHaveBeenCalled()
  })

  it('a warning asks for confirmation, then spawns with confirmed: true', async () => {
    const h = makeApi()
    h.api.accounts.checkLaunch.mockResolvedValue({
      allowed: true,
      warnings: ['personal-in-company-folder'],
      matched: { accountId: 'company', ruleIndex: 0 }
    })
    setApi(h.api)
    render(<RawTerminalPane />)
    await screen.findByText(/Uses Company/)
    await userEvent.click(screen.getByRole('button', { name: 'Start claude' }))
    expect(await screen.findByText('You are opening a company folder with a personal account.')).toBeInTheDocument()
    expect(h.api.pty.spawn).not.toHaveBeenCalled()
    await userEvent.click(screen.getByRole('button', { name: 'Open anyway' }))
    await waitFor(() => expect(h.api.pty.spawn).toHaveBeenCalledWith(expect.objectContaining({ confirmed: true })))
  })

  it('Cancel dismisses the warning', async () => {
    const h = makeApi()
    h.api.accounts.checkLaunch.mockResolvedValue({
      allowed: true,
      warnings: ['personal-in-company-folder'],
      matched: { accountId: 'company', ruleIndex: 0 }
    })
    setApi(h.api)
    render(<RawTerminalPane />)
    await screen.findByText(/Uses Company/)
    await userEvent.click(screen.getByRole('button', { name: 'Start claude' }))
    await userEvent.click(await screen.findByRole('button', { name: 'Cancel' }))
    expect(screen.getByRole('button', { name: 'Start claude' })).toBeInTheDocument()
  })

  it('re-mount with a live leadPty shows the terminal, not the form; Stop kills and clears', async () => {
    const h = makeApi()
    h.api.pty.list.mockResolvedValue([{ id: 'p9', purpose: 'claude', cwd: 'C:/w', configDir: 'x', pid: 1, startedAt: 'now' }])
    setApi(h.api)
    useConsoleStore.getState().setLeadPty({ ptyId: 'p9', folder: 'C:/w', accountId: 'company' })
    render(<RawTerminalPane />)
    expect(await screen.findByRole('region', { name: 'Lead session terminal' })).toBeInTheDocument()
    expect(screen.queryByRole('button', { name: 'Start claude' })).toBeNull()
    expect(screen.getByText('Company')).toBeInTheDocument()
    await userEvent.click(screen.getByRole('button', { name: 'Stop' }))
    expect(h.api.pty.kill).toHaveBeenCalledWith('p9')
    expect(useConsoleStore.getState().leadPty).toEqual({})
    expect(await screen.findByRole('button', { name: 'Start claude' })).toBeInTheDocument()
  })

  it('a dead stored pty falls back to the launcher and clears leadPty', async () => {
    const h = makeApi()
    h.api.pty.list.mockResolvedValue([
      { id: 'p9', purpose: 'claude', cwd: 'C:/w', configDir: 'x', pid: 1, startedAt: 'now', exitCode: 0 }
    ])
    setApi(h.api)
    useConsoleStore.getState().setLeadPty({ ptyId: 'p9', folder: 'C:/w', accountId: 'company' })
    render(<RawTerminalPane />)
    expect(await screen.findByRole('button', { name: 'Start claude' })).toBeInTheDocument()
    expect(useConsoleStore.getState().leadPty).toEqual({})
  })

  it('with no accounts shows the hint and navigates to Accounts', async () => {
    useConsoleStore.setState({ accounts: { ...useConsoleStore.getState().accounts, accounts: [] } })
    setApi(makeApi().api)
    render(<RawTerminalPane />)
    expect(screen.getByText('Add an account in Accounts first')).toBeInTheDocument()
    await userEvent.click(screen.getByRole('button', { name: 'Open Accounts' }))
    expect(useConsoleStore.getState().screen).toBe('accounts')
  })
})
