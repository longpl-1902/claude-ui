import type { ThemeSource } from '@shared/types'
import { THEME_LABEL, THEME_SOURCES, useThemeStore } from '@renderer/theme/useThemeStore'
import './appearance.css'
import { ReopenWindowsToggle } from './ReopenWindowsToggle'

const HINT: Record<ThemeSource, string> = {
  system: 'Follows the Windows theme and accent colour live.',
  light: 'Always light, whatever Windows uses.',
  dark: 'Always dark, whatever Windows uses.'
}

/** Appearance: Theme = System (default) / Light / Dark. Ctrl+Shift+L cycles through the three. */
export function AppearanceRow(): JSX.Element {
  const source = useThemeStore((s) => s.source)
  const mode = useThemeStore((s) => s.mode)
  const setSource = useThemeStore((s) => s.setSource)
  return (
    <section className="ac-acc-card ac-acc-card--policy ac-appearance" aria-labelledby="ac-appearance-title">
      <h2 className="ac-acc-h2 ac-acc-h2--sm" id="ac-appearance-title">
        Appearance
      </h2>
      <div role="radiogroup" aria-label="Theme" className="ac-appearance__options">
        {THEME_SOURCES.map((value) => {
          const on = source === value
          return (
            <label key={value} className={`ac-acc-radio${on ? ' ac-acc-radio--on' : ''}`}>
              <input
                type="radio"
                name="ac-theme"
                className="ac-acc-radio__input"
                value={value}
                checked={on}
                onChange={() => setSource(value)}
              />
              <span className="ac-acc-radio__ring">
                <span className="ac-acc-radio__dot" />
              </span>
              <span className="ac-acc-radio__text">
                <span className="ac-acc-radio__title">{THEME_LABEL[value]}</span>
                <span className="ac-acc-sub">{HINT[value]}</span>
              </span>
            </label>
          )
        })}
      </div>
      <ReopenWindowsToggle />
      <p className="ac-acc-sub" role="status">
        Showing the {mode} theme. Ctrl+Shift+L cycles System, Light and Dark.
      </p>
    </section>
  )
}
