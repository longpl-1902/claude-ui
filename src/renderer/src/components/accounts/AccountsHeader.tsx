import { Button } from '@renderer/components/ui/Button'
import { ChevronLeftIcon } from '@renderer/components/ui/Icons'
import { selectActiveAccount, useConsoleStore } from '@renderer/store/useConsoleStore'

export function AccountsHeader(): JSX.Element {
  const navigate = useConsoleStore((s) => s.navigate)
  const active = useConsoleStore(selectActiveAccount)
  return (
    <header className="ac-acc-header" style={{ borderTopColor: active.color }}>
      <button type="button" className="ac-acc-back" onClick={() => navigate('team')}>
        <ChevronLeftIcon size={16} />
        Team view
      </button>
      <span className="ac-acc-sep" aria-hidden="true">
        /
      </span>
      <span className="ac-acc-header__title">Accounts</span>
      <div className="ac-acc-spacer" />
      <Button variant="accent2">+ Add account</Button>
    </header>
  )
}
