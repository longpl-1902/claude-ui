import { useEffect, useState } from 'react'
import type {
  ControlPermissionMode,
  Effort,
  ControlResume,
  ControlSessionInfo,
  ControlStartRequest,
  FolderResolution
} from '@shared/types'
import { useConsoleStore } from '../../store/useConsoleStore'
import { useControlStore } from '../../store/useControlStore'
import { useDetailsStore } from '../../store/useDetailsStore'
import { Button } from '../ui/Button'
import { ContextMeter } from './ContextMeter'
import { McpChips } from './McpChips'
import { RewindDialog } from './RewindDialog'
import { isKnownReason, reasonText } from '../ui/reasonText'
import './teamCenter.css'
import './controlBar.css'

// D8: bypassPermissions is intentionally not offered.
const MODES: ControlPermissionMode[] = ['default', 'acceptEdits', 'plan', 'auto', 'dontAsk']
const MODELS = ['opus', 'sonnet', 'haiku', 'fable']
const MODEL_RE = /^[A-Za-z0-9._[\]-]{1,64}$/
const CUSTOM = '__custom__'
const DEFAULT_MODEL = ''
const EFFORTS: Effort[] = ['low', 'medium', 'high', 'xhigh', 'max']
const NARROW_QUERY = '(max-width: 899px)'
const NEXT_START = 'Applies on next start: the running session could not change this live.'

const usd = (n: number): string => `$${n.toFixed(n < 0.1 ? 4 : 2)}`
const tok = (n: number): string => (n >= 1000 ? `${(n / 1000).toFixed(1)}k` : String(n))

function useNarrow(): boolean {
  const query = (): boolean =>
    typeof window !== 'undefined' && typeof window.matchMedia === 'function' && window.matchMedia(NARROW_QUERY).matches
  const [narrow, setNarrow] = useState(query)
  useEffect(() => {
    if (typeof window === 'undefined' || typeof window.matchMedia !== 'function') return
    const mq = window.matchMedia(NARROW_QUERY)
    const on = (): void => setNarrow(mq.matches)
    on()
    mq.addEventListener?.('change', on)
    return () => mq.removeEventListener?.('change', on)
  }, [])
  return narrow
}

export type StartOption = 'new' | 'continue' | 'resume' | 'fork'

const STATE_LABEL: Record<string, string> = {
  draft: 'Not started',
  starting: 'Starting',
  idle: 'Ready',
  busy: 'Working',
  stopping: 'Stopping',
  exited: 'Exited'
}

const BLOCK_TEXT: Record<string, string> = {
  'account-locked': 'This folder already has a session on another account. Stop it first, or turn off the lock in Accounts.',
  'pty-unavailable': 'Terminal support (node-pty) is not available in this build.',
  'claude-not-found': 'Could not find the claude CLI on PATH.',
  'invalid-args': 'Those start options are not valid.',
  'session-live-elsewhere':
    'That session is running somewhere else (VS Code or a terminal). Fork it instead of resuming it.'
}
const blockText = (r: string): string =>
  BLOCK_TEXT[r] ?? (isKnownReason(r) ? reasonText(r) : `Could not start the session (${r}).`)

export const ASK_LEAD_TEXT = 'Start a teammate with the Agent tool (name: "", task: )'

export interface ControlBarProps {
  control?: ControlSessionInfo
  projectName: string
  projectRoot?: string
  /** Selected session the Resume / Fork options act on. */
  sessionId?: string
  sessionLive?: boolean
  /** Option to preselect when the start form opens (set by "Fork here" / "Resume here"). */
  preset?: { option: StartOption; n: number }
  onAskLead(): void
}

