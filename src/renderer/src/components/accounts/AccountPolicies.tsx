import { useConsoleStore } from '@renderer/store/useConsoleStore'
import type { LimitPolicy, SafetySettings } from '@shared/types'

const SAFETY: [keyof SafetySettings, string][] = [
  ['warnPersonalInCompanyFolder', 'Warn before the personal account opens a folder matched to Company'],
  ['showAccountColorEdge', 'Show the account color on the window edge and in the header'],
  ['lockAccountOnTeamStart', 'Lock the account once a team has started (no switching mid-run)']
]

const LIMIT_OPTS: [LimitPolicy, string, string][] = [
  ['pause', 'Pause the team and ask me', 'Safest. Nothing switches without you.'],
  ['wait', 'Wait for the reset, then resume', 'Agents keep their place and continue after the limit resets.'],
  ['switch', 'Switch to the other account', 'Only for personal folders. Applies once usage data is available.']
]

export function AccountPolicies(): JSX.Element {
  const accounts = useConsoleStore((s) => s.accounts)
  const toggleSafety = useConsoleStore((s) => s.toggleSafety)
  const setLimitPolicy = useConsoleStore((s) => s.setLimitPolicy)
  return (
    <div className="ac-acc-policies">
      <section className="ac-acc-card ac-acc-card--policy">
        <h2 className="ac-acc-h2 ac-acc-h2--sm">Safety</h2>
        {SAFETY.map(([key, text]) => (
          <label key={key} className="ac-acc-check">
            <input type="checkbox" checked={accounts.safety[key]} onChange={() => toggleSafety(key)} />
            <span>{text}</span>
          </label>
        ))}
      </section>

      <section className="ac-acc-card ac-acc-card--policy">
        <h2 className="ac-acc-h2 ac-acc-h2--sm" id="ac-acc-limit-title">
          When an account hits its usage limit
        </h2>
        <div role="radiogroup" aria-labelledby="ac-acc-limit-title" className="ac-acc-radios">
          {LIMIT_OPTS.map(([value, title, desc]) => {
            const on = accounts.limitPolicy === value
            return (
              <label key={value} className={`ac-acc-radio${on ? ' ac-acc-radio--on' : ''}`}>
                <input
                  type="radio"
                  name="ac-acc-limit"
                  className="ac-acc-radio__input"
                  value={value}
                  checked={on}
                  onChange={() => setLimitPolicy(value)}
                />
                <span className="ac-acc-radio__ring">
                  <span className="ac-acc-radio__dot" />
                </span>
                <span className="ac-acc-radio__text">
                  <span className="ac-acc-radio__title">{title}</span>
                  <span className="ac-acc-sub">{desc}</span>
                </span>
              </label>
            )
          })}
        </div>
      </section>
    </div>
  )
}
