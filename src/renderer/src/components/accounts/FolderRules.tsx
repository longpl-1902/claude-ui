import { Button } from '@renderer/components/ui/Button'
import { ACCOUNT_FALLBACK_COLOR } from '@renderer/theme/colors'
import { useConsoleStore } from '@renderer/store/useConsoleStore'

export function FolderRules(): JSX.Element {
  const accounts = useConsoleStore((s) => s.accounts)
  return (
    <section className="ac-acc-section">
      <div className="ac-acc-titlerow">
        <h2 className="ac-acc-h2">Pick the account by folder</h2>
        <span className="ac-acc-hint">First matching rule wins when you open a repo or start a team</span>
      </div>
      <div className="ac-acc-tablewrap">
        <table className="ac-acc-table">
          <thead>
            <tr>
              <th scope="col">Folder pattern</th>
              <th scope="col">Account</th>
              <th scope="col">Note</th>
            </tr>
          </thead>
          <tbody>
            {accounts.rules.map((r) => {
              const acc = accounts.accounts.find((a) => a.id === r.accountId)
              const color = acc?.color ?? ACCOUNT_FALLBACK_COLOR
              return (
                <tr key={r.pattern}>
                  <td className="ac-acc-mono ac-acc-table__pattern">{r.pattern}</td>
                  <td>
                    <span className="ac-acc-table__acct">
                      <span className="ac-acc-dot" style={{ background: color }} />
                      {acc ? acc.name : 'Ask me'}
                    </span>
                  </td>
                  <td className="ac-acc-table__note">{r.note}</td>
                </tr>
              )
            })}
          </tbody>
        </table>
      </div>
      <div>
        <Button variant="dashed">+ Add rule</Button>
      </div>
    </section>
  )
}
