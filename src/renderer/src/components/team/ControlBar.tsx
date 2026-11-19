import { useEffect, useState } from 'react'
import type {
  ControlPermissionMode,
  ControlResume,
  ControlSessionInfo,
  ControlStartRequest,
  FolderResolution
} from '@shared/types'
import { useConsoleStore } from '../../store/useConsoleStore'
import { useControlStore } from '../../store/useControlStore'
import { Button } from '../ui/Button'
import './teamCenter.css'

// D8: bypassPermissions is intentionally not offered.
const MODES: ControlPermissionMode[] = ['default', 'acceptEdits', 'plan', 'auto', 'dontAsk']
const MODELS = ['opus', 'sonnet', 'haiku', 'fable']
const MODEL_RE = /^[A-Za-z0-9._[\]-]{1,64}$/
const CUSTOM = '__custom__'
const DEFAULT_MODEL = ''

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
const blockText = (r: string): string => BLOCK_TEXT[r] ?? `Could not start the session (${r}).`

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
  const known = control?.model !== undefined && MODELS.includes(control.model)
  const [customLive, setCustomLive] = useState(false)
  const [customLiveText, setCustomLiveText] = useState('')
  const liveModelValue = customLive || (control?.model && !known) ? CUSTOM : (control?.model ?? DEFAULT_MODEL)
  const liveCustomValid = MODEL_RE.test(customLiveText) && !customLiveText.startsWith('-')
  const [liveError, setLiveError] = useState('')
  const report = (r: { ok: boolean; reason?: string }): void =>
    setLiveError(r.ok ? '' : `Could not change that (${r.reason ?? 'failed'}).`)

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
                {MODELS.map((m) => (
                  <option key={m} value={m}>
                    {m}
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
