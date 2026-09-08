import { useMemo } from 'react'
import type { Token, TokenKind } from '../../compiler/tokens'
import { useStore } from '../../state/store'

const KIND_STYLE: Record<TokenKind, string> = {
  keyword: 'border-tok-keyword/40 bg-tok-keyword/10 text-tok-keyword',
  type: 'border-tok-type/40 bg-tok-type/10 text-tok-type',
  builtin: 'border-tok-builtin/40 bg-tok-builtin/10 text-tok-builtin',
  ident: 'border-line-2 bg-panel-2 text-tok-ident',
  int: 'border-tok-number/40 bg-tok-number/10 text-tok-number',
  float: 'border-tok-number/40 bg-tok-number/10 text-tok-number',
  bool: 'border-tok-bool/40 bg-tok-bool/10 text-tok-bool',
  op: 'border-line-2 bg-panel-3 text-tok-op',
  punct: 'border-line bg-transparent text-tok-punct',
  eof: 'border-dashed border-line-2 text-muted-2',
  error: 'border-rust bg-rust/15 text-rust',
}

const LEGEND: TokenKind[] = ['keyword', 'type', 'builtin', 'ident', 'int', 'float', 'bool', 'op', 'punct', 'error']

export function TokensView() {
  const tokens = useStore((s) => s.result.tokens)
  const hoverSpan = useStore((s) => s.hoverSpan)
  const setHoverSpan = useStore((s) => s.setHoverSpan)
  const reveal = useStore((s) => s.reveal)

  const lines = useMemo(() => {
    const byLine = new Map<number, Token[]>()
    for (const t of tokens) {
      const arr = byLine.get(t.span.line) ?? []
      arr.push(t)
      byLine.set(t.span.line, arr)
    }
    return [...byLine.entries()].sort((a, b) => a[0] - b[0])
  }, [tokens])

  const counts = useMemo(() => {
    const c = new Map<TokenKind, number>()
    for (const t of tokens) c.set(t.kind, (c.get(t.kind) ?? 0) + 1)
    return c
  }, [tokens])

  return (
    <div className="flex min-h-0 flex-1 flex-col">
      <div className="flex flex-wrap items-center gap-1.5 border-b border-line px-3 py-2">
        {LEGEND.filter((k) => (counts.get(k) ?? 0) > 0 || k === 'ident').map((k) => (
          <span key={k} className={`inline-flex items-center gap-1 rounded border px-1.5 py-px font-mono text-[10px] ${KIND_STYLE[k]}`}>
            {k}
            <span className="opacity-70">{counts.get(k) ?? 0}</span>
          </span>
        ))}
        <span className="ml-auto font-mono text-[11px] text-muted">{tokens.length} tokens</span>
      </div>
      <div className="min-h-0 flex-1 overflow-auto p-2" onMouseLeave={() => setHoverSpan(null)}>
        {lines.map(([lineNo, toks]) => (
          <div key={lineNo} className="flex items-start gap-2 py-0.5">
            <span className="w-7 shrink-0 select-none pt-1 text-right font-mono text-[10px] text-muted-2">{lineNo}</span>
            <div className="flex flex-wrap gap-1">
              {toks.map((t, i) => {
                const hot = hoverSpan !== null && hoverSpan.start === t.span.start && hoverSpan.end === t.span.end
                return (
                  <button
                    type="button"
                    key={`${t.span.start}-${i}`}
                    className={`rounded border px-1.5 py-px font-mono text-[11.5px] leading-5 transition-shadow hover:shadow-glow focus-visible:shadow-glow ${KIND_STYLE[t.kind]} ${hot ? 'shadow-glow' : ''}`}
                    title={`${t.kind} · ${t.span.line}:${t.span.col}–${t.span.endLine}:${t.span.endCol}${t.value !== undefined ? ` · value ${t.value}` : ''}`}
                    onMouseEnter={() => setHoverSpan(t.span)}
                    onFocus={() => setHoverSpan(t.span)}
                    onClick={() => reveal(t.span)}
                  >
                    {t.kind === 'eof' ? 'EOF' : t.text}
                  </button>
                )
              })}
            </div>
          </div>
        ))}
      </div>
    </div>
  )
}
