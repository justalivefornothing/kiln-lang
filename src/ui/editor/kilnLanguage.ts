import { autocompletion, type Completion, type CompletionContext, type CompletionResult } from '@codemirror/autocomplete'
import { HighlightStyle, StreamLanguage, syntaxHighlighting, type StringStream } from '@codemirror/language'
import { tags as t } from '@lezer/highlight'
import { HOST_FUNCTIONS, INTRINSICS } from '../../compiler/checker'
import { BUILTIN_NAMES, KEYWORDS, TYPE_NAMES } from '../../compiler/tokens'

interface KilnState {
  inBlockComment: boolean
  /** Set after `fn` so the next identifier is styled as a definition. */
  expectFnName: boolean
}

/**
 * Editing-only tokenizer for CodeMirror. The real lexer lives in src/compiler;
 * this one just needs to be fast and forgiving so highlighting never breaks.
 */
export const kilnStreamParser = {
  name: 'kiln',
  startState: (): KilnState => ({ inBlockComment: false, expectFnName: false }),
  copyState: (s: KilnState): KilnState => ({ ...s }),
  token(stream: StringStream, state: KilnState): string | null {
    if (state.inBlockComment) {
      while (!stream.eol()) {
        if (stream.match('*/')) {
          state.inBlockComment = false
          return 'comment'
        }
        stream.next()
      }
      return 'comment'
    }
    if (stream.eatSpace()) return null
    if (stream.match('//')) {
      stream.skipToEnd()
      return 'comment'
    }
    if (stream.match('/*')) {
      state.inBlockComment = true
      return 'comment'
    }
    if (stream.match(/^0[xX][0-9a-fA-F_]+/) || stream.match(/^\d[\d_]*(\.\d[\d_]*)?([eE][+-]?\d+)?/)) return 'number'
    const word = stream.match(/^[A-Za-z_][A-Za-z0-9_]*/)
    if (word) {
      const text = (word as RegExpMatchArray)[0]
      if (state.expectFnName) {
        state.expectFnName = false
        return 'def'
      }
      if (text === 'fn') {
        state.expectFnName = true
        return 'keyword'
      }
      if (text === 'true' || text === 'false') return 'atom'
      if (KEYWORDS.has(text)) return text.startsWith('mem') ? 'namespace' : 'keyword'
      if (TYPE_NAMES.has(text)) return 'typeName'
      if (BUILTIN_NAMES.has(text)) return 'builtin'
      // a plain identifier followed by ( is a user function call
      if (stream.peek() === '(') return 'variableName.function'
      return 'variableName'
    }
    if (stream.match(/^(->|==|!=|<=|>=|&&|\|\||[+\-*/%]=|[+\-*/%=<>!])/)) return 'operator'
    if (stream.match(/^[(){}[\],:;]/)) return 'punctuation'
    stream.next()
    return 'invalid'
  },
  languageData: {
    commentTokens: { line: '//', block: { open: '/*', close: '*/' } },
    closeBrackets: { brackets: ['(', '[', '{'] },
    indentOnInput: /^\s*\}$/,
  },
  tokenTable: {
    builtin: t.standard(t.variableName),
    namespace: t.namespace,
    'variableName.function': t.function(t.variableName),
    def: t.definition(t.variableName),
    invalid: t.invalid,
  },
}

export const kilnLanguage = StreamLanguage.define<KilnState>(kilnStreamParser)

export const kilnHighlightStyle = HighlightStyle.define([
  { tag: t.keyword, color: 'var(--color-tok-keyword)' },
  { tag: t.typeName, color: 'var(--color-tok-type)' },
  { tag: t.standard(t.variableName), color: 'var(--color-tok-builtin)' },
  { tag: t.namespace, color: 'var(--color-sec-memory)' },
  { tag: t.function(t.variableName), color: 'var(--color-ink)', fontWeight: '500' },
  { tag: t.definition(t.variableName), color: 'var(--color-ember-2)', fontWeight: '600' },
  { tag: t.variableName, color: 'var(--color-tok-ident)' },
  { tag: t.number, color: 'var(--color-tok-number)' },
  { tag: t.atom, color: 'var(--color-tok-bool)' },
  { tag: t.operator, color: 'var(--color-tok-op)' },
  { tag: t.punctuation, color: 'var(--color-tok-punct)' },
  { tag: t.comment, color: 'var(--color-tok-comment)', fontStyle: 'italic' },
  { tag: t.invalid, color: 'var(--color-rust)', textDecoration: 'underline wavy' },
])

// ---- autocompletion ---------------------------------------------------------

