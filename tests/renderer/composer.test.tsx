// @vitest-environment jsdom
import './jestDom'
import { fireEvent, render, screen, waitFor, within } from '@testing-library/react'
import userEvent from '@testing-library/user-event'
import { useState } from 'react'
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest'
import { Composer } from '@renderer/components/chat/Composer'
import type { ComposerProps } from '@renderer/components/chat/Composer'
import { ChatView } from '@renderer/components/chat/ChatView'
import { ControlComposer, routeMessage } from '@renderer/components/team/Composer'
import { PermissionCard } from '@renderer/components/team/PermissionCard'
import { resetConsoleStore, useConsoleStore } from '@renderer/store/useConsoleStore'
import { useControlStore } from '@renderer/store/useControlStore'
import { useDetailsStore } from '@renderer/store/useDetailsStore'
import { useExtensionsStore } from '@renderer/store/useExtensionsStore'
import { resetLayoutStore } from '@renderer/store/useLayoutStore'
import { mockTeamSnapshot } from '@shared/mock'
import type { ControlDetails, ControlSessionInfo, PermissionPrompt, SlashCommandInfo } from '@shared/types'

function Host(p: Partial<ComposerProps> & { initial?: string }) {
  const [v, setV] = useState(p.initial ?? '')
  return <Composer value={v} onChange={setV} onSend={() => {}} target="to lead" {...p} />
}
const box = () => screen.getByRole('textbox', { name: 'Message' }) as HTMLTextAreaElement

describe('T33 composer', () => {
  it('never sends on mount, typing or paste (R-19)', async () => {
    const onSend = vi.fn()
    render(<Host onSend={onSend} initial="draft" />)
    expect(onSend).not.toHaveBeenCalled()
    await userEvent.type(box(), ' more')
    await userEvent.paste('pasted\ntext\n')
    expect(onSend).not.toHaveBeenCalled()
  })

  it('Enter sends exactly once', async () => {
    const onSend = vi.fn()
    render(<Host onSend={onSend} initial="hello" />)
    box().focus()
    await userEvent.keyboard('{Enter}')
    expect(onSend).toHaveBeenCalledTimes(1)
  })

  it('Shift+Enter inserts a newline and does not send', async () => {
    const onSend = vi.fn()
    render(<Host onSend={onSend} />)
    await userEvent.type(box(), 'a{Shift>}{Enter}{/Shift}b')
    expect(box().value).toBe('a\nb')
    expect(onSend).not.toHaveBeenCalled()
  })

  it('empty or whitespace text does not send', async () => {
    const onSend = vi.fn()
    render(<Host onSend={onSend} initial="   " />)
    box().focus()
    await userEvent.keyboard('{Enter}')
    expect(onSend).not.toHaveBeenCalled()
    expect(screen.getByRole('button', { name: 'Send' })).toBeDisabled()
  })

  it('the Send button sends once', async () => {
    const onSend = vi.fn()
    render(<Host onSend={onSend} initial="hi" />)
    await userEvent.click(screen.getByRole('button', { name: 'Send' }))
    expect(onSend).toHaveBeenCalledTimes(1)
  })

  it('Enter during IME composition does not send', () => {
    const onSend = vi.fn()
    render(<Host onSend={onSend} initial="x" />)
    fireEvent.keyDown(box(), { key: 'Enter', isComposing: true })
    expect(onSend).not.toHaveBeenCalled()
  })

  it('Esc blurs the field', async () => {
    render(<Host />)
    box().focus()
    expect(box()).toHaveFocus()
    await userEvent.keyboard('{Escape}')
    expect(box()).not.toHaveFocus()
  })

  it('disabled: no input, no send, shows the reason', () => {
    const onSend = vi.fn()
    render(<Host onSend={onSend} initial="hi" disabled disabledReason="Runs in a terminal" />)
    expect(box()).toBeDisabled()
    expect(screen.getByRole('button', { name: 'Send' })).toBeDisabled()
    expect(screen.getByText('Runs in a terminal')).toBeInTheDocument()
    fireEvent.keyDown(box(), { key: 'Enter' })
    expect(onSend).not.toHaveBeenCalled()
  })

  it('shows target and state, starts at 2 rows, and exposes the T28 slots', () => {
    const onPaste = vi.fn()
    render(
      <Host
        target="to @alice"
        stateLabel="busy"
        toolbar={<button>tb</button>}
        beforeInput={<div>chips</div>}
        suggestions={<div>popover</div>}
        onPaste={onPaste}
      />
    )
    expect(screen.getByText('to @alice')).toBeInTheDocument()
    expect(screen.getByText('busy')).toBeInTheDocument()
    for (const t of ['tb', 'chips', 'popover']) expect(screen.getByText(t)).toBeInTheDocument()
    expect(box().rows).toBe(2)
    fireEvent.paste(box(), { clipboardData: { getData: () => 'x', files: [], items: [] } })
    expect(onPaste).toHaveBeenCalledTimes(1)
  })

  it('height is capped to about 40 percent of the view and then scrolls', () => {
    const ch = vi.spyOn(HTMLElement.prototype, 'clientHeight', 'get').mockReturnValue(500)
    const sh = vi.spyOn(HTMLTextAreaElement.prototype, 'scrollHeight', 'get').mockReturnValue(900)
    render(<Host initial={'l\n'.repeat(60)} />)
    expect(box().style.height).toBe('200px')
    expect(box().style.overflowY).toBe('auto')
    sh.mockRestore()
    ch.mockRestore()
  })
})

