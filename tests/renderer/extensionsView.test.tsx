// @vitest-environment jsdom
import './jestDom'
import { act, fireEvent, render, screen, waitFor, within } from '@testing-library/react'
import userEvent from '@testing-library/user-event'
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest'
import type { CliPreview } from '@shared/types'
import App from '@renderer/App'
import { ExtensionsView } from '@renderer/screens/ExtensionsView'
import { TeamHeader } from '@renderer/components/team/TeamHeader'
import { SHORTCUTS } from '@renderer/hooks/useShortcuts'
import { resetConsoleStore, useConsoleStore } from '@renderer/store/useConsoleStore'
import { useExtensionsStore } from '@renderer/store/useExtensionsStore'
import { useDetailsStore } from '@renderer/store/useDetailsStore'
import { useControlStore } from '@renderer/store/useControlStore'
import { resetLayoutStore } from '@renderer/store/useLayoutStore'
import { seedDemoTeam } from './seedTeam'

vi.mock('@xterm/xterm', () => ({
  Terminal: class {
    open() {}
    write() {}
    dispose() {}
    loadAddon() {}
  }
}))
vi.mock('@xterm/addon-fit', () => ({
  FitAddon: class {
    fit() {}
  }
}))
vi.mock('@xterm/xterm/css/xterm.css', () => ({}))

const SECRET = 'sk-live-SECRET-123'
const pv = (argv: string[], over: Partial<CliPreview> = {}): CliPreview => ({
  previewId: 'pv1',
  argvDisplay: argv,
  cwd: 'D:/work/alpha',
  configDir: 'C:/Users/me/.claude',
  effect: 'Adds the server',
  warnings: ['Starts a process on your machine'],
  ...over
})

function makeApi() {
  return {
    catalog: {
      list: vi.fn(async () => [
        { kind: 'skill', name: 'my-skill', description: 'does things', scope: 'user', path: 'C:/s/SKILL.md' },
        { kind: 'skill', name: 'plug-skill', scope: 'plugin', plugin: 'acme', path: 'C:/p/SKILL.md' },
        { kind: 'agent', name: 'reviewer', description: 'reviews', scope: 'project', path: 'D:/a.md' },
        { kind: 'command', name: 'deploy', scope: 'project', path: 'D:/c.md' },
        { kind: 'output-style', name: 'terse', scope: 'user', path: 'C:/o.md' }
      ]),
      open: vi.fn(async () => ({ ok: true }))
    },
    mcp: {
      list: vi.fn(async () => ({
        ranAt: 'now',
        servers: [
          { name: 'github', scope: 'user', transport: 'http', target: 'https://api.example/mcp?token=***', status: 'connected' }
        ]
      })),
      previewAdd: vi.fn(async (_req: unknown) =>
        pv(['claude', 'mcp', 'add', '--transport', 'http', 'gh', 'https://x/mcp', '--header', 'Authorization: ***'])
      ),
      previewRemove: vi.fn(async () => pv(['claude', 'mcp', 'remove', 'github', '-s', 'user']))
    },
    plugins: {
      list: vi.fn(async () => ({ plugins: [{ id: 'acme@market', name: 'acme', enabled: true, version: '1.0.0' }] })),
      preview: vi.fn(async () => pv(['claude', 'plugin', 'disable', 'acme@market']))
    },
    cli: { apply: vi.fn(async () => ({ ok: true, output: 'Done' })) },
    control: {
      details: vi.fn(async () => null),
      mcpToggle: vi.fn(async () => ({ ok: true })),
      mcpReconnect: vi.fn(async () => ({ ok: true })),
      onDetails: vi.fn(() => () => {}),
      list: vi.fn(async () => []),
      onChanged: vi.fn(),
      onStream: vi.fn()
    }
  }
}
let api: ReturnType<typeof makeApi>

