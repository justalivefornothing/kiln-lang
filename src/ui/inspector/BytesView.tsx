import { useEffect, useMemo, useState } from 'react'
import type { Annotation, SectionInfo } from '../../compiler/emitter'
import { hex } from '../../compiler/leb128'
import type { SectionName } from '../../compiler/opcodes'
import { useStore } from '../../state/store'

type SectionKey = SectionName | 'header'

export const SECTION_COLORS: Record<string, string> = {
  header: 'var(--color-sec-header)',
  type: 'var(--color-sec-type)',
  import: 'var(--color-sec-import)',
  function: 'var(--color-sec-function)',
  memory: 'var(--color-sec-memory)',
  export: 'var(--color-sec-export)',
  code: 'var(--color-sec-code)',
}

const SECTION_BLURB: Record<string, string> = {
  header: 'magic number "\\0asm" + version 1',
  type: 'deduplicated function signatures',
  import: 'host functions from module "env"',
  function: 'type index of each defined function',
  memory: 'one linear memory, 1 page (64 KiB)',
  export: 'exported memory and functions',
  code: 'locals (run-length) + instructions per function',
}

interface ByteInfo {
  section: SectionKey
  leaf: Annotation | null
  instr: Annotation | null
  /** true for the first byte of an instruction (the opcode) */
  opcode: boolean
}

function buildByteInfo(length: number, annotations: Annotation[]): ByteInfo[] {
  const info: ByteInfo[] = new Array(length)
  for (let i = 0; i < length; i++) info[i] = { section: 'header', leaf: null, instr: null, opcode: false }
  for (const a of annotations) {
    for (let i = a.start; i < a.end && i < length; i++) {
      const b = info[i]
      b.section = a.section
      if (a.kind === 'instr') {
        b.instr = a
        if (i === a.start) b.opcode = true
      } else if (!b.leaf || a.end - a.start < b.leaf.end - b.leaf.start) {
        b.leaf = a
      }
    }
  }
  return info
}

function rowsFor(start: number, end: number): { offset: number; count: number }[] {
  const rows: { offset: number; count: number }[] = []
  for (let o = start; o < end; o += 16) rows.push({ offset: o, count: Math.min(16, end - o) })
  return rows
}