export function ControlBar({
  control,
  projectName,
  projectRoot,
  sessionId,
  sessionLive,
  preset,
  onAskLead
}: ControlBarProps): JSX.Element {
  const form = useControlStore((s) => s.startForm)
  const closeForm = useControlStore((s) => s.closeStartForm)
  const start = useControlStore((s) => s.start)
  const interrupt = useControlStore((s) => s.interrupt)
  const stop = useControlStore((s) => s.stop)
  const setModel = useControlStore((s) => s.setModel)
  const setMode = useControlStore((s) => s.setMode)
  const accounts = useConsoleStore((s) => s.accounts.accounts)
  const teamCwd = useConsoleStore((s) => s.team.cwd)

  const live = control !== undefined && control.state !== 'exited'
  const busy = control?.state === 'busy'

  // --- running-session controls
  const details = useDetailsStore((s) => (control ? s.byControl[control.id] : undefined))
  const detailsLoad = useDetailsStore((s) => s.load)
  const refreshContext = useDetailsStore((s) => s.refreshContext)
  const narrow = useNarrow()
  const [moreOpen, setMoreOpen] = useState(false)
  const [rewindOpen, setRewindOpen] = useState(false)
  const [renaming, setRenaming] = useState<string | null>(null)
  const [liveNote, setLiveNote] = useState('')
  const controlId = control?.id
  const isLive = control !== undefined && control.state !== 'exited'
  useEffect(() => {
    if (controlId && isLive) void detailsLoad(controlId)
  }, [controlId, isLive, detailsLoad])
  const modelList: { value: string; label: string; title?: string }[] =
    details && details.models.length > 0
      ? details.models.map((m) => ({
          value: m.value,
          label: m.displayName,
          ...(m.description ? { title: m.description } : {})
        }))
      : MODELS.map((m) => ({ value: m, label: m }))
  const known = control?.model !== undefined && modelList.some((m) => m.value === control.model)
  const [customLive, setCustomLive] = useState(false)
  const [customLiveText, setCustomLiveText] = useState('')
  const liveModelValue = customLive || (control?.model && !known) ? CUSTOM : (control?.model ?? DEFAULT_MODEL)
  const liveCustomValid = MODEL_RE.test(customLiveText) && !customLiveText.startsWith('-')
  const [liveError, setLiveError] = useState('')
  const report = (r: { ok: boolean; reason?: string }): void => {
    setLiveError(r.ok ? '' : (isKnownReason(r.reason) ? reasonText(r.reason) : `Could not change that (${r.reason ?? 'failed'}).`))
    setLiveNote(r.ok && r.reason === 'applies-on-next-start' ? NEXT_START : '')
  }

  // --- start form
  const [folder, setFolder] = useState('')
  const [resolution, setResolution] = useState<FolderResolution | null>(null)
  const [picked, setPicked] = useState('')
  const [option, setOption] = useState<StartOption>('new')
  const [model, setModelSel] = useState(DEFAULT_MODEL)
  const [customModel, setCustomModel] = useState('')
  const [mode, setModeSel] = useState<ControlPermissionMode>('default')
  const [busyStart, setBusyStart] = useState(false)
  const [error, setError] = useState('')
  const [warnings, setWarnings] = useState(false)

  useEffect(() => {
    if (!form.open) return
    setError('')
    setWarnings(false)
    setPicked(form.accountId ?? '')
    setFolder(form.cwd ?? projectRoot ?? teamCwd ?? '')
    // Only re-seed when the form opens.
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [form.open])

  useEffect(() => {
    if (form.open) setOption(preset?.option ?? 'new')
  }, [form.open, preset])

  useEffect(() => {
    if (!form.open || folder) return
    let cancelled = false
    const p = window.api?.app?.getDefaultCwd?.()
    if (p) {
      void p.then(
        (c) => {
          if (!cancelled && c) setFolder((f) => f || c)
        },
        () => undefined
      )
    }
    return () => {
      cancelled = true
    }
  }, [form.open, folder])

  useEffect(() => {
    const p = form.open && folder ? window.api?.accounts?.resolveFolder?.(folder) : undefined
    if (!p) {
      setResolution(null)
      return
    }
    let cancelled = false
    void p.then(
      (r) => {
        if (!cancelled) setResolution(r)
      },
      () => {
        if (!cancelled) setResolution(null)
      }
    )
    return () => {
      cancelled = true
    }
  }, [form.open, folder])

  const accountName = (id: string): string => accounts.find((a) => a.id === id)?.name ?? id
  const fixed = resolution && resolution.accountId !== 'ask' ? resolution.accountId : ''
  const accountId = form.accountId ?? (fixed || picked)
  const needsPick = !form.accountId && !fixed
  const modelValue = model === CUSTOM ? customModel : model
  const modelValid = model !== CUSTOM || (MODEL_RE.test(customModel) && !customModel.startsWith('-'))
  const optionOk = (o: StartOption): boolean =>
    o === 'new' || o === 'continue' || (!!sessionId && (o === 'fork' || !sessionLive))

  const pickFolder = async (): Promise<void> => {
    const f = await window.api?.app?.pickFolder?.()
    if (f) {
      setFolder(f)
      setWarnings(false)
      setError('')
    }
  }

  const submit = async (confirmed: boolean): Promise<void> => {
    if (!folder || !accountId || !modelValid) return
    if ((option === 'resume' || option === 'fork') && !sessionId) return
    const resume: ControlResume | undefined =
      option === 'continue'
        ? { kind: 'continue' }
        : option === 'resume'
          ? { kind: 'resume', sessionId: sessionId! }
          : option === 'fork'
            ? { kind: 'resume', sessionId: sessionId!, fork: true }
            : undefined
    const req: ControlStartRequest = {
      cwd: folder,
      accountId,
      permissionMode: mode,
      ...(modelValue ? { model: modelValue } : {}),
      ...(resume ? { resume } : {}),
      ...(confirmed ? { confirmed: true } : {})
    }
    setBusyStart(true)
    setError('')
    try {
      const r = await start(req)
      if (r.ok) {
        setWarnings(false)
        closeForm()
      } else if (r.reason === 'needs-confirmation') setWarnings(true)
      else setError(blockText(r.reason ?? 'failed'))
    } finally {
      setBusyStart(false)
    }
  }

  return (
    <div className="ac-tc-ctl">
      <div className="ac-tc-ctl__row">
        {control && (
          <span className={`ac-tc-chip ac-tc-chip--${control.state}`} role="status">
            {STATE_LABEL[control.state] ?? control.state}
            {control.queuedTurns > 0 ? ` · ${control.queuedTurns} queued` : ''}
          </span>
        )}
        {live && (
          <>
            <label className="ac-tc-ctl__field">
              <span>Model</span>
              <select
                aria-label="Model"
                value={liveModelValue}
                onChange={(e) => {
                  const v = e.target.value
                  if (v === CUSTOM) {
                    setCustomLive(true)
                    return
                  }
                  setCustomLive(false)
                  void setModel(control.id, v === DEFAULT_MODEL ? null : v).then(report)
                }}
              >
                <option value={DEFAULT_MODEL}>Account default</option>
                {modelList.map((m) => (
                  <option key={m.value} value={m.value} {...(m.title ? { title: m.title } : {})}>
                    {m.label}
                  </option>
                ))}
                <option value={CUSTOM}>Custom…</option>
              </select>
            </label>
            {liveModelValue === CUSTOM && (
              <>
                <input
                  className="ac-tc-ctl__input"
                  aria-label="Custom model"
                  aria-invalid={customLiveText !== '' && !liveCustomValid}
                  value={customLiveText}
                  onChange={(e) => setCustomLiveText(e.target.value)}
                />
                <Button
                  size="sm"
                  disabled={!liveCustomValid}
                  onClick={() => void setModel(control.id, customLiveText).then(report)}
                >
                  Set model
                </Button>
              </>
            )}
            <label className="ac-tc-ctl__field">
              <span>Mode</span>
              <select
                aria-label="Permission mode"
                value={control.permissionMode}
                onChange={(e) => void setMode(control.id, e.target.value as ControlPermissionMode).then(report)}
              >
                {MODES.map((m) => (
                  <option key={m} value={m}>
                    {m}
                  </option>
                ))}
              </select>
            </label>
            {(!narrow || moreOpen) && control && (
              <>
                <label className="ac-tc-ctl__field">
                  <span>Effort</span>
                  <select
                    aria-label="Effort"
                    value={details?.effort ?? ''}
                    onChange={(e) =>
                      void useDetailsStore
                        .getState()
                        .setEffort(control.id, e.target.value === '' ? null : (e.target.value as Effort))
                        .then(report)
                    }
                  >
                    <option value="">default</option>
                    {EFFORTS.map((x) => (
                      <option key={x} value={x}>
                        {x}
                      </option>
                    ))}
                  </select>
                </label>
                <label className="ac-tc-ctl__field">
                  <span>Style</span>
                  <select
                    aria-label="Output style"
                    value={details?.outputStyle ?? ''}
                    onChange={(e) =>
                      void useDetailsStore
                        .getState()
                        .setOutputStyle(control.id, e.target.value === '' ? null : e.target.value)
                        .then(report)
                    }
                  >
                    <option value="">default</option>
                    {(details?.availableOutputStyles ?? [])
                      .filter((x) => x !== 'default')
                      .map((x) => (
                        <option key={x} value={x}>
                          {x}
                        </option>
                      ))}
                  </select>
                </label>
              </>
            )}
            {narrow && (
              <Button size="sm" variant="ghost" aria-expanded={moreOpen} onClick={() => setMoreOpen((v) => !v)}>
                {moreOpen ? 'Fewer controls' : 'More controls'}
              </Button>
            )}
            <Button size="sm" onClick={() => setRewindOpen(true)}>
              Checkpoints
            </Button>
            {busy && (
              <Button size="sm" variant="warn" aria-keyshortcuts="Control+." onClick={() => void interrupt(control.id)}>
                {`Interrupt lead (${projectName})`}
              </Button>
            )}
            <Button size="sm" variant="danger" onClick={() => void stop(control.id)}>
              Stop
            </Button>
            <Button size="sm" variant="ghost" onClick={onAskLead}>
              Ask lead to start a teammate
            </Button>
          </>
        )}
      </div>
      {live && control && (
        <p className="ac-tc-hint ac-ctl-hint">
          {control.state === 'draft'
            ? 'Model, effort, mode and style are used when the session starts.'
            : 'Changes apply from the next turn.'}
        </p>
      )}
      {liveNote && (
        <p className="ac-tc-hint ac-ctl-hint" role="status">
          {liveNote}
        </p>
      )}
      {live && control && (!narrow || moreOpen) && (
        <div className="ac-tc-ctl__row ac-ctl-strip" data-testid="session-details-strip">
          {renaming === null ? (
            <>
              <span title={details?.title ?? ''} className="ac-ctl-title">
                {details?.title ?? 'Untitled session'}
              </span>
              <Button size="sm" variant="ghost" onClick={() => setRenaming(details?.title ?? '')}>
                Rename
              </Button>
            </>
          ) : (
            <form
              className="ac-ctl-rename"
              onSubmit={(e) => {
                e.preventDefault()
                const t = renaming.trim()
                if (!t) return
                void useDetailsStore
                  .getState()
                  .rename(control.id, t)
                  .then((r) => {
                    report(r)
                    if (r.ok) setRenaming(null)
                  })
              }}
            >
              <input
                className="ac-tc-ctl__input"
                aria-label="Session title"
                value={renaming}
                maxLength={200}
                onChange={(e) => setRenaming(e.target.value)}
                onKeyDown={(e) => {
                  if (e.key === 'Escape') {
                    e.stopPropagation()
                    setRenaming(null)
                  }
                }}
              />
              <Button size="sm" type="submit" variant="primary" disabled={renaming.trim() === ''}>
                Save title
              </Button>
              <Button size="sm" onClick={() => setRenaming(null)}>
                Cancel
              </Button>
            </form>
          )}
          <ContextMeter
            {...(details?.context ? { context: details.context } : {})}
            onRefresh={() => void refreshContext(control.id).then(report)}
          />
          {details && (
            <span className="ac-tc-hint" title="API-equivalent cost: subscriptions are not billed per token">
              {details.lastTurn
                ? `Last turn: ${tok(details.lastTurn.input)} in / ${tok(details.lastTurn.output)} out / ${tok(
                    details.lastTurn.cacheRead + details.lastTurn.cacheCreation
                  )} cache${details.lastTurn.costUsd !== undefined ? ` · ${usd(details.lastTurn.costUsd)}` : ''} · `
                : ''}
              Session {usd(details.sessionCostUsd)} (API-equivalent cost)
            </span>
          )}
          <McpChips
            servers={details?.mcp ?? []}
            onToggle={(name, on) => useDetailsStore.getState().mcpToggle(control.id, name, on)}
            onReconnect={(name) => useDetailsStore.getState().mcpReconnect(control.id, name)}
            onManage={() => useConsoleStore.getState().navigate('extensions')}
            onResult={report}
          />
        </div>
      )}
      {control && (
        <RewindDialog
          open={rewindOpen}
          onClose={() => setRewindOpen(false)}
          busy={busy}
          checkpointing={details?.checkpointing ?? false}
          turns={details?.userTurns ?? []}
          preview={(uuid) => useDetailsStore.getState().rewindPreview(control.id, uuid)}
          rewind={(uuid) => useDetailsStore.getState().rewind(control.id, uuid)}
          fork={(uuid) => useDetailsStore.getState().forkAt(control.id, uuid)}
        />
      )}
      {liveError && (
        <p className="ac-tc-ctl__error" role="alert">
          {liveError}
        </p>
      )}
      {control?.error && (
        <p className="ac-tc-ctl__error" role="alert">
          {control.error}
        </p>
      )}

      {form.open && (
        <form
          className="ac-tc-start"
          aria-label="Start a session"
          onSubmit={(e) => {
            e.preventDefault()
            void submit(false)
          }}
        >
          <div className="ac-tc-start__row">
            <label htmlFor="ac-start-folder">Folder</label>
            <input
              id="ac-start-folder"
              className="ac-tc-ctl__input ac-tc-start__grow"
              value={folder}
              title={folder}
              onChange={(e) => {
                setFolder(e.target.value)
                setWarnings(false)
                setError('')
              }}
            />
            <Button size="sm" onClick={() => void pickFolder()}>
              Change…
            </Button>
          </div>
          {accounts.length === 0 && !form.accountId ? (
            <p className="ac-tc-hint">Add an account in Accounts first</p>
          ) : needsPick ? (
            <div className="ac-tc-start__row">
              <label htmlFor="ac-start-account">Account</label>
              <select
                id="ac-start-account"
                className="ac-tc-ctl__input"
                value={picked}
                onChange={(e) => setPicked(e.target.value)}
              >
                <option value="">Ask me: pick an account</option>
                {accounts.map((a) => (
                  <option key={a.id} value={a.id}>
                    {a.name}
                  </option>
                ))}
              </select>
            </div>
          ) : (
            <p className="ac-tc-hint">
              Uses {accountName(accountId)}
              {resolution?.pattern && !form.accountId ? ` (rule: ${resolution.pattern})` : ''}
            </p>
          )}
          <fieldset className="ac-tc-start__opts">
            <legend>Session</legend>
            {(
              [
                ['new', 'New session'],
                ['continue', 'Continue latest in folder'],
                ['resume', 'Resume selected session'],
                ['fork', 'Fork selected session']
              ] as [StartOption, string][]
            ).map(([o, label]) => (
              <label key={o} className="ac-tc-start__opt">
                <input
                  type="radio"
                  name="ac-start-option"
                  checked={option === o}
                  disabled={!optionOk(o)}
                  onChange={() => setOption(o)}
                />
                {label}
              </label>
            ))}
          </fieldset>
          <div className="ac-tc-start__row">
            <label htmlFor="ac-start-model">Model</label>
            <select id="ac-start-model" className="ac-tc-ctl__input" value={model} onChange={(e) => setModelSel(e.target.value)}>
              <option value={DEFAULT_MODEL}>Account default</option>
              {MODELS.map((m) => (
                <option key={m} value={m}>
                  {m}
                </option>
              ))}
              <option value={CUSTOM}>Custom…</option>
            </select>
            {model === CUSTOM && (
              <input
                className="ac-tc-ctl__input"
                aria-label="Custom model name"
                aria-invalid={!modelValid}
                value={customModel}
                onChange={(e) => setCustomModel(e.target.value)}
              />
            )}
            <label htmlFor="ac-start-mode">Mode</label>
            <select
              id="ac-start-mode"
              className="ac-tc-ctl__input"
              value={mode}
              onChange={(e) => setModeSel(e.target.value as ControlPermissionMode)}
            >
              {MODES.map((m) => (
                <option key={m} value={m}>
                  {m}
                </option>
              ))}
            </select>
          </div>
          {error && (
            <p className="ac-tc-ctl__error" role="alert">
              {error}
            </p>
          )}
          {warnings ? (
            <div className="ac-tc-raw__warn" role="alert">
              <p>You are opening a company folder with a personal account.</p>
              <Button size="sm" variant="warn" onClick={() => void submit(true)}>
                Start anyway
              </Button>
              <Button size="sm" onClick={() => setWarnings(false)}>
                Cancel
              </Button>
            </div>
          ) : (
            <div className="ac-tc-start__row">
              <Button
                size="sm"
                variant="primary"
                type="submit"
                disabled={busyStart || !folder || !accountId || !modelValid || !optionOk(option)}
              >
                Start session
              </Button>
              <Button size="sm" onClick={() => closeForm()}>
                Cancel
              </Button>
              <span className="ac-tc-hint">Starting does not send a message.</span>
            </div>
          )}
        </form>
      )}
    </div>
  )
}
