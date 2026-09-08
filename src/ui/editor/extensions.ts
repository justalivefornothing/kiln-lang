import { RangeSet, StateEffect, StateField, type Extension } from '@codemirror/state'
import { Decoration, EditorView, GutterMarker, gutter, hoverTooltip, type DecorationSet } from '@codemirror/view'
import type { Diagnostic, Span } from '../../compiler/span'

// ---- diagnostics: underline + line tint + gutter dot + hover tooltip -------------

export const setDiagnostics = StateEffect.define<Diagnostic[]>()

const underline = Decoration.mark({ class: 'cm-diag-underline' })
const lineTint = Decoration.line({ class: 'cm-diag-line' })

function clamp(n: number, lo: number, hi: number): number {
  return Math.max(lo, Math.min(hi, n))
}

export const diagnosticsField = StateField.define<{ list: Diagnostic[]; deco: DecorationSet }>({
  create: () => ({ list: [], deco: Decoration.none }),
  update(value, tr) {
    let next = value
    for (const e of tr.effects) {
      if (e.is(setDiagnostics)) {
        const docLen = tr.state.doc.length
        const ranges: { from: number; to: number; deco: Decoration }[] = []
        const linesDone = new Set<number>()
        for (const d of e.value) {
          const from = clamp(d.span.start, 0, docLen)
          let to = clamp(d.span.end, 0, docLen)
          if (to <= from) to = clamp(from + 1, 0, docLen)
          if (to > from) ranges.push({ from, to, deco: underline })
          const lineNo = tr.state.doc.lineAt(from).number
          if (!linesDone.has(lineNo)) {
            linesDone.add(lineNo)
            const l = tr.state.doc.line(lineNo)
            ranges.push({ from: l.from, to: l.from, deco: lineTint })
          }
        }
        ranges.sort((a, b) => a.from - b.from || (a.deco === lineTint ? -1 : 1))
        next = { list: e.value, deco: Decoration.set(ranges.map((r) => r.deco.range(r.from, r.to))) }
      }
    }
    if (next === value && tr.docChanged) {
      // keep decorations attached to text while the user types; a fresh compile will replace them
      return { list: value.list, deco: value.deco.map(tr.changes) }
    }
    return next
  },
  provide: (f) => EditorView.decorations.from(f, (v) => v.deco),
})

class DiagMarker extends GutterMarker {
  readonly message: string
  constructor(message: string) {
    super()
    this.message = message
  }
  toDOM(): Node {
    const el = document.createElement('span')
    el.className = 'cm-diag-marker'
    el.title = this.message
    return el
  }
}

const diagGutter = gutter({
  class: 'cm-diag-gutter',
  markers: (view) => {
    const { list } = view.state.field(diagnosticsField)
    const byLine = new Map<number, string[]>()
    const docLen = view.state.doc.length
    for (const d of list) {
      const from = clamp(d.span.start, 0, docLen)
      const l = view.state.doc.lineAt(from)
      const arr = byLine.get(l.from) ?? []
      arr.push(d.message)
      byLine.set(l.from, arr)
    }
    const markers = [...byLine.entries()]
      .sort((a, b) => a[0] - b[0])
      .map(([pos, msgs]) => new DiagMarker(msgs.join('\n')).range(pos))
    return RangeSet.of(markers)
  },
  initialSpacer: () => new DiagMarker(''),
})

const diagHover = hoverTooltip(
  (view, pos) => {
    const { list } = view.state.field(diagnosticsField)
    const docLen = view.state.doc.length
    const hits = list.filter((d) => {
      const from = clamp(d.span.start, 0, docLen)
      const to = Math.max(from + 1, clamp(d.span.end, 0, docLen))
      return pos >= from && pos <= to
    })
    if (hits.length === 0) return null
    const from = clamp(hits[0].span.start, 0, docLen)
    return {
      pos: from,
      end: Math.max(from + 1, clamp(hits[0].span.end, 0, docLen)),
      above: true,
      create: () => {
        const dom = document.createElement('div')
        dom.className = 'cm-diag-tooltip'
        for (const h of hits) {
          const row = document.createElement('div')
          const stage = document.createElement('span')
          stage.style.color = 'var(--color-muted)'
          stage.style.fontFamily = 'var(--font-mono)'
          stage.style.fontSize = '11px'
          stage.textContent = `${h.span.line}:${h.span.col} ${h.stage} `
          row.appendChild(stage)
          row.appendChild(document.createTextNode(h.message))
          dom.appendChild(row)
        }
        return { dom }
      },
    }
  },
  { hoverTime: 120 },
)

