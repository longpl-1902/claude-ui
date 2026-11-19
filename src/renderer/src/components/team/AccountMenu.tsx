import { useEffect, useRef, useState } from 'react'
import type { KeyboardEvent } from 'react'
import type { AccountView } from '@shared/types'
import { Avatar } from '../ui/Avatar'
import { ChevronDownIcon, LockIcon } from '../ui/Icons'
import { useConsoleStore } from '../../store/useConsoleStore'

/**
 * Header account chip + menu (user request 2026-11-19: "I can't switch user here").
 * The chip shows the account of the VIEWED session (UX M4). A running session cannot change account, so the menu
 * offers what can be switched: the account new sessions start with (the default account), plus sign-in / manage.
 */
export function AccountMenu({ account }: { account: AccountView | undefined }): JSX.Element {
  const accounts = useConsoleStore((s) => s.accounts.accounts)
  const defaultId = useConsoleStore((s) => s.accounts.defaultAccountId)
  const setDefaultAccount = useConsoleStore((s) => s.setDefaultAccount)
  const navigate = useConsoleStore((s) => s.navigate)
  const [open, setOpen] = useState(false)
  const ref = useRef<HTMLDivElement>(null)

  useEffect(() => {
    if (!open) return
    const onDown = (e: MouseEvent): void => {
      if (ref.current && !ref.current.contains(e.target as Node)) setOpen(false)
    }
    document.addEventListener('mousedown', onDown)
    return () => document.removeEventListener('mousedown', onDown)
  }, [open])

  const items = (): HTMLElement[] =>
    Array.from(ref.current?.querySelectorAll<HTMLElement>('[role="menu"] [role^="menuitem"]:not(:disabled)') ?? [])
  const focusAt = (i: number): void => {
    const list = items()
    if (list.length === 0) return
    list[((i % list.length) + list.length) % list.length]?.focus()
  }
  useEffect(() => {
    if (!open) return
    // Focus the checked account first, else the first item.
    const list = items()
    const checked = list.findIndex((el) => el.getAttribute('aria-checked') === 'true')
    focusAt(checked >= 0 ? checked : 0)
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [open])

  const close = (refocus: boolean): void => {
    setOpen(false)
    if (refocus) ref.current?.querySelector<HTMLElement>('.ac-header__chip')?.focus()
  }
  const onKey = (e: KeyboardEvent): void => {
    const list = items()
    const cur = list.indexOf(document.activeElement as HTMLElement)
    if (e.key === 'Escape') {
      e.preventDefault()
      close(true)
    } else if (e.key === 'ArrowDown') {
      e.preventDefault()
      focusAt(cur + 1)
    } else if (e.key === 'ArrowUp') {
      e.preventDefault()
      focusAt(cur < 0 ? list.length - 1 : cur - 1)
    } else if (e.key === 'Home') {
      e.preventDefault()
      focusAt(0)
    } else if (e.key === 'End') {
      e.preventDefault()
      focusAt(list.length - 1)
    } else if (e.key === 'Tab') {
      setOpen(false)
    }
  }

  const label = account ? (account.email ? `${account.name} (${account.email})` : account.name) : 'none'
  const goAccounts = (): void => {
    setOpen(false)
    navigate('accounts')
  }

  return (
    <div className="ac-header__chipwrap" data-fixed data-min="120" ref={ref}>
      <button
        type="button"
        className="ac-header__chip"
        aria-label={`Account: ${label}. Manage accounts`}
        aria-haspopup="menu"
        aria-expanded={open}
        title={account ? (account.email ? `${account.name} · ${account.email}` : account.name) : 'No account'}
        onClick={() => setOpen((o) => !o)}
        onKeyDown={(e) => {
          if (e.key === 'ArrowDown' && !open) {
            e.preventDefault()
            setOpen(true)
          }
        }}
      >
        <Avatar
          initials={account ? account.name.charAt(0).toUpperCase() : '?'}
          color={account ? account.color : 'var(--ac-text-muted)'}
          size={20}
          shape="circle"
        />
        <span className="ac-header__name">{account ? account.name : 'No account'}</span>
        {account?.email && <span className="ac-header__email">{account.email}</span>}
        {account?.locked && (
          <span title="Account locked while a session runs" className="ac-header__lock">
            <LockIcon size={12} color="var(--ac-text-muted)" />
          </span>
        )}
        <ChevronDownIcon size={12} color="var(--ac-text-muted)" />
      </button>
      {open && (
        <div role="menu" aria-label="Accounts" className="ac-header__menu" onKeyDown={onKey}>
          <div className="ac-header__menu-info" role="presentation">
            This session runs as <strong>{account ? account.name : 'no account'}</strong>. A running session keeps its account.
          </div>
          <div className="ac-header__menu-sep" role="separator" />
          <div className="ac-header__menu-info" role="presentation">
            New sessions start as
          </div>
          {accounts.length === 0 && (
            <div className="ac-header__menu-info" role="presentation">
              No accounts yet.
            </div>
          )}
          {accounts.map((a) => (
            <button
              key={a.id}
              type="button"
              role="menuitemradio"
              aria-checked={a.id === defaultId}
              className="ac-header__menurow ac-header__accrow"
              title={a.signedIn ? (a.email ?? a.name) : `${a.name} is not signed in`}
              onClick={() => {
                setDefaultAccount(a.id)
                close(true)
              }}
            >
              <span className="ac-header__accrow-main">
                <Avatar initials={a.name.charAt(0).toUpperCase()} color={a.color} size={20} shape="circle" />
                <span className="ac-header__accrow-text">
                  <span>{a.name}</span>
                  {a.email && <span className="ac-header__email">{a.email}</span>}
                  {!a.signedIn && <span className="ac-header__email">not signed in</span>}
                </span>
              </span>
              <span className="ac-header__check" aria-hidden="true">
                {a.id === defaultId ? '✓' : ''}
              </span>
            </button>
          ))}
          <div className="ac-header__menu-sep" role="separator" />
          <button type="button" role="menuitem" className="ac-header__menurow" onClick={goAccounts}>
            <span>Sign in another account…</span>
          </button>
          <button type="button" role="menuitem" className="ac-header__menurow" aria-keyshortcuts="Control+Shift+A" onClick={goAccounts}>
            <span>Manage accounts</span>
            <kbd className="ac-header__kbd" aria-hidden="true">
              Ctrl+Shift+A
            </kbd>
          </button>
        </div>
      )}
    </div>
  )
}