function mockMatchMedia(width: number) {
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
  resetLayoutStore()
  seedDemoTeam()
  useConsoleStore.setState({ screen: 'extensions', team: { ...useConsoleStore.getState().team, cwd: 'D:/work/alpha' } })
  useExtensionsStore.setState({ catalog: [], mcp: null, plugins: [], preview: null, lastRun: null, loading: {}, error: undefined })
  useDetailsStore.setState({ byControl: {} })
  useControlStore.setState({ sessions: [], streams: {} })
  api = makeApi()
  ;(window as unknown as { api: unknown }).api = api
})
afterEach(() => {
  delete (window as unknown as { api?: unknown }).api
  delete (window as { matchMedia?: unknown }).matchMedia
})

describe('T30 Extensions screen', () => {
  it('does not run `claude mcp list` on mount; health check only on click', async () => {
    render(<ExtensionsView />)
    await waitFor(() => expect(api.plugins.list).toHaveBeenCalled())
    expect(api.catalog.list).toHaveBeenCalledWith('D:/work/alpha', expect.any(String))
    expect(api.mcp.list).not.toHaveBeenCalled()
    expect(screen.getByText(/Health has not been checked yet/)).toBeInTheDocument()
    await userEvent.click(screen.getByRole('button', { name: 'Check health' }))
    await waitFor(() => expect(api.mcp.list).toHaveBeenCalledTimes(1))
    expect(await screen.findByText('github')).toBeInTheDocument()
    expect(screen.getByText(/\/mcp in the Raw terminal/)).toBeInTheDocument()
  })

  it('shows the masked target and never a clear secret', async () => {
    render(<ExtensionsView />)
    await userEvent.click(screen.getByRole('button', { name: 'Check health' }))
    expect(await screen.findByText('https://api.example/mcp?token=***')).toBeInTheDocument()
    expect(document.body.textContent).not.toContain(SECRET)
  })

  it('add server: preview first, nothing runs until Run command; the typed secret is never rendered', async () => {
    render(<ExtensionsView />)
    await userEvent.click(screen.getByRole('button', { name: 'Add server…' }))
    await userEvent.type(screen.getByLabelText('Name'), 'gh')
    await userEvent.selectOptions(screen.getByLabelText('Transport'), 'http')
    await userEvent.type(screen.getByLabelText('URL'), 'https://x/mcp')
    await userEvent.click(screen.getByRole('button', { name: 'Add headers' }))
    await userEvent.type(screen.getByLabelText('Headers name 1'), 'Authorization')
    const value = screen.getByLabelText('Headers value 1')
    expect(value).toHaveAttribute('type', 'password')
    await userEvent.type(value, SECRET)
    await userEvent.click(screen.getByRole('button', { name: 'Preview command' }))
    await waitFor(() => expect(api.mcp.previewAdd).toHaveBeenCalledTimes(1))
    expect(api.mcp.previewAdd.mock.calls[0]![0]).toMatchObject({
      name: 'gh',
      transport: 'http',
      commandOrUrl: 'https://x/mcp',
      headers: { Authorization: SECRET }
    })
    const dlg = await screen.findByRole('dialog', { name: 'Run this command?' })
    expect(within(dlg).getByTestId('cli-command').textContent).toBe(
      'claude mcp add --transport http gh https://x/mcp --header Authorization: ***'
    )
    expect(within(dlg).getByText('Starts a process on your machine')).toBeInTheDocument()
    expect(within(dlg).getByText('D:/work/alpha')).toBeInTheDocument()
    expect(document.body.textContent).not.toContain(SECRET)
    expect(api.cli.apply).not.toHaveBeenCalled()
    expect(screen.getByRole('button', { name: 'Cancel' })).toHaveFocus()
    await userEvent.click(within(dlg).getByRole('button', { name: 'Run command' }))
    await waitFor(() => expect(api.cli.apply).toHaveBeenCalledWith('pv1'))
    expect(await screen.findByRole('dialog', { name: 'Command finished' })).toBeInTheDocument()
    expect(screen.getByText('Done')).toBeInTheDocument()
  })

  it('Cancel on the preview runs nothing', async () => {
    render(<ExtensionsView />)
    await userEvent.click(screen.getByRole('button', { name: 'Check health' }))
    await userEvent.click(await screen.findByRole('button', { name: 'Remove github' }))
    expect(api.mcp.previewRemove).toHaveBeenCalledWith('D:/work/alpha', expect.any(String), 'github', 'user')
    await screen.findByRole('dialog', { name: 'Run this command?' })
    await userEvent.click(screen.getByRole('button', { name: 'Cancel' }))
    expect(screen.queryByRole('dialog')).toBeNull()
    expect(api.cli.apply).not.toHaveBeenCalled()
  })

  it('a failed run shows the masked error output', async () => {
    api.cli.apply.mockResolvedValueOnce({ ok: false, reason: 'exit 1', output: 'boom ***' } as never)
    render(<ExtensionsView />)
    await userEvent.click(screen.getByRole('button', { name: 'Check health' }))
    await userEvent.click(await screen.findByRole('button', { name: 'Remove github' }))
    await userEvent.click(await screen.findByRole('button', { name: 'Run command' }))
    expect(await screen.findByRole('dialog', { name: 'Command failed' })).toBeInTheDocument()
    expect(screen.getByText('exit 1')).toBeInTheDocument()
    expect(screen.getByText('boom ***')).toBeInTheDocument()
  })

  it('plugins: toggle goes through a preview and runs only on confirm', async () => {
    render(<ExtensionsView />)
    expect(await screen.findByText('acme')).toBeInTheDocument()
    await userEvent.click(screen.getByRole('button', { name: /^Disable acme/ }))
    expect(api.plugins.preview).toHaveBeenCalledWith(expect.any(String), 'disable', 'acme@market')
    expect(api.cli.apply).not.toHaveBeenCalled()
    await screen.findByRole('dialog', { name: 'Run this command?' })
    await userEvent.click(screen.getByRole('button', { name: 'Run command' }))
    await waitFor(() => expect(api.cli.apply).toHaveBeenCalledTimes(1))
  })

  it('plugins: install by id and uninstall are previewed', async () => {
    render(<ExtensionsView />)
    await screen.findByText('acme')
    await userEvent.type(screen.getByLabelText('Plugin to install'), 'foo@bar')
    await userEvent.click(screen.getByRole('button', { name: 'Install…' }))
    expect(api.plugins.preview).toHaveBeenCalledWith(expect.any(String), 'install', 'foo@bar')
    await userEvent.click(await screen.findByRole('button', { name: 'Cancel' }))
    await userEvent.click(screen.getByRole('button', { name: /^Uninstall acme/ }))
    expect(api.plugins.preview).toHaveBeenCalledWith(expect.any(String), 'uninstall', 'acme@market')
    expect(api.cli.apply).not.toHaveBeenCalled()
  })

  it('catalog: tabs, search, scope badge and open', async () => {
    render(<ExtensionsView />)
    expect(await screen.findByText('my-skill')).toBeInTheDocument()
    expect(screen.getByText('acme', { selector: '.ac-ext-badge' })).toBeInTheDocument()
    expect(screen.queryByText('reviewer')).toBeNull()
    await userEvent.click(screen.getByRole('tab', { name: /Agents/ }))
    expect(screen.getByText('reviewer')).toBeInTheDocument()
    await userEvent.click(screen.getByRole('tab', { name: /Commands/ }))
    expect(screen.getByText('deploy')).toBeInTheDocument()
    await userEvent.click(screen.getByRole('tab', { name: /Output styles/ }))
    expect(screen.getByText('terse')).toBeInTheDocument()
    await userEvent.click(screen.getByRole('tab', { name: /Skills/ }))
    await userEvent.type(screen.getByLabelText('Search catalog'), 'plug')
    expect(screen.queryByText('my-skill')).toBeNull()
    await userEvent.click(screen.getByRole('button', { name: /Open in editor plug-skill/ }))
    expect(api.catalog.open).toHaveBeenCalledWith('C:/p/SKILL.md')
    expect(screen.getByText(/a running session may need a restart/)).toBeInTheDocument()
  })

  it('shows live status of the viewed controlled session and toggles it without any config change', async () => {
    useConsoleStore.setState({
      teamMode: 'live',
      team: { ...useConsoleStore.getState().team, source: 'live', sessionId: 's1', cwd: 'D:/work/alpha' }
    })
    useControlStore.setState({
      sessions: [
        {
          id: 'c1',
          accountId: '',
          cwd: 'D:/work/alpha',
          state: 'idle',
          permissionMode: 'default',
          sessionId: 's1',
          slashCommands: [],
          pendingPermissions: 0,
          queuedTurns: 0
        }
      ] as never
    })
    useDetailsStore.setState({
      byControl: {
        c1: {
          controlId: 'c1',
          mcp: [
            { name: 'github', status: 'connected' },
            { name: 'extra', status: 'failed' }
          ]
        } as never
      }
    })
    render(<ExtensionsView />)
    await userEvent.click(screen.getByRole('button', { name: 'Check health' }))
    expect(await screen.findByText('This session: connected')).toBeInTheDocument()
    await userEvent.click(screen.getByRole('button', { name: /Disable github for this session/ }))
    expect(api.control.mcpToggle).toHaveBeenCalledWith('c1', 'github', false)
    expect(screen.getByText('Other servers in this session')).toBeInTheDocument()
    expect(api.cli.apply).not.toHaveBeenCalled()
  })

  it('narrow width: single-column layout class, controls still reachable', () => {
    mockMatchMedia(800)
    const { container } = render(<ExtensionsView />)
    expect(container.querySelector('.ac-ext')).toHaveClass('is-narrow')
    expect(screen.getByRole('button', { name: 'Add server…' })).toBeInTheDocument()
    expect(screen.getByRole('button', { name: 'Check health' })).toBeInTheDocument()
  })
})

