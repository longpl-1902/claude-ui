/** Shortens `text` to at most `max` characters, keeping the start and the end ("Implement…T34"). */
export function midEllipsis(text: string, max: number): string {
  if (max < 3 || text.length <= max) return text
  const keep = max - 1
  const head = Math.ceil(keep * 0.6)
  const tail = keep - head
  return `${text.slice(0, head).trimEnd()}…${tail > 0 ? text.slice(text.length - tail).trimStart() : ''}`
}
