export class JsoncError extends Error {
  constructor(message = 'Invalid JSONC') {
    super(message)
    this.name = 'JsoncError'
  }
}

function skipString(text: string, start: number): number {
  let j = start + 1
  while (j < text.length && text[j] !== '"') j += text[j] === '\\' ? 2 : 1
  return j + 1
}

/** Replace comments with whitespace, honouring string literals. */
function stripComments(text: string): string {
  let out = ''
  let i = 0
  const n = text.length
  while (i < n) {
    const c = text[i]!
    if (c === '"') {
      const end = skipString(text, i)
      out += text.slice(i, end)
      i = end
    } else if (c === '/' && text[i + 1] === '/') {
      while (i < n && text[i] !== '\n') i++
    } else if (c === '/' && text[i + 1] === '*') {
      const end = text.indexOf('*/', i + 2)
      i = end === -1 ? n : end + 2
      out += ' '
    } else {
      out += c
      i++
    }
  }
  return out
}

/** Drop commas that are directly followed (ignoring whitespace) by } or ]. */
function stripTrailingCommas(text: string): string {
  let out = ''
  let i = 0
  const n = text.length
  while (i < n) {
    const c = text[i]!
    if (c === '"') {
      const end = skipString(text, i)
      out += text.slice(i, end)
      i = end
    } else if (c === ',') {
      let j = i + 1
      while (j < n && /\s/.test(text[j]!)) j++
      if (text[j] !== '}' && text[j] !== ']') out += c
      i++
    } else {
      out += c
      i++
    }
  }
  return out
}

export function parseJsonc(text: string): unknown {
  const src = text.charCodeAt(0) === 0xfeff ? text.slice(1) : text
  const cleaned = stripTrailingCommas(stripComments(src))
  if (cleaned.trim() === '') return {}
  try {
    return JSON.parse(cleaned)
  } catch {
    throw new JsoncError('Invalid JSONC')
  }
}
