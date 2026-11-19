// Dev-only CSP relaxation (R-18).
// src/renderer/index.html carries the production CSP (`connect-src 'self'`). Under
// `electron-vite dev` the renderer is served by the Vite dev server, whose HMR client
// needs ws/http connections to localhost. This plugin adds those sources to
// connect-src only while serving, so `npm run build` ships the strict policy unchanged.
import type { Plugin } from 'vite'

export const DEV_CONNECT_SOURCES = ['ws://localhost:*', 'http://localhost:*'] as const

const CSP_META = /(<meta[^>]*http-equiv="Content-Security-Policy"[^>]*content=")([^"]*)(")/i

/** Returns `html` with the dev-server sources appended to the CSP's connect-src. */
export function addDevConnectSrc(html: string): string {
  if (!CSP_META.test(html)) throw new Error('index.html has no Content-Security-Policy meta')
  return html.replace(CSP_META, (_m, start: string, csp: string, end: string) => {
    const directives = csp.split(';').map((d) => d.trim()).filter(Boolean)
    const i = directives.findIndex((d) => /^connect-src\s/.test(d) || d === 'connect-src')
    const extra = DEV_CONNECT_SOURCES.join(' ')
    if (i === -1) directives.push(`connect-src 'self' ${extra}`)
    else directives[i] = `${directives[i]} ${extra}`
    return `${start}${directives.join('; ')}${end}`
  })
}

export function devCspPlugin(): Plugin {
  return {
    name: 'agent-console:dev-csp',
    apply: 'serve',
    transformIndexHtml: (html) => addDevConnectSrc(html)
  }
}