// ---------------------------------------------------------------------------------------------------------------
// T28: palette, @-mentions, image attach, question and plan cards
// ---------------------------------------------------------------------------------------------------------------
const api = vi.hoisted(() => ({
  send: vi.fn(),
  sendRich: vi.fn(),
  fileSuggestions: vi.fn(),
  answer: vi.fn(),
  setMode: vi.fn(),
  getPlan: vi.fn()
}))

const ctl = (over: Partial<ControlSessionInfo> = {}): ControlSessionInfo => ({
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
})
const cmd = (name: string, source: SlashCommandInfo['source'], description: string, argumentHint?: string): SlashCommandInfo => ({
  name,
  source,
  description,
  ...(argumentHint ? { argumentHint } : {})
})
const details = (commands: SlashCommandInfo[]): ControlDetails => ({
  controlId: 'c1',
  commands,
  agents: [],
  models: [],
  availableOutputStyles: [],
  mcp: [],
  tools: [],
  sessionCostUsd: 0,
  userTurns: [],
  checkpointing: true
})
const agentName = (): string => mockTeamSnapshot.agents.find((a) => a.name !== 'lead' && /^[a-z]+$/i.test(a.name))!.name

const field = (): HTMLTextAreaElement => screen.getByRole('textbox', { name: 'Message' }) as HTMLTextAreaElement
const png = (name = 'shot.png', bytes = 10, type = 'image/png'): File => new File([new Uint8Array(bytes)], name, { type })
const mountComposer = (control: ControlSessionInfo = ctl()) => {
  useControlStore.setState({ sessions: [control] })
  return render(<ControlComposer control={control} demo={false} disabled={false} />)
}

beforeEach(() => {
  resetConsoleStore()
  resetLayoutStore()
  window.localStorage.clear()
  Object.values(api).forEach((f) => f.mockReset())
  api.send.mockResolvedValue({ ok: true })
  api.sendRich.mockResolvedValue({ ok: true })
  api.answer.mockResolvedValue({ ok: true })
  api.setMode.mockResolvedValue({ ok: true })
  api.fileSuggestions.mockImplementation(async () => [{ path: 'src/app.ts' }, { path: 'src/lib/' }])
  api.getPlan.mockResolvedValue({ exists: false })
  useControlStore.setState({ sessions: [], streams: {}, startForm: { open: false }, error: undefined })
  useDetailsStore.setState({ byControl: {} })
  useExtensionsStore.setState({ catalog: [] })
  ;(window as unknown as { api: unknown }).api = { control: { ...api }, app: {} }
})
afterEach(() => {
  delete (window as unknown as { api?: unknown }).api
  delete (window as { matchMedia?: unknown }).matchMedia
})

