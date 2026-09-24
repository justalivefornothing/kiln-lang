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

function failedRun(error: string): RunOutcome {
  return {
    ok: false, error, instantiateMs: 0, runMs: 0, pixels: null,
    pixelWrites: 0, prints: 0, exports: [], value: undefined,
  }
}

function unavailableWorker(): RunHandle {
  return {
    promise: Promise.resolve(failedRun('Isolated execution is unavailable. Enable browser workers to run programs; compilation and inspection still work.')),
    cancel: () => {},
  }
}

/**
 * Execute a compiled module off the main thread so a runaway loop can be
 * terminated instead of freezing the playground. Never execute user programs
 * inline: an unavailable worker must not bypass cancellation and timeout.
 */
export function runInWorker(
  bytes: Uint8Array<ArrayBuffer>,
  options: { seed?: number; entry?: string; timeoutMs?: number; onPrint?: (lines: string[]) => void } = {},
): RunHandle {
  const seed = options.seed ?? (Date.now() & 0x7fffffff)
  const entry = options.entry ?? 'main'
  const timeoutMs = options.timeoutMs ?? DEFAULT_TIMEOUT_MS

  if (typeof Worker === 'undefined') {
    return unavailableWorker()
  }

  let worker: Worker
  try {
    worker = new Worker(new URL('./runner.worker.ts', import.meta.url), { type: 'module' })
  } catch {
    return unavailableWorker()
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
      if (settled) return
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
    try {
      worker.postMessage(req)
    } catch {
      finish(failedRun('The program could not be sent to its worker. Try running it again.'))
    }
  })
  return { promise, cancel: () => cancel() }
}
