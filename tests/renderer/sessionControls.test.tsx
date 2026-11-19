// @vitest-environment jsdom
import './jestDom'
import { readFileSync } from 'node:fs'
import { resolve } from 'node:path'
import { render, screen, waitFor, within } from '@testing-library/react'
import userEvent from '@testing-library/user-event'
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest'
import { ControlBar } from '@renderer/components/team/ControlBar'
import { resetConsoleStore, useConsoleStore } from '@renderer/store/useConsoleStore'
import { useControlStore } from '@renderer/store/useControlStore'
import { useDetailsStore } from '@renderer/store/useDetailsStore'
import type { ControlDetails, ControlSessionInfo } from '@shared/types'

const api = vi.hoisted(() => ({
  details: vi.fn(),
  setModel: vi.fn(),
  setMode: vi.fn(),
  setEffort: vi.fn(),
  setOutputStyle: vi.fn(),
  refreshContext: vi.fn(),
  mcpToggle: vi.fn(),
  mcpReconnect: vi.fn(),
  rename: vi.fn(),
  rewindPreview: vi.fn(),
  rewind: vi.fn(),
  forkAt: vi.fn(),
  send: vi.fn(),
  start: vi.fn(),
  interrupt: vi.fn(),
  stop: vi.fn()
}))

function ctl(over: Partial<ControlSessionInfo> = {}): ControlSessionInfo {
  return {
    id: 'c1',
    accountId: 'acc1',
    cwd: 'D:/work/alpha',
    state: 'idle',
    permissionMode: 'default',
    sessionId: 'sess1',
    slashCommands: [],
    pendingPermissions: 0,
    queuedTurns: 0,
    ...over
  }
}

function det(over: Partial<ControlDetails> = {}): ControlDetails {
  return {
    controlId: 'c1',
    commands: [],
    agents: [],
    models: [
      { value: 'opus', displayName: 'Opus 4', description: 'Most capable' },
      { value: 'sonnet', displayName: 'Sonnet 4' }
    ],
    availableOutputStyles: ['default', 'Explanatory', 'Learning'],
    mcp: [
      { name: 'github', status: 'connected' },
      { name: 'figma', status: 'needs-auth' },
      { name: 'old', status: 'disabled' }
    ],
    tools: [],
    context: {
      totalTokens: 124000,
      maxTokens: 200000,
      percentage: 62,
      categories: [{ name: 'Messages', tokens: 90000, percentage: 45 }],
      fetchedAt: '2026-11-19T10:00:00Z'
    },
    lastTurn: { input: 1200, output: 800, cacheCreation: 0, cacheRead: 5000, costUsd: 0.0421 },
    sessionCostUsd: 1.5,
    userTurns: [
      { uuid: 'u1', text: 'first prompt', time: '10:00' },
      { uuid: 'u2', text: 'second prompt', time: '10:05' }
    ],
    checkpointing: true,
    title: 'My session',
    ...over
  }
}

function setup(c: ControlSessionInfo, d: ControlDetails = det()): void {
  api.details.mockResolvedValue(d)
  useControlStore.setState({ sessions: [c] })
  useDetailsStore.setState({ byControl: { [c.id]: d } })
}

const renderBar = (c: ControlSessionInfo): ReturnType<typeof render> =>
  render(<ControlBar control={c} projectName="alpha" projectRoot="D:/work/alpha" onAskLead={() => undefined} />)

function mockMatchMedia(width: number): void {
  window.matchMedia = ((q: string) => {
    const max = Number(/max-width:\s*(\d+)px/.exec(q)?.[1] ?? Infinity)
    return {
      matches: width <= max,
      media: q,
      addEventListener() {},
      removeEventListener() {},
      addListener() {},
      removeListener() {},
      dispatchEvent: () => false,
      onchange: null
    }
  }) as unknown as typeof window.matchMedia
}

