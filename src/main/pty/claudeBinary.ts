export interface ClaudeCommand { file: string; argsPrefix: string[]; via: 'exe' | 'npm-shim-exe' | 'cmd-shim' | 'posix' }

export function resolveClaudeCommand(o: {
  platform: NodeJS.Platform
  env: Readonly<Record<string, string | undefined>>
  home: string
  exists: (p: string) => boolean
}): ClaudeCommand | null {
  const win = o.platform === 'win32'
  const sep = win ? ';' : ':'
  let pathVal = ''
  for (const [k, v] of Object.entries(o.env)) {
    if (typeof v !== 'string') continue
    if (win ? k.toLowerCase() === 'path' : k === 'PATH') {
      pathVal = v
      break
    }
  }
  const dirs = pathVal.split(sep).filter((d) => d.length > 0)
  const join = (d: string, f: string): string => (d.endsWith('/') || d.endsWith('\\') ? d + f : `${d}${win ? '\\' : '/'}${f}`)

  if (win) {
    for (const dir of dirs) {
      const exe = join(dir, 'claude.exe')
      if (o.exists(exe)) return { file: exe, argsPrefix: [], via: 'exe' }
      const cmd = join(dir, 'claude.cmd')
      if (o.exists(cmd)) {
        const real = join(dir, 'node_modules\\@anthropic-ai\\claude-code\\bin\\claude.exe')
        if (o.exists(real)) return { file: real, argsPrefix: [], via: 'npm-shim-exe' }
        return { file: o.env.ComSpec ?? 'cmd.exe', argsPrefix: ['/d', '/s', '/c', cmd], via: 'cmd-shim' }
      }
    }
    const local = join(join(join(o.home, '.local'), 'bin'), 'claude.exe')
    return o.exists(local) ? { file: local, argsPrefix: [], via: 'exe' } : null
  }

  const candidates = [...dirs.map((d) => join(d, 'claude')), `${o.home}/.local/bin/claude`, `${o.home}/.claude/local/claude`]
  for (const c of candidates) if (o.exists(c)) return { file: c, argsPrefix: [], via: 'posix' }
  return null
}
