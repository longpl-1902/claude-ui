import { useConsoleStore } from '@renderer/store/useConsoleStore'

export function AccountsView() {
  const navigate = useConsoleStore((s) => s.navigate)
  return (
    <main>
      <h1>Claude accounts</h1>
      <button onClick={() => navigate('team')}>Team view</button>
    </main>
  )
}