beforeEach(() => {
  resetConsoleStore()
  Object.values(api).forEach((f) => f.mockReset())
  for (const f of [api.setModel, api.setMode, api.setEffort, api.setOutputStyle, api.refreshContext, api.mcpToggle, api.mcpReconnect, api.rename, api.rewind])
    f.mockResolvedValue({ ok: true })
  api.rewindPreview.mockResolvedValue({ canRewind: true, filesChanged: ['src/a.ts', 'src/b.ts'], insertions: 10, deletions: 3 })
  api.forkAt.mockResolvedValue({ ok: true, controlId: 'c2' })
  ;(window as unknown as { api: unknown }).api = {
    control: { ...api, list: vi.fn().mockResolvedValue([]), onChanged: vi.fn(), onStream: vi.fn(), onDetails: vi.fn() },
    app: { getDefaultCwd: vi.fn().mockResolvedValue('D:/x'), pickFolder: vi.fn() },
    accounts: { resolveFolder: vi.fn().mockResolvedValue({ accountId: 'ask', ruleIndex: -1 }) }
  }
  useControlStore.setState({ sessions: [], streams: {}, startForm: { open: false }, error: undefined })
  useDetailsStore.setState({ byControl: {} })
})
afterEach(() => {
  delete (window as unknown as { api?: unknown }).api
  delete (window as { matchMedia?: unknown }).matchMedia
})

describe('pickers per state', () => {
  it('running session: model from details, effort and output style call the store with the next-turn hint', async () => {
    setup(ctl())
    renderBar(ctl())
    const model = screen.getByRole('combobox', { name: 'Model' })
    expect(within(model).getByRole('option', { name: 'Opus 4' })).toBeInTheDocument()
    expect(within(model).queryByRole('option', { name: 'haiku' })).toBeNull()
    await userEvent.selectOptions(model, 'opus')
    expect(api.setModel).toHaveBeenCalledWith('c1', 'opus')
    await userEvent.selectOptions(screen.getByRole('combobox', { name: 'Effort' }), 'high')
    expect(api.setEffort).toHaveBeenCalledWith('c1', 'high')
    await userEvent.selectOptions(screen.getByRole('combobox', { name: 'Output style' }), 'Learning')
    expect(api.setOutputStyle).toHaveBeenCalledWith('c1', 'Learning')
    expect(screen.getByText('Changes apply from the next turn.')).toBeInTheDocument()
    const mode = screen.getByRole('combobox', { name: 'Permission mode' })
    expect(within(mode).queryByRole('option', { name: 'bypassPermissions' })).toBeNull()
  })

  it('falls back to the static model list when details has no models', () => {
    setup(ctl(), det({ models: [] }))
    renderBar(ctl())
    const model = screen.getByRole('combobox', { name: 'Model' })
    for (const m of ['opus', 'sonnet', 'haiku', 'fable']) expect(within(model).getByRole('option', { name: m })).toBeInTheDocument()
  })

  it('draft: hint says the values are used when the session starts', () => {
    setup(ctl({ state: 'draft', sessionId: undefined }))
    renderBar(ctl({ state: 'draft', sessionId: undefined }))
    expect(screen.getByText('Model, effort, mode and style are used when the session starts.')).toBeInTheDocument()
    expect(screen.queryByText('Changes apply from the next turn.')).toBeNull()
  })

  it('says "applies on next start" when the CLI could not change it live', async () => {
    setup(ctl())
    api.setEffort.mockResolvedValue({ ok: true, reason: 'applies-on-next-start' })
    renderBar(ctl())
    await userEvent.selectOptions(screen.getByRole('combobox', { name: 'Effort' }), 'max')
    expect(await screen.findByText(/Applies on next start/)).toBeInTheDocument()
    expect(screen.queryByRole('alert')).toBeNull()
  })
})

describe('context meter and cost', () => {
  it('shows the label, categories tooltip and refreshes', async () => {
    setup(ctl())
    renderBar(ctl())
    expect(screen.getByText('62% context (124k / 200k)')).toBeInTheDocument()
    const meter = screen.getByRole('meter', { name: 'Context window' })
    expect(meter).toHaveAttribute('data-level', 'ok')
    expect(meter).toHaveAttribute('title', expect.stringContaining('Messages'))
    await userEvent.click(screen.getByRole('button', { name: 'Refresh context usage' }))
    expect(api.refreshContext).toHaveBeenCalledWith('c1')
  })

  it.each([
    [74, 'ok'],
    [75, 'warn'],
    [89, 'warn'],
    [90, 'high']
  ])('%i%% is %s', (pct, level) => {
    const d = det()
    setup(ctl(), det({ context: { ...d.context!, percentage: pct } }))
    renderBar(ctl())
    expect(screen.getByRole('meter', { name: 'Context window' })).toHaveAttribute('data-level', level)
  })

  it('shows last turn tokens/cost and the session total as API-equivalent cost', () => {
    setup(ctl())
    renderBar(ctl())
    expect(screen.getByText(/Last turn: 1\.2k in \/ 800 out \/ 5\.0k cache · \$0\.0421/)).toBeInTheDocument()
    expect(screen.getByText(/Session \$1\.50 \(API-equivalent cost\)/)).toBeInTheDocument()
  })
})