describe('T28 slash palette', () => {
  const seedCommands = () =>
    useDetailsStore.setState({
      byControl: {
        c1: details([
          cmd('deploy', 'project', 'Deploy the app', '<env>'),
          cmd('review-pr', 'skill', 'Review a pull request'),
          cmd('mcp__github__issue', 'mcp', 'Open an issue'),
          cmd('compact', 'builtin', 'Compact the conversation')
        ])
      }
    })

  it('groups by source with descriptions and argument hints; keyboard picks edit the draft only', async () => {
    seedCommands()
    mountComposer()
    await userEvent.type(field(), '/')
    const list = screen.getByRole('listbox', { name: 'Slash commands' })
    const groups = within(list).getAllByRole('presentation').map((g) => g.textContent)
    expect(groups.slice(0, 4)).toEqual(['Built-in', 'Project', 'Skills', 'MCP'])
    const deploy = within(list).getByRole('option', { name: /^\/deploy/ })
    expect(deploy).toHaveTextContent('<env>')
    expect(deploy).toHaveTextContent('Deploy the app')
    expect(within(list).getAllByRole('option')[0]).toHaveTextContent('/compact')

    await userEvent.type(field(), 'dep')
    expect(within(list).getAllByRole('option')).toHaveLength(1)
    await userEvent.keyboard('{ArrowDown}')
    expect(field()).toHaveAttribute('aria-activedescendant', 'ac-slash-0')
    expect(field()).toHaveAttribute('aria-controls', 'ac-slash-list')
    await userEvent.keyboard('{Enter}')
    expect(field().value).toBe('/deploy ')
    expect(screen.queryByRole('listbox')).toBeNull()
    expect(api.send).not.toHaveBeenCalled()
    expect(api.sendRich).not.toHaveBeenCalled()
  })

  it('Tab picks the first row, Esc closes the list, clicking a row never sends', async () => {
    seedCommands()
    mountComposer()
    await userEvent.type(field(), '/review-')
    await userEvent.keyboard('{Tab}')
    expect(field().value).toBe('/review-pr ')
    await userEvent.clear(field())
    await userEvent.type(field(), '/')
    await userEvent.keyboard('{Escape}')
    expect(screen.queryByRole('listbox')).toBeNull()
    await userEvent.clear(field())
    await userEvent.type(field(), '/dep')
    await userEvent.click(screen.getByRole('option', { name: /^\/deploy/ }))
    expect(field().value).toBe('/deploy ')
    expect(api.send).not.toHaveBeenCalled()
  })

  it('before the first send the built-in fallback list is shown with a note', async () => {
    mountComposer(ctl({ state: 'draft', sessionId: undefined }))
    await userEvent.type(field(), '/')
    expect(screen.getByRole('option', { name: /^\/help/ })).toHaveTextContent('Show help')
    expect(screen.getByText('full list after the session starts')).toBeInTheDocument()
  })

  it('refines an unknown source from the loaded catalog', async () => {
    useExtensionsStore.setState({
      catalog: [{ kind: 'skill', name: 'pdf', description: 'Work with PDFs', scope: 'user', path: 'p' }]
    })
    mountComposer(ctl({ slashCommands: ['/pdf'] }))
    await userEvent.type(field(), '/pd')
    expect(screen.getByRole('presentation')).toHaveTextContent('Skills')
    expect(screen.getByRole('option', { name: /^\/pdf/ })).toHaveTextContent('Work with PDFs')
  })
})

