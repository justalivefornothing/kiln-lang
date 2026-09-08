import { createHost, runModule } from '../compiler/host'
import type { RunMessage, RunRequest } from './runner.worker'

export interface RunOutcome {
  ok: boolean
  error?: string
  trapped?: boolean
  timedOut?: boolean
  instantiateMs: number
  runMs: number
  pixels: Uint8ClampedArray | null
  pixelWrites: number
  prints: number
  exports: string[]
  value: number | undefined
}

export interface RunHandle {
  promise: Promise<RunOutcome>
  cancel: () => void
}

const DEFAULT_TIMEOUT_MS = 8000

/**
 * Execute a compiled module off the main thread so a runaway loop can be
 * terminated instead of freezing the playground. Falls back to inline
 * execution when workers are unavailable.
 */
export function runInWorker(
  bytes: Uint8Array<ArrayBuffer>,
  options: { seed?: number; entry?: string; timeoutMs?: number; onPrint?: (lines: string[]) => void } = {},
): RunHandle {
  const seed = options.seed ?? (Date.now() & 0x7fffffff)
  const entry = options.entry ?? 'main'
  const timeoutMs = options.timeoutMs ?? DEFAULT_TIMEOUT_MS

  if (typeof Worker === 'undefined') {
    return { promise: runInline(bytes, seed, entry, options.onPrint), cancel: () => {} }
  }

  let worker: Worker
  try {
    worker = new Worker(new URL('./runner.worker.ts', import.meta.url), { type: 'module' })
  } catch {
    return { promise: runInline(bytes, seed, entry, options.onPrint), cancel: () => {} }
  }

  let settled = false
  let cancel: () => void = () => {}
  const promise = new Promise<RunOutcome>((resolve) => {
    const finish = (outcome: RunOutcome): void => {
      if (settled) return
      settled = true
      clearTimeout(timer)
      worker.terminate()
      resolve(outcome)
    }
    const timer = setTimeout(() => {
      finish({
        ok: false,
        timedOut: true,
        error: `timed out after ${(timeoutMs / 1000).toFixed(0)} s — the program was terminated (infinite loop?)`,
        instantiateMs: 0,
        runMs: timeoutMs,
        pixels: null,
        pixelWrites: 0,
        prints: 0,
        exports: [],
        value: undefined,
      })
    }, timeoutMs)
    cancel = () =>
      finish({
        ok: false,
        error: 'cancelled',
        instantiateMs: 0,
        runMs: 0,
        pixels: null,
        pixelWrites: 0,
        prints: 0,
        exports: [],
        value: undefined,
      })
    worker.onmessage = (ev: MessageEvent<RunMessage>) => {
      const msg = ev.data
      if (msg.type === 'print') {
        options.onPrint?.(msg.lines)
        return
      }
      finish({
        ok: msg.ok,
        error: msg.error,
        trapped: msg.trapped,
        instantiateMs: msg.instantiateMs,
        runMs: msg.runMs,
        pixels: msg.pixels,
        pixelWrites: msg.pixelWrites,
        prints: msg.prints,
        exports: msg.exports,
        value: msg.value,
      })
    }
    worker.onerror = (e) => {
      finish({
        ok: false,
        error: `worker error: ${e.message || 'unknown'}`,
        instantiateMs: 0,
        runMs: 0,
        pixels: null,
        pixelWrites: 0,
        prints: 0,
        exports: [],
        value: undefined,
      })
    }
    const req: RunRequest = { bytes, seed, entry }
    worker.postMessage(req)
  })
  return { promise, cancel: () => cancel() }
}

async function runInline(bytes: Uint8Array<ArrayBuffer>, seed: number, entry: string, onPrint?: (lines: string[]) => void): Promise<RunOutcome> {
  const lines: string[] = []
  const host = createHost({ seed, onPrint: (t) => lines.push(t) })
  const res = await runModule(bytes, host, entry)
  if (lines.length) onPrint?.(lines)
  return {
    ok: res.ok,
    error: res.error,
    trapped: res.trapped,
    instantiateMs: res.instantiateMs,
    runMs: res.runMs,
    pixels: host.pixels,
    pixelWrites: host.pixelWrites,
    prints: host.prints,
    exports: res.exports,
    value: res.value,
  }
}