describe('MCP chips', () => {
  it('toggles a connected server off for this session and enables a disabled one', async () => {
    setup(ctl())
    renderBar(ctl())
    await userEvent.click(screen.getByRole('button', { name: 'MCP github: connected' }))
    await userEvent.click(screen.getByRole('menuitem', { name: 'Disable for this session' }))
    expect(api.mcpToggle).toHaveBeenCalledWith('c1', 'github', false)
    await userEvent.click(screen.getByRole('button', { name: 'MCP old: disabled' }))
    await userEvent.click(screen.getByRole('menuitem', { name: 'Enable for this session' }))
    expect(api.mcpToggle).toHaveBeenCalledWith('c1', 'old', true)
  })

  it('reconnects, and needs-auth points to the raw terminal', async () => {
    setup(ctl())
    renderBar(ctl())
    await userEvent.click(screen.getByRole('button', { name: 'MCP figma: needs-auth' }))
    expect(screen.getByText('Authenticate in the Raw terminal: /mcp')).toBeInTheDocument()
    await userEvent.click(screen.getByRole('menuitem', { name: 'Reconnect' }))
    expect(api.mcpReconnect).toHaveBeenCalledWith('c1', 'figma')
  })

  it('Manage servers navigates to the extensions screen', async () => {
    setup(ctl())
    renderBar(ctl())
    await userEvent.click(screen.getByRole('button', { name: 'Manage servers…' }))
    expect(useConsoleStore.getState().screen).toBe('extensions')
  })
})

describe('rename', () => {
  it('edits the title inline and calls rename', async () => {
    setup(ctl())
    renderBar(ctl())
    expect(screen.getByText('My session')).toBeInTheDocument()
    await userEvent.click(screen.getByRole('button', { name: 'Rename' }))
    const input = screen.getByRole('textbox', { name: 'Session title' })
    await userEvent.clear(input)
    await userEvent.type(input, 'Renamed')
    await userEvent.click(screen.getByRole('button', { name: 'Save title' }))
    expect(api.rename).toHaveBeenCalledWith('c1', 'Renamed')
  })
})

