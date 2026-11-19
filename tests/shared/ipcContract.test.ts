import { describe, expect, it } from 'vitest'
import { INVOKE_CHANNELS, IPC } from '@shared/ipc'

describe('IPC contract', () => {
  const values = Object.values(IPC)

  it('has unique channel values', () => {
    expect(new Set(values).size).toBe(values.length)
  })

  it('INVOKE_CHANNELS covers every channel except teamEvent', () => {
    expect(INVOKE_CHANNELS.length).toBe(values.length - 1)
    expect(INVOKE_CHANNELS).not.toContain(IPC.teamEvent)
  })

  it('every channel matches the naming pattern', () => {
    for (const v of values) expect(v).toMatch(/^[a-z]+:[a-z-]+$/)
  })
})
