import { describe, expect, it } from 'vitest'
import { JsoncError, parseJsonc } from '../../../src/main/accounts/jsonc'

describe('R-04 parseJsonc', () => {
  it('R-04 strips line comments', () => {
    expect(parseJsonc('{ // note\n "a": 1 // tail\n}')).toEqual({ a: 1 })
  })
  it('R-04 strips block comments, including multi-line', () => {
    expect(parseJsonc('{ /* x */ "a": /* y\n z */ 2 }')).toEqual({ a: 2 })
  })
  it('R-04 keeps // inside strings', () => {
    expect(parseJsonc('{"u": "https://x//y", "b": "/* not a comment */"}')).toEqual({
      u: 'https://x//y',
      b: '/* not a comment */'
    })
  })
  it('R-04 handles escaped quotes inside strings before a comment', () => {
    expect(parseJsonc('{"a": "say \\"hi\\" // still string"} // real comment')).toEqual({
      a: 'say "hi" // still string'
    })
  })
  it('R-04 removes trailing commas in objects and arrays', () => {
    expect(parseJsonc('{"a": [1, 2, ], "b": {"c": 3,},}')).toEqual({ a: [1, 2], b: { c: 3 } })
  })
  it('R-04 keeps commas inside strings', () => {
    expect(parseJsonc('{"a": "x,]"}')).toEqual({ a: 'x,]' })
  })
  it('R-04 strips a BOM', () => {
    expect(parseJsonc('﻿{"a": 1}')).toEqual({ a: 1 })
  })
  it('R-04 treats an empty or whitespace-only file as {}', () => {
    expect(parseJsonc('')).toEqual({})
    expect(parseJsonc('  \n\t ')).toEqual({})
  })
  it('R-04 invalid input throws JsoncError whose message excludes the input', () => {
    const secret = 'SUPER-SECRET-VALUE-123'
    let err: unknown
    try {
      parseJsonc(`{"token": "${secret}", oops}`)
    } catch (e) {
      err = e
    }
    expect(err).toBeInstanceOf(JsoncError)
    expect((err as Error).message).not.toContain(secret)
    expect((err as Error).message).not.toContain('oops')
  })
})