export function BytesView() {
  const bytes = useStore((s) => s.result.bytes)
  const annotations = useStore((s) => s.result.annotations)
  const sections = useStore((s) => s.result.sections)
  const prevBytes = useStore((s) => s.prevBytes)
  const compileId = useStore((s) => s.compileId)
  const diagnostics = useStore((s) => s.result.diagnostics)
  const setHoverSpan = useStore((s) => s.setHoverSpan)
  const reveal = useStore((s) => s.reveal)
  const source = useStore((s) => s.source)
  const [hot, setHot] = useState<number | null>(null)

  const info = useMemo(() => (bytes ? buildByteInfo(bytes.length, annotations) : []), [bytes, annotations])

  const changed = useMemo(() => {
    const set = new Set<number>()
    if (!bytes || !prevBytes) return set
    for (let i = 0; i < bytes.length; i++) if (i >= prevBytes.length || prevBytes[i] !== bytes[i]) set.add(i)
    return set
  }, [bytes, prevBytes])

  useEffect(() => {
    setHot(null)
  }, [compileId])

  if (!bytes) {
    return (
      <div className="flex flex-1 flex-col items-center justify-center gap-2 p-6 text-center text-muted">
        <span className="text-[13px]">No module: fix the compile errors and the bytes will appear here.</span>
        {diagnostics[0] && (
          <span className="font-mono text-[11px] text-rust">
            {diagnostics[0].span.line}:{diagnostics[0].span.col} {diagnostics[0].message}
          </span>
        )}
      </div>
    )
  }

  const hotInfo = hot !== null ? info[hot] : null
  const hotGroup: [number, number] | null = hotInfo ? (hotInfo.instr ? [hotInfo.instr.start, hotInfo.instr.end] : hotInfo.leaf ? [hotInfo.leaf.start, hotInfo.leaf.end] : [hot!, hot! + 1]) : null

  const groups: { key: SectionKey; start: number; end: number; section?: SectionInfo }[] = [
    { key: 'header', start: 0, end: 8 },
    ...sections.map((s) => ({ key: s.name as SectionKey, start: s.start, end: s.end, section: s })),
  ]

  return (
    <div className="flex min-h-0 flex-1 flex-col">
      <div className="flex flex-wrap items-center gap-x-3 gap-y-1 border-b border-line px-3 py-2">
        {groups.map((g) => (
          <span key={g.key} className="inline-flex items-center gap-1.5 font-mono text-[11px] text-muted">
            <span className="inline-block h-2.5 w-2.5 rounded-sm" style={{ background: SECTION_COLORS[g.key] }} />
            {g.key}
            <span className="text-muted-2">{g.end - g.start} B</span>
          </span>
        ))}
        <span className="ml-auto font-mono text-[11px] text-muted">
          {bytes.length} bytes{changed.size > 0 && prevBytes ? <span className="text-ember-2"> · {changed.size} changed</span> : null}
        </span>
      </div>

      <div
        className="min-h-0 flex-1 overflow-auto px-3 py-2 font-mono text-[12px]"
        onMouseLeave={() => {
          setHot(null)
          setHoverSpan(null)
        }}
      >
        {groups.map((g) => {
          const color = SECTION_COLORS[g.key]
          return (
            <section key={g.key} className="mb-3" aria-label={`${g.key} section`}>
              <h3 className="mb-1 flex items-center gap-2 whitespace-nowrap text-[11px]">
                <span className="inline-block h-2.5 w-2.5 rounded-sm" style={{ background: color }} />
                <span className="shrink-0 font-semibold" style={{ color }}>
                  {g.key === 'header' ? 'module header' : `${g.key} section`}
                </span>
                {g.section ? <span className="shrink-0 text-muted-2">id {g.section.id}</span> : null}
                <span className="min-w-0 truncate text-muted-2">{SECTION_BLURB[g.key]}</span>
                <span className="ml-auto shrink-0 pl-2 text-muted-2">
                  0x{g.start.toString(16).padStart(4, '0')} · {g.end - g.start} B
                </span>
              </h3>
              {rowsFor(g.start, g.end).map((row) => (
                <div key={row.offset} className="flex items-center gap-2">
                  <span className="w-10 shrink-0 select-none text-right text-[10.5px] text-muted-2">{row.offset.toString(16).padStart(4, '0')}</span>
                  <div className="flex flex-wrap">
                    {Array.from({ length: row.count }, (_, k) => {
                      const off = row.offset + k
                      const b = info[off]
                      const isChanged = changed.has(off)
                      const inGroup = hotGroup !== null && off >= hotGroup[0] && off < hotGroup[1]
                      const emphasis = b.opcode || (!b.instr && (b.leaf?.kind === 'section-id' || b.leaf?.kind === 'count' || b.leaf?.kind === 'section-size'))
                      return (
                        <span
                          key={isChanged ? `${compileId}-${off}` : off}
                          className="hexbyte"
                          style={{ color, opacity: emphasis ? 1 : 0.72, fontWeight: emphasis ? 600 : 400 }}
                          data-hot={inGroup}
                          data-changed={isChanged}
                          onMouseEnter={() => {
                            setHot(off)
                            setHoverSpan(b.instr?.span ?? null)
                          }}
                          onClick={() => b.instr?.span && reveal(b.instr.span)}
                          role={b.instr?.span ? 'button' : undefined}
                          tabIndex={b.opcode ? 0 : -1}
                          onFocus={() => {
                            setHot(off)
                            setHoverSpan(b.instr?.span ?? null)
                          }}
                          onKeyDown={(e) => {
                            if (e.key === 'Enter' && b.instr?.span) reveal(b.instr.span)
                          }}
                        >
                          {hex(bytes[off])}
                        </span>
                      )
                    })}
                  </div>
                </div>
              ))}
            </section>
          )
        })}
      </div>

      <DetailStrip offset={hot} info={hotInfo} source={source} />
    </div>
  )
}

function DetailStrip({ offset, info, source }: { offset: number | null; info: ByteInfo | null; source: string }) {
  if (offset === null || !info) {
    return (
      <div className="shrink-0 border-t border-line bg-panel-2 px-3 py-2 text-[11.5px] text-muted-2">
        Hover a byte to decode it. Bytes are colored by section; in the code section, opcodes are bold and their immediates dim. Click an instruction to jump to
        the source that produced it.
      </div>
    )
  }
  const color = SECTION_COLORS[info.section]
  const leaf = info.leaf
  const instr = info.instr
  const span = instr?.span
  let snippet = ''
  if (span) {
    snippet = source.slice(span.start, Math.min(span.end, span.start + 60)).replace(/\s+/g, ' ')
    if (span.end - span.start > 60) snippet += '…'
  }
  return (
    <div className="shrink-0 border-t border-line bg-panel-2 px-3 py-2 font-mono text-[11.5px] leading-5">
      <div className="flex flex-wrap items-center gap-x-3">
        <span className="text-muted">
          0x{offset.toString(16).padStart(4, '0')} <span className="text-muted-2">({offset})</span>
        </span>
        <span className="font-semibold" style={{ color }}>
          {info.section}
        </span>
        {instr ? <span className="text-ink">{instr.label}</span> : null}
        {leaf ? <span className={instr ? 'text-muted' : 'text-ink'}>{leaf.label}</span> : null}
      </div>
      <div className="flex flex-wrap items-center gap-x-3 text-muted">
        {leaf?.detail ? <span>{leaf.detail}</span> : null}
        {span ? (
          <span className="text-muted-2">
            src {span.line}:{span.col} <span className="text-ink-2">{snippet}</span>
          </span>
        ) : null}
      </div>
    </div>
  )
}