describe('T30 route, header entry and shortcut', () => {
  it('Ctrl+Shift+E opens the Extensions screen from the app, Team view goes back', () => {
    delete (window as unknown as { api?: unknown }).api
    useConsoleStore.setState({ screen: 'team' })
    render(<App />)
    expect(screen.queryByRole('heading', { name: 'Extensions' })).toBeNull()
    fireEvent.keyDown(window, { key: 'E', ctrlKey: true, shiftKey: true })
    expect(screen.getByRole('heading', { name: 'Extensions' })).toBeInTheDocument()
    fireEvent.click(screen.getByRole('button', { name: /Team view/ }))
    expect(screen.queryByRole('heading', { name: 'Extensions' })).toBeNull()
  })

  it('SHORTCUTS help lists Ctrl+Shift+E', () => {
    expect(SHORTCUTS.some((x) => x.keys === 'Ctrl+Shift+E' && /Extensions/.test(x.action))).toBe(true)
  })

  it('header: Extensions button navigates (wide)', async () => {
    mockMatchMedia(1500)
    useConsoleStore.setState({ screen: 'team' })
    render(<TeamHeader />)
    await userEvent.click(screen.getByRole('button', { name: 'Extensions' }))
    expect(useConsoleStore.getState().screen).toBe('extensions')
  })

  it('header at narrow width: Extensions lives in the overflow menu', async () => {
    mockMatchMedia(800)
    useConsoleStore.setState({ screen: 'team' })
    render(<TeamHeader />)
    expect(screen.queryByRole('button', { name: 'Extensions' })).toBeNull()
    await userEvent.click(screen.getByRole('button', { name: 'More header actions' }))
    await act(async () => {})
    await userEvent.click(screen.getByRole('menuitem', { name: 'Extensions' }))
    expect(useConsoleStore.getState().screen).toBe('extensions')
  })
})
