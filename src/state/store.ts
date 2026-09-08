import { create } from 'zustand'
import { compile, type CompileResult } from '../compiler/compile'
import { CANVAS_SIZE } from '../compiler/host'
import type { Span } from '../compiler/span'
import { DEFAULT_EXAMPLE_ID, EXAMPLES, findExample } from '../examples/index'
import { clearHash, loadSaved, readHashSource, saveSource } from '../lib/persist'
import { runInWorker, type RunHandle } from '../runtime/runner'

export type InspectorTab = 'tokens' | 'ast' | 'bytes' | 'wat'
export type Pane = 'editor' | 'inspector' | 'output'

export interface ConsoleLine {
  id: number
  kind: 'out' | 'err' | 'info' | 'timing' | 'ok'
  text: string
}

export interface RunTimings {
  compileMs: number
  instantiateMs: number
  runMs: number
  totalMs: number
}

export const COMPILE_DEBOUNCE_MS = 150

interface PlaygroundState {
  source: string
  exampleId: string | null
  result: CompileResult
  /** Increments on every compile; drives the changed-byte glow animation. */
  compileId: number
  /** Bytes from the previous successful compile, for diffing in the hex view. */
  prevBytes: Uint8Array | null
  activeTab: InspectorTab
  pane: Pane
  hoverSpan: Span | null
  /** Set when an inspector element is clicked: the editor selects and reveals this range. */
  revealSpan: { span: Span; nonce: number } | null
  consoleLines: ConsoleLine[]
  running: boolean
  lastRun: RunTimings | null
  pixels: Uint8ClampedArray
  pixelsVersion: number
  toast: string | null

  setSource: (source: string, opts?: { fromExample?: string | null }) => void
  compileNow: () => void
  run: () => Promise<void>
  stopRun: () => void
  loadExample: (id: string) => void
  setActiveTab: (tab: InspectorTab) => void
  setPane: (pane: Pane) => void
  setHoverSpan: (span: Span | null) => void
  reveal: (span: Span) => void
  clearConsole: () => void
  showToast: (text: string) => void
}

let debounceTimer: ReturnType<typeof setTimeout> | null = null
let saveTimer: ReturnType<typeof setTimeout> | null = null
let toastTimer: ReturnType<typeof setTimeout> | null = null
let lineId = 0
let currentRun: RunHandle | null = null
let loadedFromHash = false

function initialSource(): { source: string; exampleId: string | null } {
  if (typeof window !== 'undefined') {
    const fromHash = readHashSource()
    if (fromHash !== null) {
      loadedFromHash = true
      return { source: fromHash, exampleId: null }
    }
    const requested = findExample(new URLSearchParams(window.location.search).get('example') ?? '')
    if (requested) return { source: requested.source, exampleId: requested.id }
    const saved = loadSaved()
    if (saved && saved.source.trim().length > 0) return saved
  }
  const ex = findExample(DEFAULT_EXAMPLE_ID) ?? EXAMPLES[0]
  return { source: ex.source, exampleId: ex.id }
}

const line = (kind: ConsoleLine['kind'], text: string): ConsoleLine => ({ id: ++lineId, kind, text })

const MAX_CONSOLE_LINES = 6000

function appendLines(existing: ConsoleLine[], added: ConsoleLine[]): ConsoleLine[] {
  const merged = existing.concat(added)
  return merged.length > MAX_CONSOLE_LINES ? merged.slice(merged.length - MAX_CONSOLE_LINES) : merged
}

const initial = initialSource()

function initialTab(): InspectorTab {
  if (typeof window === 'undefined') return 'bytes'
  const t = new URLSearchParams(window.location.search).get('tab')
  return t === 'tokens' || t === 'ast' || t === 'bytes' || t === 'wat' ? t : 'bytes'
}

