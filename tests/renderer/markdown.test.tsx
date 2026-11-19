// @vitest-environment jsdom
import './jestDom'
import { readFileSync } from 'node:fs'
import { fireEvent, render, screen, within } from '@testing-library/react'
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest'
import { Markdown } from '@renderer/components/chat/Markdown'

const open = vi.fn()
beforeEach(() => {
  open.mockReset()
  ;(window as unknown as { api: unknown }).api = { app: { openExternal: open } }
})
afterEach(() => {
  delete (window as unknown as { api?: unknown }).api
})

const md = (text: string) => render(<Markdown text={text} />).container.firstElementChild as HTMLElement

describe('T33 Markdown subset', () => {
  it('renders headings, paragraphs, bold, italic and inline code', () => {
    const root = md('# Title\n\n### Small\n\nHello **bold** and *it* and `x()`.')
    expect(within(root).getByRole('heading', { level: 1, name: 'Title' })).toBeInTheDocument()
    expect(within(root).getByRole('heading', { level: 3, name: 'Small' })).toBeInTheDocument()
    expect(root.querySelector('strong')).toHaveTextContent('bold')
    expect(root.querySelector('em')).toHaveTextContent('it')
    expect(root.querySelector('p code')).toHaveTextContent('x()')
  })

  it('renders lists, blockquotes and tables', () => {
    const root = md('- a\n- b\n\n1. one\n2. two\n\n> quoted **q**\n\n| H1 | H2 |\n| --- | --- |\n| c1 | c2 |')
    expect(root.querySelectorAll('ul > li')).toHaveLength(2)
    expect(root.querySelectorAll('ol > li')).toHaveLength(2)
    expect(root.querySelector('blockquote strong')).toHaveTextContent('q')
    expect(within(root).getAllByRole('columnheader').map((c) => c.textContent)).toEqual(['H1', 'H2'])
    expect(within(root).getAllByRole('cell').map((c) => c.textContent)).toEqual(['c1', 'c2'])
  })

  it('fenced code: language label, exact text, scrolls inside its own block', () => {
    const long = 'x'.repeat(400)
    const root = md('```ts\nconst a = 1\n' + long + '\n```\nafter')
    expect(root.querySelector('.ac-md__lang')).toHaveTextContent('ts')
    const pre = root.querySelector('pre')!
    expect(pre.textContent).toBe('const a = 1\n' + long)
    expect(pre.tabIndex).toBe(0)
    expect(screen.getByRole('button', { name: 'Copy code' })).toBeInTheDocument()
    expect(root).toHaveTextContent('after')
    const css = readFileSync('src/renderer/src/components/chat/chat.css', 'utf8')
    expect(css).toMatch(/\.ac-md__code pre \{[^}]*overflow-x: auto/)
  })

  it('a streaming, still-open fence renders as a code block', () => {
    const root = md('text\n```py\nprint(1)')
    expect(root.querySelector('pre')?.textContent).toBe('print(1)')
  })

  it('raw HTML and script are literal text, never elements', () => {
    const root = md('<script>window.hacked=1</script>\n\n<img src=x onerror="window.hacked=1">\n\n<b>not bold</b>')
    expect(root.querySelector('script, img, b')).toBeNull()
    expect(root.textContent).toContain('<script>window.hacked=1</script>')
    expect(root.textContent).toContain('<b>not bold</b>')
    expect((window as unknown as { hacked?: number }).hacked).toBeUndefined()
  })

  it('HTML inside code, link labels and table cells stays literal', () => {
    const root = md('`<i>x</i>` [<u>l</u>](https://a.b) \n\n| <s>h</s> |\n| - |\n| <em>c</em> |')
    expect(root.querySelector('i, u, s')).toBeNull()
    expect(root.textContent).toContain('<i>x</i>')
    expect(root.textContent).toContain('<u>l</u>')
    expect(root.textContent).toContain('<s>h</s>')
  })

  it('http/https links are anchors that open through app.openExternal, not navigation', () => {
    const root = md('see [docs](https://example.com/a?b=1)')
    const a = within(root).getByRole('link', { name: 'docs' })
    expect(a).toHaveAttribute('href', 'https://example.com/a?b=1')
    expect(a).toHaveAttribute('rel', expect.stringContaining('noopener'))
    expect(fireEvent.click(a)).toBe(false)
    expect(open).toHaveBeenCalledWith('https://example.com/a?b=1')
  })

  it.each(['javascript:alert(1)', 'file:///C:/Windows/win.ini', 'data:text/html,hi', 'vbscript:x', 'JaVaScRiPt:alert(1)'])(
    '%s is not clickable',
    (u) => {
      const root = md(`[bad](${u})`)
      expect(root.querySelector('a')).toBeNull()
      expect(root.textContent).toContain(`[bad](${u})`)
      expect(open).not.toHaveBeenCalled()
    }
  )

  it('never uses dangerouslySetInnerHTML', () => {
    for (const f of ['Markdown', 'ChatView', 'ToolCallRow', 'Composer', 'CopyButton'])
      expect(readFileSync(`src/renderer/src/components/chat/${f}.tsx`, 'utf8')).not.toMatch(/dangerouslySetInnerHTML=|__html|innerHTML\s*=/)
  })
})
