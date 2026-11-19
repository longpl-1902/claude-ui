// Process-tree helpers (kill a controlled child and its descendants; look up an image name). Exec is injected.

export type ExecFn = (file: string, args: string[], opts: { timeout: number; windowsHide: true }) => Promise<{ stdout: string }>

const validPid = (pid: number): boolean => Number.isInteger(pid) && pid > 0
const sleep = (ms: number): Promise<void> => new Promise((r) => setTimeout(r, ms))

function alive(pid: number): boolean {
  try {
    process.kill(pid, 0)
    return true
  } catch {
    return false
  }
}

export function createKillTree(exec: ExecFn, platform: NodeJS.Platform): (pid: number) => Promise<void> {
  return async (pid) => {
    if (!validPid(pid)) return
    if (platform === 'win32') {
      try {
        await exec('taskkill', ['/PID', String(pid), '/T', '/F'], { timeout: 5000, windowsHide: true })
      } catch {
        /* already gone */
      }
      return
    }
    try {
      process.kill(pid, 'SIGTERM')
    } catch {
      return
    }
    await sleep(2000)
    if (!alive(pid)) return
    try {
      process.kill(pid, 'SIGKILL')
    } catch {
      /* gone */
    }
  }
}

/** First CSV field of the first `tasklist /FO CSV /NH` row, or null. */
export function parseTasklistCsv(out: string): string | null {
  const line = out.split(/\r?\n/).find((l) => l.trim() !== '')
  if (!line || !line.startsWith('"')) return null
  let name = ''
  for (let i = 1; i < line.length; i++) {
    if (line[i] === '"') {
      if (line[i + 1] === '"') {
        name += '"'
        i++
        continue
      }
      break
    }
    name += line[i]
  }
  return name === '' ? null : name
}

export function createImageName(exec: ExecFn, platform: NodeJS.Platform): (pid: number) => Promise<string | null> {
  return async (pid) => {
    if (!validPid(pid)) return null
    try {
      if (platform === 'win32') {
        const { stdout } = await exec('tasklist', ['/FI', `PID eq ${pid}`, '/FO', 'CSV', '/NH'], { timeout: 5000, windowsHide: true })
        return parseTasklistCsv(stdout)
      }
      const { stdout } = await exec('ps', ['-p', String(pid), '-o', 'comm='], { timeout: 5000, windowsHide: true })
      const t = stdout.trim()
      return t === '' ? null : t
    } catch {
      return null
    }
  }
}
