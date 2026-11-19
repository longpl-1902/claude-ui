import { mockTeamSnapshot } from '@shared/mock'
import { useConsoleStore } from '@renderer/store/useConsoleStore'

export function seedDemoTeam(): void {
  const team = structuredClone(mockTeamSnapshot)
  team.source = 'demo'
  useConsoleStore.setState({ team, teamMode: 'demo', selectedAgentId: 'be' })
}