describe('T28 @-mentions', () => {
  it('suggests files and folders, inserts the relative path, and sends nothing', async () => {
    mountComposer()
    await userEvent.type(field(), 'look at @sr')
    const list = await screen.findByRole('listbox', { name: 'Files and folders' })
    expect(api.fileSuggestions).toHaveBeenCalledWith('c1', 'D:/work/alpha', 'sr')
    await userEvent.click(within(list).getByRole('option', { name: /app\.ts/ }))
    expect(field().value).toBe('look at @src/app.ts ')
    expect(screen.queryByRole('listbox')).toBeNull()

    await userEvent.type(field(), '@sr')
    await userEvent.click(await screen.findByRole('option', { name: /src\/lib\// }))
    expect(field().value).toBe('look at @src/app.ts @src/lib/')
    expect(api.send).not.toHaveBeenCalled()
    expect(api.sendRich).not.toHaveBeenCalled()
  })

  it('keyboard: arrows and Tab pick; Esc closes; a draft session passes a null control id', async () => {
    mountComposer(ctl({ state: 'draft', sessionId: undefined }))
    await userEvent.type(field(), '@s')
    await screen.findByRole('listbox')
    expect(api.fileSuggestions).toHaveBeenCalledWith(null, 'D:/work/alpha', 's')
    await userEvent.keyboard('{ArrowDown}{ArrowDown}{Tab}')
    expect(field().value).toBe('@src/lib/')
    await userEvent.clear(field())
    await userEvent.type(field(), 'x @a')
    await screen.findByRole('listbox')
    await userEvent.keyboard('{Escape}')
    expect(screen.queryByRole('listbox')).toBeNull()
    expect(api.send).not.toHaveBeenCalled()
  })

  it('a leading @agent still routes: no picker, Enter sends to the agent', async () => {
    const name = agentName()
    const t = structuredClone(mockTeamSnapshot)
    useConsoleStore.setState({ team: t, liveTeam: t, teamMode: 'live' })
    mountComposer()
    await userEvent.type(field(), `@${name} please help`)
    await new Promise((r) => setTimeout(r, 200))
    expect(screen.queryByRole('listbox')).toBeNull()
    expect(api.fileSuggestions).not.toHaveBeenCalled()
    expect(screen.getByText(`to @${name}`)).toBeInTheDocument()
    await userEvent.keyboard('{Enter}')
    expect(api.send).toHaveBeenCalledTimes(1)
    expect(api.send.mock.calls[0]![1]).toContain(`@${name}:`)
  })

  it('a leading @path (not an agent) is sent as plain text', async () => {
    expect(routeMessage('@src/a.ts explain', [{ id: 'a', name: 'bob' }])).toEqual({ kind: 'send', text: '@src/a.ts explain' })
    expect(routeMessage('@nobody hi', [{ id: 'a', name: 'bob' }])).toEqual({ kind: 'error', reason: 'unknown-agent' })
    mountComposer()
    await userEvent.type(field(), '@src/a.ts explain{Enter}')
    expect(api.send).toHaveBeenCalledWith('c1', '@src/a.ts explain')
  })
})

describe('T28 images', () => {
  it('pasting an image attaches a chip and sends nothing (R-19); Enter then calls sendRich with 1 image', async () => {
    mountComposer()
    await userEvent.type(field(), 'what is this?')
    fireEvent.paste(field(), { clipboardData: { files: [png('clip.png')], items: [], getData: () => '' } })
    expect(await screen.findByRole('button', { name: 'Remove clip.png' })).toBeInTheDocument()
    expect(api.send).not.toHaveBeenCalled()
    expect(api.sendRich).not.toHaveBeenCalled()
    await userEvent.keyboard('{Enter}')
    await waitFor(() => expect(api.sendRich).toHaveBeenCalledTimes(1))
    const [id, text, imgs] = api.sendRich.mock.calls[0]!
    expect(id).toBe('c1')
    expect(text).toBe('what is this?')
    expect(imgs).toHaveLength(1)
    expect(imgs[0]).toMatchObject({ mediaType: 'image/png', name: 'clip.png' })
    expect(typeof imgs[0].dataBase64).toBe('string')
    expect(api.send).not.toHaveBeenCalled()
    await waitFor(() => expect(screen.queryByRole('button', { name: 'Remove clip.png' })).toBeNull())
    expect(field().value).toBe('')
  })

  it('text paste is left alone', () => {
    mountComposer()
    const e = fireEvent.paste(field(), { clipboardData: { files: [], items: [], getData: () => 'hello' } })
    expect(e).toBe(true)
    expect(screen.queryByRole('list', { name: 'Attached images' })).toBeNull()
  })

  it('dropping and the attach button add images without sending; remove works', async () => {
    mountComposer()
    const form = field().closest('form')!
    fireEvent.drop(form, { dataTransfer: { types: ['Files'], files: [png('drop.png')] } })
    expect(await screen.findByRole('button', { name: 'Remove drop.png' })).toBeInTheDocument()
    expect(screen.getByRole('button', { name: 'Attach image' })).toBeEnabled()
    await userEvent.upload(screen.getByLabelText('Attach image file'), png('pick.jpg', 10, 'image/jpeg'))
    expect(await screen.findByRole('button', { name: 'Remove pick.jpg' })).toBeInTheDocument()
    expect(api.send).not.toHaveBeenCalled()
    expect(api.sendRich).not.toHaveBeenCalled()
    await userEvent.click(screen.getByRole('button', { name: 'Remove drop.png' }))
    expect(screen.queryByRole('button', { name: 'Remove drop.png' })).toBeNull()
  })

  it('rejects oversized, unsupported and too many images with a clear error', async () => {
    mountComposer()
    const paste = (f: File) => fireEvent.paste(field(), { clipboardData: { files: [f], items: [], getData: () => '' } })
    paste(png('big.png', 5 * 1024 * 1024 + 1))
    expect(await screen.findByRole('alert')).toHaveTextContent('"big.png" is larger than 5 MB')
    fireEvent.drop(field().closest('form')!, { dataTransfer: { types: ['Files'], files: [png('a.pdf', 5, 'application/pdf')] } })
    expect(await screen.findByRole('alert')).toHaveTextContent('not a supported image')
    for (let i = 0; i < 5; i++) paste(png(`i${i}.png`))
    await screen.findByRole('button', { name: 'Remove i4.png' })
    paste(png('i5.png'))
    expect(await screen.findByRole('alert')).toHaveTextContent('up to 5 images')
    expect(screen.queryByRole('button', { name: 'Remove i5.png' })).toBeNull()
    expect(api.sendRich).not.toHaveBeenCalled()
  })
})

describe('T28 composer behaviour', () => {
  it('prompt history: Up at the start of the caret recalls earlier sends, Down restores the draft', async () => {
    mountComposer()
    await userEvent.type(field(), 'first{Enter}')
    await waitFor(() => expect(field().value).toBe(''))
    await userEvent.type(field(), 'second{Enter}')
    await waitFor(() => expect(field().value).toBe(''))
    await userEvent.type(field(), 'new')
    await userEvent.keyboard('{Home}{ArrowUp}')
    expect(field().value).toBe('second')
    await userEvent.keyboard('{ArrowUp}')
    expect(field().value).toBe('first')
    await userEvent.keyboard('{ArrowDown}{ArrowDown}')
    expect(field().value).toBe('new')
    expect(api.send).toHaveBeenCalledTimes(2)
  })

  it('Ctrl+Enter option is remembered: Enter adds a line, Ctrl+Enter sends', async () => {
    mountComposer()
    await userEvent.click(screen.getByRole('button', { name: 'Ctrl+Enter to send' }))
    expect(window.localStorage.getItem('ac.ctrlEnterSend')).toBe('1')
    await userEvent.type(field(), 'a{Enter}b')
    expect(field().value).toBe('a\nb')
    expect(api.send).not.toHaveBeenCalled()
    await userEvent.keyboard('{Control>}{Enter}{/Control}')
    expect(api.send).toHaveBeenCalledWith('c1', 'a\nb')
  })

  it('a failed send keeps the draft and shows the reason', async () => {
    api.send.mockResolvedValue({ ok: false, reason: 'not-running' })
    mountComposer()
    await userEvent.type(field(), 'hello{Enter}')
    expect(await screen.findByRole('alert')).toHaveTextContent('not running')
    expect(field().value).toBe('hello')
  })

  it('nothing is sent on mount or when a toolbar button is used', async () => {
    mountComposer()
    await userEvent.click(screen.getByRole('button', { name: 'Ctrl+Enter to send' }))
    expect(api.send).not.toHaveBeenCalled()
    expect(api.sendRich).not.toHaveBeenCalled()
  })

  it('narrow width: the Chat view keeps toolbar, palette and Send usable', async () => {
    Object.defineProperty(window, 'innerWidth', { configurable: true, value: 600 })
    window.matchMedia = ((q: string) => ({
      matches: 600 <= Number(/max-width:\s*(\d+)px/.exec(q)?.[1] ?? Infinity),
      media: q,
      addEventListener() {},
      removeEventListener() {},
      addListener() {},
      removeListener() {},
      dispatchEvent: () => false,
      onchange: null
    })) as unknown as typeof window.matchMedia
    const t = { ...structuredClone(mockTeamSnapshot), source: 'live' as const, sessionId: 'sess1', cwd: 'D:/work/alpha' }
    useConsoleStore.setState({ team: t, liveTeam: t, teamMode: 'live' })
    useControlStore.setState({ sessions: [ctl()] })
    render(<ChatView />)
    expect(screen.getByRole('region', { name: 'Chat' })).toHaveAttribute('data-narrow', 'true')
    expect(screen.getByRole('button', { name: 'Attach image' })).toBeVisible()
    expect(screen.getByRole('button', { name: 'Send' })).toBeInTheDocument()
    await userEvent.type(field(), '/co')
    expect(screen.getByRole('listbox', { name: 'Slash commands' })).toBeInTheDocument()
    expect(api.send).not.toHaveBeenCalled()
    const css = (await import('node:fs')).readFileSync('src/renderer/src/components/chat/chat.css', 'utf8')
    expect(css).toMatch(/@media \(max-width: 899px\)[^@]*\.ac-pop \{[^}]*max-height: 40vh/)
  })
})

describe('T28 question and plan cards', () => {
  const ask = (over: Partial<PermissionPrompt> = {}): PermissionPrompt => ({
    requestId: 'q1',
    toolName: 'AskUserQuestion',
    displayName: 'AskUserQuestion',
    inputPreview: JSON.stringify({
      questions: [
        {
          question: 'Which library?',
          header: 'Lib',
          multiSelect: false,
          options: [
            { label: 'date-fns', description: 'Small and modular' },
            { label: 'dayjs', description: 'Tiny' }
          ]
        },
        {
          question: 'Which checks?',
          multiSelect: true,
          options: [{ label: 'lint' }, { label: 'types' }, { label: 'tests' }]
        }
      ]
    }),
    receivedAt: '2026-11-19T10:00:00Z',
    ...over
  })

  it('AskUserQuestion: answers go back as comma-joined labels in `answers`', async () => {
    const onAnswer = vi.fn()
    render(<PermissionCard prompt={ask()} onAnswer={onAnswer} />)
    expect(screen.getByText('Small and modular')).toBeInTheDocument()
    const send = screen.getByRole('button', { name: 'Send answers' })
    expect(send).toBeDisabled()
    await userEvent.click(screen.getByRole('radio', { name: /dayjs/ }))
    await userEvent.click(screen.getByRole('checkbox', { name: 'lint' }))
    await userEvent.click(screen.getByRole('checkbox', { name: 'tests' }))
    await userEvent.click(screen.getByRole('checkbox', { name: 'Other' }))
    await userEvent.type(screen.getByLabelText('Other answer for: Which checks?'), 'e2e')
    expect(onAnswer).not.toHaveBeenCalled()
    await userEvent.click(send)
    expect(onAnswer).toHaveBeenCalledWith({
      behavior: 'allow',
      answers: { 'Which library?': 'dayjs', 'Which checks?': 'lint, tests, e2e' }
    })
  })

  it('AskUserQuestion: Other free text for a single choice, and Dismiss denies', async () => {
    const onAnswer = vi.fn()
    const one = ask({ inputPreview: JSON.stringify({ questions: [{ question: 'Name?', multiSelect: false, options: [{ label: 'A' }] }] }) })
    render(<PermissionCard prompt={one} onAnswer={onAnswer} />)
    await userEvent.click(screen.getByRole('radio', { name: 'Other' }))
    await userEvent.type(screen.getByLabelText('Other answer for: Name?'), 'Zed')
    await userEvent.click(screen.getByRole('button', { name: 'Send answers' }))
    expect(onAnswer).toHaveBeenLastCalledWith({ behavior: 'allow', answers: { 'Name?': 'Zed' } })
    await userEvent.click(screen.getByRole('button', { name: 'Dismiss' }))
    expect(onAnswer).toHaveBeenLastCalledWith({ behavior: 'deny', message: 'User dismissed the question' })
  })

  it('an unparseable AskUserQuestion falls back to the generic permission card', () => {
    render(<PermissionCard prompt={ask({ inputPreview: '{"questions":[{"que' })} onAnswer={() => {}} />)
    expect(screen.getByRole('button', { name: 'Allow' })).toBeInTheDocument()
  })

  const plan = (text = '# Plan\n<b>not html</b>'): PermissionPrompt => ({
    requestId: 'p1',
    toolName: 'ExitPlanMode',
    displayName: 'ExitPlanMode',
    inputPreview: JSON.stringify({ plan: text }),
    receivedAt: '2026-11-19T10:00:00Z'
  })

  it('plan card renders plain text and approves / keeps planning', async () => {
    const onAnswer = vi.fn()
    const { container } = render(<PermissionCard prompt={plan()} controlId="c1" onAnswer={onAnswer} />)
    expect(screen.getByLabelText('Plan').textContent).toBe('# Plan\n<b>not html</b>')
    expect(container.querySelector('b')).toBeNull()
    await userEvent.click(screen.getByRole('button', { name: 'Approve plan' }))
    expect(onAnswer).toHaveBeenLastCalledWith({ behavior: 'allow' })
    expect(api.setMode).not.toHaveBeenCalled()

    await userEvent.click(screen.getByRole('button', { name: 'Approve + auto-accept edits' }))
    expect(onAnswer).toHaveBeenLastCalledWith({ behavior: 'allow' })
    expect(api.setMode).toHaveBeenCalledWith('c1', 'acceptEdits')

    await userEvent.click(screen.getByRole('button', { name: 'Keep planning' }))
    expect(onAnswer).toHaveBeenLastCalledWith({ behavior: 'deny' })
    await userEvent.type(screen.getByLabelText('Feedback for Claude (optional)'), ' split step 2 ')
    await userEvent.click(screen.getByRole('button', { name: 'Keep planning' }))
    expect(onAnswer).toHaveBeenLastCalledWith({ behavior: 'deny', message: 'split step 2' })
  })

  it('a clipped plan preview falls back to the plan file', async () => {
    api.getPlan.mockResolvedValue({ exists: true, content: '# Full plan' })
    const clipped = { ...plan(), inputPreview: '{"plan":"# Long pl' }
    render(<PermissionCard prompt={clipped} controlId="c1" onAnswer={() => {}} />)
    expect((await screen.findByLabelText('Plan')).textContent).toBe('# Full plan')
    expect(api.getPlan).toHaveBeenCalledWith('c1')
  })
})
