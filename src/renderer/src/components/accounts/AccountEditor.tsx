import { useState } from 'react'
import { Button } from '@renderer/components/ui/Button'
import { useConsoleStore } from '@renderer/store/useConsoleStore'
import { ACCOUNT_COLORS } from '@shared/accountsDefaults'
import type { AccountKind, AccountView } from '@shared/types'
import './manage.css'

export interface AccountEditorProps {
  mode: 'create' | 'edit'
  initial?: AccountView
  onClose(): void
}

const HEX = /^#[0-9a-f]{6}$/i
const slug = (s: string): string =>
  s
    .trim()
    .toLowerCase()
    .replace(/[^a-z0-9]+/g, '-')
    .replace(/^-+|-+$/g, '')

const REASONS: Record<string, string> = {
  'api-unavailable': 'The app backend is not available.'
}

export function AccountEditor({ mode, initial, onClose }: AccountEditorProps): JSX.Element {
  const saveProfile = useConsoleStore((s) => s.saveProfile)
  const [name, setName] = useState(initial?.name ?? '')
  const [color, setColor] = useState(initial?.color ?? ACCOUNT_COLORS[0]!)
  const [kind, setKind] = useState<AccountKind | ''>(initial?.kind ?? '')
  const [dir, setDir] = useState<string | undefined>(undefined)
  const [errors, setErrors] = useState<{ name?: string; color?: string; dir?: string }>({})
  const [saveError, setSaveError] = useState<string>()
  const [busy, setBusy] = useState(false)
  const idp = `ac-acc-ed-${initial?.id ?? 'new'}`

  const shownDir =
    mode === 'edit' ? (initial?.configDir ?? '') : (dir ?? `~/.claude-${slug(name) || 'account'}`)

  async function submit(e: React.FormEvent): Promise<void> {
    e.preventDefault()
    const errs: typeof errors = {}
    const n = name.trim()
    if (!n) errs.name = 'Name is required.'
    else if (n.length > 40) errs.name = 'Name must be 40 characters or fewer.'
    if (!HEX.test(color)) errs.color = 'Color must look like #RRGGBB.'
    const cfg = shownDir.trim()
    if (!cfg) errs.dir = 'Config folder is required.'
    setErrors(errs)
    setSaveError(undefined)
    if (Object.keys(errs).length > 0) return
    setBusy(true)
    const r = await saveProfile({
      ...(initial ? { id: initial.id } : {}),
      name: n,
      color,
      configDir: cfg,
      ...(kind ? { kind } : {})
    })
    setBusy(false)
    if (r.ok) onClose()
    else setSaveError(REASONS[r.reason ?? ''] ?? r.reason ?? 'Could not save the account.')
  }

  return (
    <form
      className="ac-acc-form"
      onSubmit={submit}
      aria-label={mode === 'create' ? 'Add account' : 'Rename and color'}
      noValidate
    >
      <div className="ac-acc-formrow">
        <label className="ac-acc-formlabel" htmlFor={`${idp}-name`}>
          Name
        </label>
        <input
          id={`${idp}-name`}
          className="ac-acc-text"
          value={name}
          aria-invalid={errors.name ? true : undefined}
          onChange={(e) => setName(e.target.value)}
        />
        {errors.name && (
          <span className="ac-acc-error" role="alert">
            {errors.name}
          </span>
        )}
      </div>

      <fieldset className="ac-acc-formrow">
        <legend>Color</legend>
        <div className="ac-acc-swatches">
          {ACCOUNT_COLORS.map((c) => (
            <button
              key={c}
              type="button"
              className="ac-acc-swatch"
              style={{ background: c }}
              aria-label={`Color ${c}`}
              aria-pressed={color.toLowerCase() === c.toLowerCase()}
              onClick={() => setColor(c)}
            />
          ))}
          <input
            className="ac-acc-text ac-acc-text--hex"
            aria-label="Hex color"
            value={color}
            aria-invalid={errors.color ? true : undefined}
            onChange={(e) => setColor(e.target.value)}
          />
        </div>
        {errors.color && (
          <span className="ac-acc-error" role="alert">
            {errors.color}
          </span>
        )}
      </fieldset>

      <fieldset className="ac-acc-formrow">
        <legend>Kind</legend>
        <div className="ac-acc-inline-radios">
          {(
            [
              ['company', 'Company'],
              ['personal', 'Personal'],
              ['', 'Not set']
            ] as const
          ).map(([v, label]) => (
            <label key={label} className="ac-acc-inline-radio">
              <input type="radio" name={`${idp}-kind`} checked={kind === v} onChange={() => setKind(v)} />
              {label}
            </label>
          ))}
        </div>
      </fieldset>

      <div className="ac-acc-formrow">
        <label className="ac-acc-formlabel" htmlFor={`${idp}-dir`}>
          Config folder
        </label>
        <input
          id={`${idp}-dir`}
          className="ac-acc-text ac-acc-mono"
          value={shownDir}
          readOnly={mode === 'edit'}
          aria-invalid={errors.dir ? true : undefined}
          onChange={(e) => setDir(e.target.value)}
        />
        <span className="ac-acc-sub">Folder is created by Claude Code when you sign in.</span>
        {errors.dir && (
          <span className="ac-acc-error" role="alert">
            {errors.dir}
          </span>
        )}
      </div>

      {saveError && (
        <span className="ac-acc-error" role="alert">
          {saveError}
        </span>
      )}
      <div className="ac-acc-row">
        <Button type="submit" variant="primary" disabled={busy}>
          Save
        </Button>
        <Button onClick={onClose}>Cancel</Button>
      </div>
    </form>
  )
}
