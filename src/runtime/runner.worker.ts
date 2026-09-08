/// <reference lib="webworker" />
import { createHost, runModule } from '../compiler/host'

export interface RunRequest {
  bytes: Uint8Array<ArrayBuffer>
  seed: number
  entry: string
}

export type RunMessage =
  | { type: 'print'; lines: string[] }
  | {
      type: 'done'
      ok: boolean
      error?: string
      trapped?: boolean
      instantiateMs: number
      runMs: number
      pixels: Uint8ClampedArray
      pixelWrites: number
      prints: number
      exports: string[]
      value: number | undefined
    }

const MAX_LINES = 5000

self.onmessage = async (ev: MessageEvent<RunRequest>) => {
  const { bytes, seed, entry } = ev.data
  let buffer: string[] = []
  let total = 0
  const flush = (): void => {
    if (buffer.length === 0) return
    const msg: RunMessage = { type: 'print', lines: buffer }
    self.postMessage(msg)
    buffer = []
  }
  const host = createHost({
    seed,
    onPrint: (text) => {
      total++
      if (total > MAX_LINES) return
      buffer.push(text)
      if (buffer.length >= 512) flush()
    },
  })
  const res = await runModule(bytes, host, entry)
  if (total > MAX_LINES) buffer.push(`… ${total - MAX_LINES} more lines suppressed`)
  flush()
  const done: RunMessage = {
    type: 'done',
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
  self.postMessage(done, [host.pixels.buffer])
}
