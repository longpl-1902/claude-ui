import { mockAccountsSnapshot } from '@shared/mock'
import { useConsoleStore } from '@renderer/store/useConsoleStore'

export function seedMockAccounts(): void {
  useConsoleStore.getState().hydrateAccounts(structuredClone(mockAccountsSnapshot))
}
