import { describe, expect, it } from 'vitest'
import { tokenize } from './lexer'

describe('lexer', () => {
  it('tokenizes a declaration with correct kinds and positions', () => {
    const { tokens, errors } = tokenize('let x: i32 = 10 * (2 + 3);')
    expect(errors).toEqual([])
    expect(tokens.map((t) => t.kind)).toEqual([
      'keyword', // let
      'ident', // x
      'punct', // :
      'type', // i32
      'op', // =
      'int', // 10
      'op', // *
      'punct', // (
      'int', // 2
      'op', // +
      'int', // 3
      'punct', // )
      'punct', // ;
      'eof',
    ])
    expect(tokens.map((t) => t.text)).toEqual(['let', 'x', ':', 'i32', '=', '10', '*', '(', '2', '+', '3', ')', ';', ''])
    // every token sits on line 1 at the expected column
    const cols = tokens.slice(0, -1).map((t) => t.span.col)
    expect(cols).toEqual([1, 5, 6, 8, 12, 14, 17, 19, 20, 22, 24, 25, 26])
    expect(tokens.every((t) => t.span.line === 1)).toBe(true)
    expect(tokens[5].value).toBe(10)
    expect(tokens[5].span).toMatchObject({ start: 13, end: 15, col: 14, endCol: 16 })
  })

  it('tracks lines and columns across newlines and comments', () => {
    const src = 'fn main() {\n  // comment\n  var y = 1.5;\n}'
    const { tokens } = tokenize(src)
    const y = tokens.find((t) => t.text === 'y')!
    expect(y.span.line).toBe(3)
    expect(y.span.col).toBe(7)
    const f = tokens.find((t) => t.kind === 'float')!
    expect(f.value).toBeCloseTo(1.5)
    expect(f.span).toMatchObject({ line: 3, col: 11 })
    const close = tokens.find((t) => t.text === '}')!
    expect(close.span).toMatchObject({ line: 4, col: 1 })
  })

  it('prefers the longest operator', () => {
    const { tokens } = tokenize('a -> b <= c && d || !e != f')
    expect(tokens.filter((t) => t.kind === 'op').map((t) => t.text)).toEqual(['->', '<=', '&&', '||', '!', '!='])
  })

  it('classifies keywords, types, builtins and bools', () => {
    const { tokens } = tokenize('export fn if else while break continue return let var mem mem8 memf i32 f32 bool true false print setpixel')
    const kinds = new Map(tokens.map((t) => [t.text, t.kind]))
    expect(kinds.get('export')).toBe('keyword')
    expect(kinds.get('mem8')).toBe('keyword')
    expect(kinds.get('i32')).toBe('type')
    expect(kinds.get('bool')).toBe('type')
    expect(kinds.get('true')).toBe('bool')
    expect(kinds.get('print')).toBe('builtin')
    expect(kinds.get('setpixel')).toBe('builtin')
  })

  it('reads hex and exponent literals', () => {
    const { tokens } = tokenize('0xFF 1e3 2.5e-1 1_000')
    expect(tokens[0]).toMatchObject({ kind: 'int', value: 255 })
    expect(tokens[1]).toMatchObject({ kind: 'float', value: 1000 })
    expect(tokens[2].kind).toBe('float')
    expect(tokens[2].value).toBeCloseTo(0.25)
    expect(tokens[3]).toMatchObject({ kind: 'int', value: 1000 })
  })

  it('reports unexpected characters with their position', () => {
    const { tokens, errors } = tokenize('let a = 1;\nlet b = 2 $ 3;')
    expect(errors).toHaveLength(1)
    expect(errors[0].message).toContain("'$'")
    expect(errors[0].span).toMatchObject({ line: 2, col: 11 })
    expect(tokens.some((t) => t.kind === 'error')).toBe(true)
  })

  it('reports unterminated block comments', () => {
    const { errors } = tokenize('fn main() { /* never closed')
    expect(errors[0].message).toMatch(/unterminated/)
  })
})