export function diagnosticsExtension(): Extension {
  return [diagnosticsField, diagGutter, diagHover]
}

// ---- hover span highlight (AST / bytes -> source) -------------------------------

export const setHoverSpan = StateEffect.define<Span | null>()
const hoverMark = Decoration.mark({ class: 'cm-hover-span' })

export const hoverSpanField = StateField.define<DecorationSet>({
  create: () => Decoration.none,
  update(deco, tr) {
    for (const e of tr.effects) {
      if (e.is(setHoverSpan)) {
        const s = e.value
        if (!s) return Decoration.none
        const docLen = tr.state.doc.length
        const from = clamp(s.start, 0, docLen)
        const to = clamp(s.end, 0, docLen)
        if (to <= from) return Decoration.none
        return Decoration.set([hoverMark.range(from, to)])
      }
    }
    return tr.docChanged ? deco.map(tr.changes) : deco
  },
  provide: (f) => EditorView.decorations.from(f),
})

// ---- theme --------------------------------------------------------------------

export const kilnTheme = EditorView.theme(
  {
    '&': { backgroundColor: 'transparent', color: 'var(--color-ink)' },
    '.cm-content': { caretColor: 'var(--color-ember)', padding: '10px 0' },
    '.cm-cursor, .cm-dropCursor': { borderLeftColor: 'var(--color-ember)', borderLeftWidth: '2px' },
    '&.cm-focused > .cm-scroller > .cm-selectionLayer .cm-selectionBackground, .cm-selectionBackground, ::selection': {
      backgroundColor: 'rgba(255, 122, 26, 0.22) !important',
    },
    '.cm-activeLine': { backgroundColor: 'rgba(255, 255, 255, 0.03)' },
    '.cm-gutters': {
      backgroundColor: 'var(--color-panel)',
      color: 'var(--color-muted-2)',
      border: 'none',
      borderRight: '1px solid var(--color-line)',
    },
    '.cm-activeLineGutter': { backgroundColor: 'rgba(255, 255, 255, 0.04)', color: 'var(--color-muted)' },
    '.cm-lineNumbers .cm-gutterElement': { padding: '0 8px 0 12px', minWidth: '38px' },
    '.cm-matchingBracket': { backgroundColor: 'rgba(79, 179, 169, 0.25)', outline: '1px solid rgba(79, 179, 169, 0.5)' },
    '.cm-nonmatchingBracket': { backgroundColor: 'rgba(217, 95, 95, 0.3)' },
    '.cm-tooltip': {
      backgroundColor: 'var(--color-panel-2)',
      border: '1px solid var(--color-line-2)',
      borderRadius: '6px',
      color: 'var(--color-ink)',
      fontFamily: 'var(--font-mono)',
      fontSize: '12px',
    },
    '.cm-tooltip.cm-tooltip-autocomplete > ul > li': { padding: '3px 8px' },
    '.cm-tooltip.cm-tooltip-autocomplete > ul > li[aria-selected]': {
      backgroundColor: 'rgba(255, 122, 26, 0.18)',
      color: 'var(--color-ink)',
    },
    '.cm-completionLabel': { color: 'var(--color-ink)' },
    '.cm-completionMatchedText': { color: 'var(--color-ember-2)', textDecoration: 'none', fontWeight: '600' },
    '.cm-completionDetail': { color: 'var(--color-muted)', fontStyle: 'normal', marginLeft: '8px' },
    '.cm-completionInfo': {
      backgroundColor: 'var(--color-panel-2)',
      border: '1px solid var(--color-line-2)',
      fontFamily: 'var(--font-sans)',
      padding: '6px 10px',
    },
    '.cm-scroller': { overflow: 'auto' },
  },
  { dark: true },
)
