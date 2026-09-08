import type { Program } from './ast'
import { check, type CheckedProgram } from './checker'
import { disassemble } from './disassembler'
import { emit, type Annotation, type InstrRecord, type SectionInfo } from './emitter'
import { tokenize } from './lexer'
import { parse } from './parser'
import type { Diagnostic } from './span'
import type { Token } from './tokens'

export type StageName = 'source' | 'tokens' | 'ast' | 'typed' | 'bytes'

export interface StageResult {
  name: StageName
  /** true = passed, false = failed, null = not reached */
  ok: boolean | null
  ms: number
  errorCount: number
}

export interface CompileResult {
  source: string
  tokens: Token[]
  ast: Program | null
  checked: CheckedProgram | null
  bytes: Uint8Array<ArrayBuffer> | null
  annotations: Annotation[]
  instructions: InstrRecord[]
  sections: SectionInfo[]
  wat: string | null
  watMs: number
  diagnostics: Diagnostic[]
  stages: StageResult[]
  ok: boolean
  totalMs: number
}

const now = (): number => (typeof performance !== 'undefined' ? performance.now() : Date.now())

/**
 * Run the whole pipeline: source -> tokens -> AST -> typed AST -> bytes (-> WAT).
 * Stages after the first failure are marked as not reached, but every artifact
 * produced before that point is returned so the inspector can still show it.
 */
export function compile(source: string, options: { disassemble?: boolean } = {}): CompileResult {
  const wantWat = options.disassemble ?? true
  const stages: StageResult[] = [
    { name: 'source', ok: true, ms: 0, errorCount: 0 },
    { name: 'tokens', ok: null, ms: 0, errorCount: 0 },
    { name: 'ast', ok: null, ms: 0, errorCount: 0 },
    { name: 'typed', ok: null, ms: 0, errorCount: 0 },
    { name: 'bytes', ok: null, ms: 0, errorCount: 0 },
  ]
  const result: CompileResult = {
    source,
    tokens: [],
    ast: null,
    checked: null,
    bytes: null,
    annotations: [],
    instructions: [],
    sections: [],
    wat: null,
    watMs: 0,
    diagnostics: [],
    stages,
    ok: false,
    totalMs: 0,
  }
  const t0 = now()

  // tokens
  let t = now()
  const lexed = tokenize(source)
  result.tokens = lexed.tokens
  stages[1].ms = now() - t
  stages[1].errorCount = lexed.errors.length
  stages[1].ok = lexed.errors.length === 0
  result.diagnostics.push(...lexed.errors)
  if (!stages[1].ok) return finish(result, t0)

  // ast
  t = now()
  const parsed = parse(lexed.tokens)
  result.ast = parsed.program
  stages[2].ms = now() - t
  stages[2].errorCount = parsed.errors.length
  stages[2].ok = parsed.errors.length === 0
  result.diagnostics.push(...parsed.errors)
  if (!stages[2].ok) return finish(result, t0)

  // typed ast
  t = now()
  const checked = check(parsed.program)
  result.checked = checked
  stages[3].ms = now() - t
  stages[3].errorCount = checked.errors.length
  stages[3].ok = checked.ok
  result.diagnostics.push(...checked.errors)
  if (!checked.ok) return finish(result, t0)

  // bytes
  t = now()
  try {
    const emitted = emit(checked)
    result.bytes = emitted.bytes
    result.annotations = emitted.annotations
    result.instructions = emitted.instructions
    result.sections = emitted.sections
    stages[4].ok = true
  } catch (e) {
    stages[4].ok = false
    stages[4].errorCount = 1
    result.diagnostics.push({
      stage: 'emit',
      message: `internal emitter error: ${e instanceof Error ? e.message : String(e)}`,
      span: parsed.program.span,
    })
  }
  stages[4].ms = now() - t
  if (!stages[4].ok) return finish(result, t0)

  result.ok = true
  if (wantWat && result.bytes) {
    t = now()
    try {
      result.wat = disassemble(result.bytes).text
    } catch (e) {
      result.wat = `;; disassembly failed: ${e instanceof Error ? e.message : String(e)}`
    }
    result.watMs = now() - t
  }
  return finish(result, t0)
}

function finish(result: CompileResult, t0: number): CompileResult {
  result.totalMs = now() - t0
  return result
}

/** Convenience for tests and scripts: compile or throw with all diagnostics. */
export function compileOrThrow(source: string): Uint8Array<ArrayBuffer> {
  const r = compile(source, { disassemble: false })
  if (!r.ok || !r.bytes) {
    const msg = r.diagnostics.map((d) => `${d.span.line}:${d.span.col} ${d.message}`).join('\n')
    throw new Error(`compilation failed:\n${msg}`)
  }
  return r.bytes
}
