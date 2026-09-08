import { IMPORT_MODULE, MEMORY_EXPORT } from './emitter'

export const CANVAS_SIZE = 256

export interface HostOptions {
  /** Called for each print/printf line. */
  onPrint?: (text: string) => void
  /** RGBA pixel buffer of CANVAS_SIZE x CANVAS_SIZE. One is allocated if omitted. */
  pixels?: Uint8ClampedArray
  /** Seed for the deterministic PRNG behind rand(). */
  seed?: number
  /** Called when the program calls clear(). */
  onClear?: () => void
}

export interface Host {
  imports: WebAssembly.Imports
  pixels: Uint8ClampedArray
  /** Number of setpixel calls so far. */
  pixelWrites: number
  /** Number of print/printf calls so far. */
  prints: number
}

/** mulberry32: small, fast, deterministic 32-bit PRNG returning floats in [0, 1). */
export function makeRng(seed: number): () => number {
  let s = seed >>> 0
  return () => {
    s = (s + 0x6d2b79f5) >>> 0
    let t = s
    t = Math.imul(t ^ (t >>> 15), t | 1)
    t ^= t + Math.imul(t ^ (t >>> 7), t | 61)
    return ((t ^ (t >>> 14)) >>> 0) / 4294967296
  }
}

/** Format an f32 the way the console shows it: up to 6 significant digits, no trailing noise. */
export function formatFloat(v: number): string {
  if (Number.isNaN(v)) return 'nan'
  if (!Number.isFinite(v)) return v > 0 ? 'inf' : '-inf'
  if (Number.isInteger(v)) return v.toFixed(1)
  const s = Number(v.toPrecision(7))
  return String(s)
}

/**
 * Build the `env` import object a Kiln module expects. Pure JavaScript: the
 * pixel buffer is a plain typed array so the same host runs in Node and in a
 * Web Worker; the UI blits it into an ImageData afterwards.
 */
export function createHost(options: HostOptions = {}): Host {
  const pixels = options.pixels ?? new Uint8ClampedArray(CANVAS_SIZE * CANVAS_SIZE * 4)
  const rng = makeRng(options.seed ?? 0x4b494c4e)
  const print = options.onPrint ?? (() => {})
  const host: Host = { imports: {}, pixels, pixelWrites: 0, prints: 0 }

  const env: Record<string, WebAssembly.ImportValue> = {
    print: (v: number) => {
      host.prints++
      print(String(v | 0))
    },
    printf: (v: number) => {
      host.prints++
      print(formatFloat(v))
    },
    setpixel: (x: number, y: number, r: number, g: number, b: number) => {
      host.pixelWrites++
      if (x < 0 || y < 0 || x >= CANVAS_SIZE || y >= CANVAS_SIZE) return
      const i = (y * CANVAS_SIZE + x) * 4
      pixels[i] = r
      pixels[i + 1] = g
      pixels[i + 2] = b
      pixels[i + 3] = 255
    },
    rand: () => rng(),
    clear: () => {
      pixels.fill(0)
      options.onClear?.()
    },
  }
  host.imports = { [IMPORT_MODULE]: env }
  return host
}

export interface RunResult {
  ok: boolean
  /** Return value of the entry function, if any. */
  value: number | undefined
  instantiateMs: number
  runMs: number
  /** Trap or error message when ok is false. */
  error?: string
  /** True when the failure was a WebAssembly trap (as opposed to a missing export etc.). */
  trapped?: boolean
  exports: string[]
}

/**
 * Instantiate the module with the given host and call an exported function.
 * Traps (unreachable, integer divide by zero, out-of-bounds memory access, stack
 * overflow) are caught and reported instead of thrown.
 */
export async function runModule(bytes: Uint8Array<ArrayBuffer>, host: Host, entry = 'main', args: number[] = []): Promise<RunResult> {
  const now = (): number => (typeof performance !== 'undefined' ? performance.now() : Date.now())
  const t0 = now()
  let instance: WebAssembly.Instance
  try {
    const result = await WebAssembly.instantiate(bytes, host.imports)
    instance = result.instance
  } catch (e) {
    return { ok: false, value: undefined, instantiateMs: now() - t0, runMs: 0, error: `instantiate failed: ${describeError(e)}`, exports: [] }
  }
  const instantiateMs = now() - t0
  const exportNames = Object.keys(instance.exports).filter((k) => k !== MEMORY_EXPORT)
  const fn = instance.exports[entry]
  if (typeof fn !== 'function') {
    return {
      ok: false,
      value: undefined,
      instantiateMs,
      runMs: 0,
      error: exportNames.length
        ? `no exported function '${entry}' (exports: ${exportNames.join(', ')})`
        : `nothing to run: add 'export fn ${entry}() { ... }'`,
      exports: exportNames,
    }
  }
  const t1 = now()
  try {
    const value = (fn as (...a: number[]) => number | undefined)(...args)
    return { ok: true, value, instantiateMs, runMs: now() - t1, exports: exportNames }
  } catch (e) {
    const trapped = e instanceof WebAssembly.RuntimeError || e instanceof RangeError
    return { ok: false, value: undefined, instantiateMs, runMs: now() - t1, error: describeTrap(e), trapped, exports: exportNames }
  }
}

function describeError(e: unknown): string {
  return e instanceof Error ? e.message : String(e)
}

function describeTrap(e: unknown): string {
  if (e instanceof RangeError && /call stack/i.test(e.message)) return 'trap: call stack exhausted (runaway recursion?)'
  if (e instanceof WebAssembly.RuntimeError) return `trap: ${e.message}`
  return describeError(e)
}
