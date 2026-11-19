// @vitest-environment jsdom
import './jestDom'
import { render, screen, within } from '@testing-library/react'
import userEvent from '@testing-library/user-event'
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest'
import { HooksDialog, hooksLabel } from '@renderer/components/team/HooksDialog'
import { TeamHeader } from '@renderer/components/team/TeamHeader'
import { resetConsoleStore, useConsoleStore } from '@renderer/store/useConsoleStore'
import { useWorkspaceStore } from '@renderer/store/useWorkspaceStore'
import { mockTeamSnapshot } from '@shared/mock'
import type { HooksPreview, HooksStatus } from '@shared/types'
import { seedMockAccounts } from './seedAccounts'

const ROOT = 'D:/work/alpha'
const api = vi.hoisted(() => ({ status: vi.fn(), preview: vi.fn(), apply: vi.fn() }))

const status = (over: Partial<HooksStatus> = {}): HooksStatus => ({
  projectRoot: ROOT,
  settingsPath: `${ROOT}/.claude/settings.local.json`,
  state: 'not-installed',
  server: { listening: true, port: 1234 },
  eventsReceived: 0,
  ...over
})

const PREVIEW: HooksPreview = {
  previewId: 'p1',
  action: 'install',
  settingsPath: `${ROOT}/.claude/settings.local.json`,
  before: '{"old":true}',
  after: '{\n  "hooks": { "Stop": [] }\n}',
  backupPath: `${ROOT}/.claude/settings.local.json.bak`,
  scriptPath: 'C:/app/hook.js',
  notes: ['Adds 16 hook entries', 'Existing entries are kept']
}

function seed(h: HooksStatus | null): void {
  useWorkspaceStore.setState({ watchedRoot: ROOT, hooks: h, hooksPreview: null, hooksError: undefined })
}

beforeEach(() => {
  Object.defineProperty(window, 'innerWidth', { configurable: true, writable: true, value: 1440 })
  api.status.mockReset().mockResolvedValue(status({ state: 'installed' }))
  api.preview.mockReset().mockResolvedValue(PREVIEW)
  api.apply.mockReset().mockResolvedValue({ ok: true })
  ;(window as unknown as { api: unknown }).api = { hooks: api, accounts: { resolveFolder: vi.fn() } }
})
afterEach(() => {
  delete (window as unknown as { api?: unknown }).api
  useWorkspaceStore.setState({ watchedRoot: null, hooks: null, hooksPreview: null, hooksError: undefined })
})

describe('hooksLabel', () => {
  it('maps every state', () => {
    expect(hooksLabel(null)).toBe('n/a')
    expect(hooksLabel(status({ state: 'installed' }))).toBe('on')
    expect(hooksLabel(status({ state: 'not-installed' }))).toBe('off')
    expect(hooksLabel(status({ state: 'partial' }))).toBe('partial')
    expect(hooksLabel(status({ state: 'outdated' }))).toBe('partial')
    expect(hooksLabel(status({ state: 'unavailable' }))).toBe('n/a')
  })
})