const KEYWORD_COMPLETIONS: Completion[] = [
  { label: 'fn', type: 'keyword', apply: 'fn name() {\n  \n}', detail: 'function' },
  { label: 'export fn', type: 'keyword', apply: 'export fn main() {\n  \n}', detail: 'exported function' },
  { label: 'let', type: 'keyword', detail: 'immutable binding' },
  { label: 'var', type: 'keyword', detail: 'mutable binding' },
  { label: 'if', type: 'keyword', apply: 'if cond {\n  \n}' },
  { label: 'else', type: 'keyword' },
  { label: 'while', type: 'keyword', apply: 'while cond {\n  \n}' },
  { label: 'break', type: 'keyword' },
  { label: 'continue', type: 'keyword' },
  { label: 'return', type: 'keyword' },
  { label: 'true', type: 'constant' },
  { label: 'false', type: 'constant' },
  { label: 'mem', type: 'namespace', apply: 'mem[', detail: 'i32 cells of linear memory' },
  { label: 'mem8', type: 'namespace', apply: 'mem8[', detail: 'bytes of linear memory' },
  { label: 'memf', type: 'namespace', apply: 'memf[', detail: 'f32 cells of linear memory' },
  { label: 'i32', type: 'type', detail: '32-bit integer / cast' },
  { label: 'f32', type: 'type', detail: '32-bit float / cast' },
  { label: 'bool', type: 'type' },
]

function sigDetail(params: string[], ret: string): string {
  return `(${params.join(', ')})${ret === 'void' ? '' : ' -> ' + ret}`
}

const BUILTIN_DOCS: Record<string, string> = {
  print: 'Print an i32 to the console.',
  printf: 'Print an f32 to the console.',
  setpixel: 'Paint pixel (x, y) on the 256x256 canvas with r, g, b in 0..255.',
  rand: 'Pseudo-random f32 in [0, 1).',
  clear: 'Clear the canvas to black.',
  sqrt: 'Square root (lowered to f32.sqrt).',
  floor: 'Round toward negative infinity (f32.floor).',
  abs: 'Absolute value (f32.abs).',
  min: 'Smaller of two f32 values (f32.min).',
  max: 'Larger of two f32 values (f32.max).',
}

const BUILTIN_COMPLETIONS: Completion[] = [
  ...Object.entries(HOST_FUNCTIONS).map(([name, sig]) => ({
    label: name,
    type: 'function',
    detail: sigDetail(sig.params, sig.ret) + '  host import',
    info: BUILTIN_DOCS[name],
    apply: `${name}(`,
  })),
  ...Object.entries(INTRINSICS).map(([name, sig]) => ({
    label: name,
    type: 'function',
    detail: sigDetail(sig.params, sig.ret) + '  intrinsic',
    info: BUILTIN_DOCS[name],
    apply: `${name}(`,
  })),
]

const IDENT_RE = /[A-Za-z_][A-Za-z0-9_]*/g
const RESERVED = new Set([...KEYWORDS, ...TYPE_NAMES, ...BUILTIN_NAMES, 'true', 'false'])

function kilnCompletions(context: CompletionContext): CompletionResult | null {
  const word = context.matchBefore(/[A-Za-z_][A-Za-z0-9_]*/)
  if (!word && !context.explicit) return null
  const from = word ? word.from : context.pos
  // identifiers already present in the document (functions, variables) — cheap, no compiler needed
  const doc = context.state.doc.toString()
  const seen = new Set<string>()
  const fnNames = new Set<string>()
  for (const m of doc.matchAll(/\bfn\s+([A-Za-z_][A-Za-z0-9_]*)/g)) fnNames.add(m[1])
  for (const m of doc.matchAll(IDENT_RE)) {
    const name = m[0]
    if (RESERVED.has(name) || seen.has(name)) continue
    if (m.index !== undefined && m.index <= context.pos && m.index + name.length >= context.pos) continue // the word being typed
    seen.add(name)
  }
  const locals: Completion[] = [...seen].map((name) => ({
    label: name,
    type: fnNames.has(name) ? 'function' : 'variable',
    apply: fnNames.has(name) ? `${name}(` : name,
    boost: 1,
  }))
  return {
    from,
    options: [...locals, ...BUILTIN_COMPLETIONS, ...KEYWORD_COMPLETIONS],
    validFor: /^[A-Za-z_][A-Za-z0-9_]*$/,
  }
}

export function kilnSupport() {
  return [
    kilnLanguage,
    syntaxHighlighting(kilnHighlightStyle),
    autocompletion({ override: [kilnCompletions], icons: false, activateOnTyping: true, maxRenderedOptions: 24 }),
  ]
}
