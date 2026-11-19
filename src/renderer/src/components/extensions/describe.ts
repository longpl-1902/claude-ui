/** A bare YAML block indicator (">-", "|") is not a description; the parser behind it is fixed later. */
export function describe(d: string | undefined): string | undefined {
  if (d === undefined) return undefined
  return /^[>|][+-]?$/.test(d.trim()) ? 'No description' : d
}