describe('HooksDialog', () => {
  it('shows the status, reason and project path', () => {
    seed(status({ state: 'unavailable', reason: 'node was not found' }))
    render(<HooksDialog open onClose={() => undefined} />)
    expect(screen.getByText(/Hooks: n\/a/)).toBeInTheDocument()
    expect(screen.getByText('node was not found')).toBeInTheDocument()
    expect(screen.getByText(ROOT)).toBeInTheDocument()
    expect(screen.getByRole('button', { name: 'Install' })).toBeDisabled()
  })

  it('shows Install or Uninstall by state (T32 U15), never both for a clean state', () => {
    seed(status())
    const { unmount } = render(<HooksDialog open onClose={() => undefined} />)
    expect(screen.getByRole('button', { name: 'Install' })).toBeEnabled()
    expect(screen.queryByRole('button', { name: 'Uninstall' })).toBeNull()
    unmount()
    seed(status({ state: 'installed' }))
    render(<HooksDialog open onClose={() => undefined} />)
    expect(screen.queryByRole('button', { name: 'Install' })).toBeNull()
    expect(screen.getByRole('button', { name: 'Uninstall' })).toBeEnabled()
  })

  it('opens with focus on Close (Enter never writes settings) and lists the events it would add', () => {
    seed(status())
    render(<HooksDialog open onClose={() => undefined} />)
    expect(screen.getByRole('button', { name: 'Close' })).toHaveFocus()
    expect(screen.getByText(/Events it adds .16/)).toBeInTheDocument()
    expect(screen.getByText(/PreToolUse/)).toBeInTheDocument()
    expect(api.apply).not.toHaveBeenCalled()
    expect(api.preview).not.toHaveBeenCalled()
  })

  it('preview shows paths, notes and the full after JSON; nothing is written until Write file', async () => {
    seed(status())
    render(<HooksDialog open onClose={() => undefined} />)
    await userEvent.click(screen.getByRole('button', { name: 'Install' }))
    expect(api.preview).toHaveBeenCalledWith(ROOT, 'install')
    expect(await screen.findByLabelText('Settings after')).toBeInTheDocument()
    expect(screen.getByText(PREVIEW.backupPath!)).toBeInTheDocument()
    expect(screen.getByText('C:/app/hook.js')).toBeInTheDocument()
    expect(screen.getByText('Adds 16 hook entries')).toBeInTheDocument()
    expect(screen.getByLabelText('Settings after').textContent).toBe(PREVIEW.after)
    expect(api.apply).not.toHaveBeenCalled()

    await userEvent.click(screen.getByRole('checkbox', { name: 'Show before' }))
    expect(screen.getByLabelText('Settings before').textContent).toBe('{"old":true}')
    expect(api.apply).not.toHaveBeenCalled()
  })

  it('Cancel clears the preview without writing', async () => {
    seed(status())
    render(<HooksDialog open onClose={() => undefined} />)
    await userEvent.click(screen.getByRole('button', { name: 'Install' }))
    await screen.findByLabelText('Settings after')
    await userEvent.click(screen.getByRole('button', { name: 'Cancel' }))
    expect(useWorkspaceStore.getState().hooksPreview).toBeNull()
    expect(screen.queryByLabelText('Settings after')).toBeNull()
    expect(api.apply).not.toHaveBeenCalled()
  })

  it('Write file applies the preview id once and refreshes the status', async () => {
    seed(status())
    render(<HooksDialog open onClose={() => undefined} />)
    await userEvent.click(screen.getByRole('button', { name: 'Install' }))
    await userEvent.click(await screen.findByRole('button', { name: 'Write file' }))
    expect(api.apply).toHaveBeenCalledTimes(1)
    expect(api.apply).toHaveBeenCalledWith('p1')
    expect(await screen.findByText('Hooks installed.')).toBeInTheDocument()
    expect(useWorkspaceStore.getState().hooks?.state).toBe('installed')
  })

  it('shows the error when apply fails and keeps the preview', async () => {
    api.apply.mockResolvedValue({ ok: false, reason: 'file changed on disk' })
    seed(status())
    render(<HooksDialog open onClose={() => undefined} />)
    await userEvent.click(screen.getByRole('button', { name: 'Install' }))
    await userEvent.click(await screen.findByRole('button', { name: 'Write file' }))
    expect(await screen.findByRole('alert')).toHaveTextContent('file changed on disk')
    expect(screen.getByLabelText('Settings after')).toBeInTheDocument()
  })

  it('shows the reason when the preview cannot be prepared', async () => {
    api.preview.mockResolvedValue({ ok: false, reason: 'invalid json in settings' })
    seed(status({ state: 'installed' }))
    render(<HooksDialog open onClose={() => undefined} />)
    await userEvent.click(screen.getByRole('button', { name: 'Uninstall' }))
    expect(await screen.findByRole('alert')).toHaveTextContent('invalid json in settings')
    expect(api.preview).toHaveBeenCalledWith(ROOT, 'uninstall')
  })
})

describe('header Hooks button', () => {
  beforeEach(() => {
    resetConsoleStore()
    seedMockAccounts()
    const team = { ...structuredClone(mockTeamSnapshot), source: 'live' as const, sessionId: 's', cwd: ROOT }
    useConsoleStore.setState({ team, liveTeam: team, teamMode: 'live' })
  })

  it('labels the state and opens the dialog', async () => {
    seed(status({ state: 'partial' }))
    render(<TeamHeader />)
    await userEvent.click(screen.getByRole('button', { name: 'More header actions' }))
    await userEvent.click(screen.getByRole('menuitem', { name: 'Hooks: partial · Reinstall…' }))
    const dlg = screen.getByRole('dialog', { name: 'Agent Console hooks' })
    expect(within(dlg).getByRole('button', { name: 'Install' })).toBeEnabled()
  })

  it('is reachable from the overflow menu at a narrow width', async () => {
    Object.defineProperty(window, 'innerWidth', { configurable: true, writable: true, value: 900 })
    seed(status({ state: 'installed' }))
    render(<TeamHeader />)
    expect(screen.queryByRole('button', { name: 'Hooks: on' })).toBeNull()
    await userEvent.click(screen.getByRole('button', { name: 'More header actions' }))
    await userEvent.click(screen.getByRole('menuitem', { name: 'Hooks: on' }))
    expect(screen.getByRole('dialog')).toBeInTheDocument()
    expect(screen.getByRole('button', { name: 'Close' })).toBeInTheDocument()
  })
})
