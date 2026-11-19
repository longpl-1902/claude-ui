const TOKEN = /(?:sk-|ghp_|xox[bp]-)[A-Za-z0-9\-_]{6,}/g
const BEARER = /\bBearer\s+\S+/gi
const USERINFO = /(\b[a-z][a-z0-9+.-]*:\/\/)[^/\s@]+@/gi
const QUERY = /([?&][^=&#\s]+)=([^&#\s]*)/g

/** Masks secrets inside one free-form string (argv element or CLI output). */
export function maskText(s: string): string {
  return s
    .replace(USERINFO, '$1***@')
    .replace(QUERY, '$1=***')
    .replace(BEARER, 'Bearer ***')
    .replace(TOKEN, '***')
}

/** Masks an argv for display/logs: -e/--env values, -H/--header values, bearer tokens, URL secrets, known token shapes. */
export function maskArgv(argv: readonly string[]): string[] {
  const out: string[] = []
  let afterFlag: 'env' | 'header' | null = null
  for (const a of argv) {
    if (afterFlag === 'env') {
      const eq = a.indexOf('=')
      out.push(eq > 0 ? `${a.slice(0, eq)}=***` : '***')
      afterFlag = null
      continue
    }
    if (afterFlag === 'header') {
      const c = a.indexOf(':')
      out.push(c > 0 ? `${a.slice(0, c).trim()}: ***` : '***')
      afterFlag = null
      continue
    }
    if (a === '-e' || a === '--env') afterFlag = 'env'
    else if (a === '-H' || a === '--header') afterFlag = 'header'
    out.push(maskText(a))
  }
  return out
}