describe('checkpoints (R-19, R-31)', () => {
  const open = async (): Promise<void> => {
    await userEvent.click(screen.getByRole('button', { name: 'Checkpoints' }))
  }

  it('rewind needs a dry-run preview and an explicit confirm; lists newest first', async () => {
    setup(ctl())
    renderBar(ctl())
    await open()
    const dlg = screen.getByRole('dialog', { name: 'Checkpoints' })
    expect(within(dlg).getByText(/Rewind restores files edited by Claude in this app session/)).toBeInTheDocument()
    const rewinds = within(dlg).getAllByRole('button', { name: /^Rewind files to/ })
    expect(rewinds[0]).toHaveAccessibleName('Rewind files to: second prompt')
    expect(within(dlg).queryByRole('button', { name: 'Restore files' })).toBeNull()
    await userEvent.click(rewinds[0]!)
    expect(api.rewindPreview).toHaveBeenCalledWith('c1', 'u2')
    expect(api.rewind).not.toHaveBeenCalled()
    expect(await within(dlg).findByText(/2 file\(s\) would change: \+10 \/ -3/)).toBeInTheDocument()
    expect(within(dlg).getByText('src/a.ts')).toBeInTheDocument()
    await userEvent.click(within(dlg).getByRole('button', { name: 'Restore files' }))
    expect(api.rewind).toHaveBeenCalledTimes(1)
    expect(api.rewind).toHaveBeenCalledWith('c1', 'u2')
    expect(await within(dlg).findByText(/Files restored/)).toBeInTheDocument()
  })

  it('cancelling the preview never rewinds', async () => {
    setup(ctl())
    renderBar(ctl())
    await open()
    await userEvent.click(screen.getByRole('button', { name: 'Rewind files to: first prompt' }))
    await userEvent.click(await screen.findByRole('button', { name: 'Cancel' }))
    expect(api.rewind).not.toHaveBeenCalled()
    expect(screen.queryByRole('button', { name: 'Restore files' })).toBeNull()
  })

  it('a preview that cannot rewind offers no confirm', async () => {
    setup(ctl())
    api.rewindPreview.mockResolvedValue({ canRewind: false, filesChanged: [], insertions: 0, deletions: 0, error: 'no checkpoint' })
    renderBar(ctl())
    await open()
    await userEvent.click(screen.getByRole('button', { name: 'Rewind files to: first prompt' }))
    expect(await screen.findByText(/Cannot rewind to this point: no checkpoint/)).toBeInTheDocument()
    expect(screen.queryByRole('button', { name: 'Restore files' })).toBeNull()
  })

  it('is refused while busy, with the reason shown, and nothing is called', async () => {
    setup(ctl({ state: 'busy' }))
    renderBar(ctl({ state: 'busy' }))
    await open()
    const btn = screen.getByRole('button', { name: 'Rewind files to: second prompt' })
    expect(btn).toBeDisabled()
    expect(screen.getByRole('button', { name: 'Fork from here: second prompt' })).toBeDisabled()
    expect(screen.getByRole('note')).toHaveTextContent(/before using checkpoints/)
    await userEvent.click(btn)
    expect(api.rewindPreview).not.toHaveBeenCalled()
    expect(api.rewind).not.toHaveBeenCalled()
  })

  it('fork from here creates a draft and sends nothing', async () => {
    setup(ctl())
    renderBar(ctl())
    await open()
    await userEvent.click(screen.getByRole('button', { name: 'Fork from here: first prompt' }))
    expect(api.forkAt).toHaveBeenCalledWith('c1', 'u1')
    expect(await screen.findByText(/nothing was sent/)).toBeInTheDocument()
    expect(api.send).not.toHaveBeenCalled()
    expect(api.start).not.toHaveBeenCalled()
    expect(api.rewind).not.toHaveBeenCalled()
  })

  it('without file checkpointing rewind is disabled but fork still works', async () => {
    setup(ctl(), det({ checkpointing: false }))
    renderBar(ctl())
    await open()
    expect(screen.getByRole('button', { name: 'Rewind files to: first prompt' })).toBeDisabled()
    expect(screen.getByRole('button', { name: 'Fork from here: first prompt' })).toBeEnabled()
  })
})

describe('R-19 nothing is sent by mounting or changing controls', () => {
  it('only the explicit setters are called', async () => {
    setup(ctl())
    renderBar(ctl())
    await userEvent.selectOptions(screen.getByRole('combobox', { name: 'Effort' }), 'low')
    expect(api.send).not.toHaveBeenCalled()
    expect(api.start).not.toHaveBeenCalled()
  })
})

describe('responsive: narrow width', () => {
  it('collapses secondary controls behind "More controls" and keeps the essentials reachable', async () => {
    mockMatchMedia(800)
    setup(ctl())
    renderBar(ctl())
    expect(screen.getByRole('combobox', { name: 'Model' })).toBeInTheDocument()
    expect(screen.getByRole('combobox', { name: 'Permission mode' })).toBeInTheDocument()
    expect(screen.getByRole('button', { name: 'Checkpoints' })).toBeInTheDocument()
    expect(screen.queryByRole('combobox', { name: 'Effort' })).toBeNull()
    expect(screen.queryByTestId('session-details-strip')).toBeNull()
    await userEvent.click(screen.getByRole('button', { name: 'More controls' }))
    expect(screen.getByRole('combobox', { name: 'Effort' })).toBeInTheDocument()
    const strip = screen.getByTestId('session-details-strip')
    // css is not loaded under vitest: the wrap rule lives in controlBar.css (theme-token stylesheet, no inline styles)
    expect(strip).toHaveClass('ac-ctl-strip')
    expect(readFileSync(resolve(__dirname, '../../src/renderer/src/components/team/controlBar.css'), 'utf8')).toMatch(
      /\.ac-ctl-strip\s*\{[^}]*flex-wrap:\s*wrap/
    )
    expect(within(strip).getByRole('button', { name: 'MCP github: connected' })).toBeInTheDocument()
    await waitFor(() => expect(screen.getByRole('button', { name: 'Fewer controls' })).toBeInTheDocument())
  })

  it('wide window shows everything without the disclosure', () => {
    mockMatchMedia(1440)
    setup(ctl())
    renderBar(ctl())
    expect(screen.queryByRole('button', { name: 'More controls' })).toBeNull()
    expect(screen.getByRole('combobox', { name: 'Effort' })).toBeInTheDocument()
  })
})
