import type { ReactNode } from 'react'
import { safeExternalUrl } from '@shared/externalUrl'
import { CopyButton } from './CopyButton'
import './chat.css'

/**
 * Safe Markdown subset -> React elements. Every piece of text becomes a React text node, so raw HTML is shown
 * literally; there is no dangerouslySetInnerHTML. Links open only when http/https, through the main process.
 */

function openLink(url: string): void {
  void window.api?.app?.openExternal?.(url)
}

const INLINE = /`([^`\n]+)`|\*\*([^*\n]+?)\*\*|\*([^*\s][^*\n]*?)\*|\[([^\]\n]+)\]\(([^)\s]+)\)/g

export function renderInline(text: string, keyBase = 'i'): ReactNode[] {
  const out: ReactNode[] = []
  let last = 0
  let n = 0
  for (const m of text.matchAll(INLINE)) {
    const at = m.index ?? 0
    if (at > last) out.push(text.slice(last, at))
    const key = `${keyBase}${n++}`
    if (m[1] !== undefined) out.push(<code key={key}>{m[1]}</code>)
    else if (m[2] !== undefined) out.push(<strong key={key}>{renderInline(m[2], `${key}b`)}</strong>)
    else if (m[3] !== undefined) out.push(<em key={key}>{renderInline(m[3], `${key}e`)}</em>)
    else {
      const url = safeExternalUrl(m[5])
      if (url) {
        out.push(
          <a
            key={key}
            href={url}
            rel="noopener noreferrer"
            onClick={(e) => {
              e.preventDefault()
              openLink(url)
            }}
          >
            {m[4]}
          </a>
        )
      } else out.push(m[0]) // unsafe scheme: plain, non-clickable text
    }
    last = at + m[0].length
  }
  if (last < text.length) out.push(text.slice(last))
  return out
}

function splitRow(line: string): string[] {
  let t = line.trim()
  if (t.startsWith('|')) t = t.slice(1)
  if (t.endsWith('|')) t = t.slice(0, -1)
  return t.split('|').map((c) => c.trim())
}
const isTableSep = (l: string): boolean =>
  /^\s*\|?\s*:?-+:?\s*(\|\s*:?-+:?\s*)*\|?\s*$/.test(l) && l.includes('|')

const FENCE = /^\s*```\s*([\w+#.-]*)\s*$/
const HEADING = /^(#{1,6})\s+(.*)$/
const UL = /^\s*[-*+]\s+(.*)$/
const OL = /^\s*\d+[.)]\s+(.*)$/
const HR = /^\s*(-{3,}|\*{3,})\s*$/

export function renderMarkdown(src: string): ReactNode[] {
  const lines = src.replace(/\r\n?/g, '\n').split('\n')
  const out: ReactNode[] = []
  let i = 0
  let k = 0
  const startsBlock = (l: string): boolean =>
    FENCE.test(l) || HEADING.test(l) || UL.test(l) || OL.test(l) || /^\s*>/.test(l) || HR.test(l)

  while (i < lines.length) {
    const line = lines[i]!
    if (line.trim() === '') {
      i++
      continue
    }
    const fence = FENCE.exec(line)
    if (fence) {
      const lang = fence[1] ?? ''
      const body: string[] = []
      i++
      while (i < lines.length && !/^\s*```\s*$/.test(lines[i]!)) body.push(lines[i++]!)
      i++ // closing fence (or the end of a still-streaming block)
      out.push(<CodeBlock key={k++} lang={lang} code={body.join('\n')} />)
      continue
    }
    const h = HEADING.exec(line)
    if (h) {
      const Tag = `h${Math.min(6, h[1]!.length)}` as 'h1'
      out.push(<Tag key={k++}>{renderInline(h[2]!, `h${k}`)}</Tag>)
      i++
      continue
    }
    if (HR.test(line)) {
      out.push(<hr key={k++} />)
      i++
      continue
    }
    if (/^\s*>/.test(line)) {
      const q: string[] = []
      while (i < lines.length && /^\s*>/.test(lines[i]!)) q.push(lines[i++]!.replace(/^\s*>\s?/, ''))
      out.push(<blockquote key={k++}>{renderMarkdown(q.join('\n'))}</blockquote>)
      continue
    }
    if (line.includes('|') && i + 1 < lines.length && isTableSep(lines[i + 1]!)) {
      const head = splitRow(line)
      i += 2
      const rows: string[][] = []
      while (i < lines.length && lines[i]!.includes('|') && lines[i]!.trim() !== '') rows.push(splitRow(lines[i++]!))
      out.push(
        <div key={k++} className="ac-md__table" tabIndex={0} role="region" aria-label="Table">
          <table>
            <thead>
              <tr>
                {head.map((c, j) => (
                  <th key={j}>{renderInline(c, `th${j}`)}</th>
                ))}
              </tr>
            </thead>
            <tbody>
              {rows.map((r, ri) => (
                <tr key={ri}>
                  {r.map((c, j) => (
                    <td key={j}>{renderInline(c, `td${ri}-${j}`)}</td>
                  ))}
                </tr>
              ))}
            </tbody>
          </table>
        </div>
      )
      continue
    }
    const ul = UL.exec(line)
    const ol = ul ? null : OL.exec(line)
    if (ul || ol) {
      const re = ul ? UL : OL
      const items: string[] = []
      while (i < lines.length && re.test(lines[i]!)) items.push(re.exec(lines[i++]!)![1]!)
      const li = items.map((t, j) => <li key={j}>{renderInline(t, `li${j}`)}</li>)
      out.push(ul ? <ul key={k++}>{li}</ul> : <ol key={k++}>{li}</ol>)
      continue
    }
    const para: string[] = [line]
    i++
    while (i < lines.length && lines[i]!.trim() !== '' && !startsBlock(lines[i]!)) para.push(lines[i++]!)
    out.push(
      <p key={k++}>
        {para.map((t, j) => (
          <span key={j}>
            {j > 0 && <br />}
            {renderInline(t, `p${k}-${j}`)}
          </span>
        ))}
      </p>
    )
  }
  return out
}

export function CodeBlock({ lang, code }: { lang: string; code: string }): JSX.Element {
  return (
    <div className="ac-md__code">
      <div className="ac-md__codebar">
        <span className="ac-md__lang">{lang || 'text'}</span>
        <CopyButton text={code} label="code" />
      </div>
      <pre tabIndex={0} aria-label={`${lang || 'text'} code`}>
        <code>{code}</code>
      </pre>
    </div>
  )
}

export function Markdown({ text, className }: { text: string; className?: string }): JSX.Element {
  return <div className={`ac-md${className ? ` ${className}` : ''}`}>{renderMarkdown(text)}</div>
}
