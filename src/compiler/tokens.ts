import type { Span } from './span'

export type TokenKind =
  | 'keyword'
  | 'type'
  | 'ident'
  | 'builtin'
  | 'int'
  | 'float'
  | 'bool'
  | 'op'
  | 'punct'
  | 'eof'
  | 'error'

export interface Token {
  kind: TokenKind
  /** The exact source text of the token ('' for eof). */
  text: string
  span: Span
  /** Numeric value for int/float tokens. */
  value?: number
}

export const KEYWORDS = new Set([
  'fn',
  'export',
  'let',
  'var',
  'if',
  'else',
  'while',
  'break',
  'continue',
  'return',
  'mem',
  'mem8',
  'memf',
])

export const TYPE_NAMES = new Set(['i32', 'f32', 'bool'])

/** Host-provided functions (WASM imports) and compiler intrinsics (lowered to opcodes). */
export const BUILTIN_NAMES = new Set([
  'print',
  'printf',
  'setpixel',
  'rand',
  'clear',
  'sqrt',
  'floor',
  'abs',
  'min',
  'max',
])

/** Multi-character operators must be listed longest first so the lexer prefers them. */
export const OPERATORS = ['->', '==', '!=', '<=', '>=', '&&', '||', '+=', '-=', '*=', '/=', '%=', '+', '-', '*', '/', '%', '=', '<', '>', '!']

export const PUNCTUATION = ['(', ')', '{', '}', '[', ']', ',', ':', ';']