export const useStore = create<PlaygroundState>((set, get) => ({
  source: initial.source,
  exampleId: initial.exampleId,
  result: compile(initial.source),
  compileId: 1,
  prevBytes: null,
  activeTab: initialTab(),
  pane: 'editor',
  hoverSpan: null,
  revealSpan: null,
  consoleLines: [line('info', 'Kiln ready. Press Run or Ctrl+Enter to execute the exported main().')],
  running: false,
  lastRun: null,
  pixels: new Uint8ClampedArray(CANVAS_SIZE * CANVAS_SIZE * 4),
  pixelsVersion: 0,
  toast: null,

  setSource: (source, opts) => {
    const exampleId = opts?.fromExample !== undefined ? opts.fromExample : null
    set({ source, exampleId })
    if (loadedFromHash && opts?.fromExample === undefined) {
      // the user started editing a shared program: stop restoring the stale hash on reload
      loadedFromHash = false
      clearHash()
    }
    if (debounceTimer) clearTimeout(debounceTimer)
    debounceTimer = setTimeout(() => {
      debounceTimer = null
      get().compileNow()
    }, COMPILE_DEBOUNCE_MS)
    if (saveTimer) clearTimeout(saveTimer)
    saveTimer = setTimeout(() => saveSource(get().source, get().exampleId), 400)
  },

  compileNow: () => {
    if (debounceTimer) {
      clearTimeout(debounceTimer)
      debounceTimer = null
    }
    const { source, result: previous } = get()
    const result = compile(source)
    set((s) => ({ result, compileId: s.compileId + 1, prevBytes: previous.bytes ?? s.prevBytes }))
  },

  run: async () => {
    const state = get()
    if (state.running) return
    // make sure we run what is on screen, not a debounced-stale module
    if (debounceTimer) state.compileNow()
    const { result } = get()
    if (!result.ok || !result.bytes) {
      const first = result.diagnostics[0]
      set((s) => ({
        consoleLines: appendLines(s.consoleLines, [
          line('err', `cannot run: ${result.diagnostics.length} compile error${result.diagnostics.length === 1 ? '' : 's'}`),
          ...(first ? [line('err', `  ${first.span.line}:${first.span.col} ${first.message}`)] : []),
        ]),
        pane: 'output',
      }))
      return
    }
    const compileMs = result.stages.reduce((n, s) => n + s.ms, 0)
    set((s) => ({
      running: true,
      consoleLines: appendLines(s.consoleLines, [line('info', `▶ run  (${result.bytes!.length} bytes)`)]),
    }))
    const handle = runInWorker(result.bytes, {
      onPrint: (lines) => set((s) => ({ consoleLines: appendLines(s.consoleLines, lines.map((t) => line('out', t))) })),
    })
    currentRun = handle
    const outcome = await handle.promise
    currentRun = null
    const total = compileMs + outcome.instantiateMs + outcome.runMs
    const timings: RunTimings = { compileMs, instantiateMs: outcome.instantiateMs, runMs: outcome.runMs, totalMs: total }
    const added: ConsoleLine[] = []
    if (outcome.ok) {
      const extras: string[] = []
      if (outcome.pixelWrites > 0) extras.push(`${outcome.pixelWrites.toLocaleString()} setpixel`)
      if (outcome.prints > 0) extras.push(`${outcome.prints.toLocaleString()} print${outcome.prints === 1 ? '' : 's'}`)
      if (outcome.value !== undefined) extras.push(`returned ${outcome.value}`)
      added.push(line('ok', `✓ finished${extras.length ? ' · ' + extras.join(' · ') : ''}`))
    } else {
      added.push(line('err', `✗ ${outcome.error ?? 'run failed'}`))
    }
    added.push(
      line(
        'timing',
        `compile ${compileMs.toFixed(2)} ms · instantiate ${outcome.instantiateMs.toFixed(2)} ms · run ${outcome.runMs.toFixed(2)} ms · total ${total.toFixed(2)} ms`,
      ),
    )
    set((s) => ({
      running: false,
      lastRun: timings,
      consoleLines: appendLines(s.consoleLines, added),
      pixels: outcome.pixels ?? s.pixels,
      pixelsVersion: s.pixelsVersion + 1,
    }))
  },

  stopRun: () => {
    currentRun?.cancel()
  },

  loadExample: (id) => {
    const ex = findExample(id)
    if (!ex) return
    get().setSource(ex.source, { fromExample: ex.id })
    get().compileNow()
    set((s) => ({ consoleLines: appendLines(s.consoleLines, [line('info', `loaded example "${ex.name}" — ${ex.description}`)]) }))
  },

  setActiveTab: (tab) => set({ activeTab: tab }),
  setPane: (pane) => set({ pane }),
  setHoverSpan: (span) => {
    if (get().hoverSpan === span) return
    set({ hoverSpan: span })
  },
  reveal: (span) => set((s) => ({ revealSpan: { span, nonce: (s.revealSpan?.nonce ?? 0) + 1 }, pane: 'editor' })),
  clearConsole: () => set({ consoleLines: [] }),
  showToast: (text) => {
    set({ toast: text })
    if (toastTimer) clearTimeout(toastTimer)
    toastTimer = setTimeout(() => set({ toast: null }), 1800)
  },
}))
