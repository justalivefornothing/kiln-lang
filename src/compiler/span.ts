/** A half-open byte range [start, end) in the source with 1-based line/column of both ends. */
export interface Span {
  start: number
  end: number
  line: number
  col: number
  endLine: number
  endCol: number
}

export function spanFrom(a: Span, b: Span): Span {
  return {
    start: a.start,
    end: b.end,
    line: a.line,
    col: a.col,
    endLine: b.endLine,
    endCol: b.endCol,
  }
}

export function pointSpan(offset: number, line: number, col: number): Span {
  return { start: offset, end: offset, line, col, endLine: line, endCol: col }
}

export type Stage = 'lex' | 'parse' | 'check' | 'emit'

export interface Diagnostic {
  stage: Stage
  message: string
  span: Span
  /** Optional hint appended by the UI. */
  hint?: string
}

export function formatDiagnostic(d: Diagnostic): string {
  return `${d.span.line}:${d.span.col} ${d.stage} error: ${d.message}`
}
