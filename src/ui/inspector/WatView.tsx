import { useMemo, type ReactNode } from 'react'
import { useStore } from '../../state/store'

/** Minimal WAT colorizer: s-expression heads, instructions, numbers, strings, ids and comments. */
function colorize(line: string, key: number): ReactNode {
  const parts: ReactNode[] = []
  const re = /(;;.*$)|(\(;.*?;\))|("(?:[^"\\]|\\.)*")|(\$[A-Za-z0-9_.]+)|(\((?:module|type|func|param|result|import|export|memory|local))|(\b(?:offset|align)=\d+)|(-?\b\d+(?:\.\d+)?(?:e[+-]?\d+)?\b)|(\b(?:i32|f32)\.[a-z0-9_]+|\b(?:block|loop|if|else|end|br|br_if|return|call|drop|select|unreachable|nop|local\.(?:get|set|tee))\b)|([()])/g
  let last = 0
  let m: RegExpExecArray | null
  let i = 0
  while ((m = re.exec(line)) !== null) {
    if (m.index > last) parts.push(line.slice(last, m.index))
    const text = m[0]
    let cls = 'text-ink'
    if (m[1] || m[2]) cls = 'text-tok-comment italic'
    else if (m[3]) cls = 'text-tok-bool'
    else if (m[4]) cls = 'text-sec-import'
    else if (m[5]) cls = 'text-tok-keyword'
    else if (m[6]) cls = 'text-muted'
    else if (m[7]) cls = 'text-tok-number'
    else if (m[8]) cls = text.startsWith('i32') || text.startsWith('f32') ? 'text-tok-type' : 'text-ember-2'
    else if (m[9]) cls = 'text-tok-punct'
    parts.push(
      <span key={`${key}-${i++}`} className={cls}>
        {text}
      </span>,
    )
    last = m.index + text.length
  }
  if (last < line.length) parts.push(line.slice(last))
  return parts
}

export function WatView() {
  const wat = useStore((s) => s.result.wat)
  const watMs = useStore((s) => s.result.watMs)
  const instructions = useStore((s) => s.result.instructions.length)
  const diagnostics = useStore((s) => s.result.diagnostics)

  const lines = useMemo(() => (wat ? wat.split('\n') : []), [wat])

  if (!wat) {
    return (
      <div className="flex flex-1 flex-col items-center justify-center gap-2 p-6 text-center text-muted">
        <span className="text-[13px]">No disassembly: the module was not emitted.</span>
        {diagnostics[0] && (
          <span className="font-mono text-[11px] text-rust">
            {diagnostics[0].span.line}:{diagnostics[0].span.col} {diagnostics[0].message}
          </span>
        )}
      </div>
    )
  }

  return (
    <div className="flex min-h-0 flex-1 flex-col">
      <div className="flex items-center gap-3 border-b border-line px-3 py-2 font-mono text-[11px] text-muted">
        <span>{lines.length} lines</span>
        <span>{instructions} instructions</span>
        <span className="text-muted-2">disassembled from the bytes in {watMs.toFixed(2)} ms</span>
      </div>
      <pre className="min-h-0 flex-1 overflow-auto px-2 py-2 font-mono text-[12px] leading-[1.6]">
        {lines.map((l, i) => (
          <div key={i} className="flex hover:bg-white/[0.03]">
            <span className="w-9 shrink-0 select-none pr-3 text-right text-[10.5px] text-muted-2">{i + 1}</span>
            <span className="whitespace-pre">{colorize(l, i)}</span>
          </div>
        ))}
      </pre>
    </div>
  )
}
