// Console input routing and the "message an agent" prompt format (D2).

export function formatAgentMessage(agentName: string, text: string): string {
  return `@${agentName}: ${text}\n(Agent Console: forward this to the agent "${agentName}" with SendMessage if it is still running; otherwise handle it yourself.)`
}

export type ConsoleRoute =
  | { kind: 'send'; text: string; targetAgentId?: string }
  | { kind: 'error'; reason: 'empty' | 'unknown-agent' | 'too-long' }

const MAX_INPUT = 32000

export function routeConsoleInput(input: string, agents: { id: string; name: string }[], leadId = 'lead'): ConsoleRoute {
  const text = input.trim()
  if (text === '') return { kind: 'error', reason: 'empty' }
  if (text.length > MAX_INPUT) return { kind: 'error', reason: 'too-long' }
  if (!text.startsWith('@')) return { kind: 'send', text }

  const rest = text.slice(1)
  const lower = rest.toLowerCase()
  let best: { id: string; name: string } | null = null
  for (const a of agents) {
    const n = a.name.toLowerCase()
    if (n === '' || !lower.startsWith(n)) continue
    const next = rest.charAt(n.length)
    if (next !== '' && !/\s/.test(next)) continue
    if (!best || a.name.length > best.name.length) best = a
  }
  const isLeadWord = lower === 'lead' || /^lead\s/.test(lower)
  let name: string
  let id: string
  if (best) {
    name = best.name
    id = best.id
  } else if (isLeadWord) {
    name = 'lead'
    id = leadId
  } else return { kind: 'error', reason: 'unknown-agent' }

  const body = rest.slice(name.length).trim()
  if (body === '') return { kind: 'error', reason: 'empty' }
  if (id === leadId) return { kind: 'send', text: body }
  return { kind: 'send', text: formatAgentMessage(name, body), targetAgentId: id }
}
