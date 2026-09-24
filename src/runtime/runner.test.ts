import { afterEach, describe, expect, it, vi } from 'vitest'
import { runInWorker } from './runner'

class FakeWorker {
  static instances: FakeWorker[] = []
  onmessage: ((event: { data: unknown }) => void) | null = null
  onerror: ((event: { message: string }) => void) | null = null
  postMessage = vi.fn()
  terminate = vi.fn()
  constructor() { FakeWorker.instances.push(this) }
  emit(data: unknown) { this.onmessage?.({ data }) }
}

const emptyModule = () => new Uint8Array([0, 97, 115, 109, 1, 0, 0, 0])

afterEach(() => {
  vi.unstubAllGlobals()
  vi.restoreAllMocks()
  vi.useRealTimers()
  FakeWorker.instances = []
})

describe('isolated runtime', () => {
  it('does not instantiate a module inline when Worker is unavailable', async () => {
    vi.stubGlobal('Worker', undefined)
    const instantiate = vi.spyOn(WebAssembly, 'instantiate')
    const handle = runInWorker(emptyModule())
    expect(await handle.promise).toMatchObject({ ok: false, error: expect.stringContaining('Isolated execution is unavailable') })
    handle.cancel()
    expect(instantiate).not.toHaveBeenCalled()
  })

  it('does not instantiate inline when Worker construction is blocked', async () => {
    vi.stubGlobal('Worker', class { constructor() { throw new Error('blocked') } })
    const instantiate = vi.spyOn(WebAssembly, 'instantiate')
    expect(await runInWorker(emptyModule()).promise).toMatchObject({ ok: false, pixelWrites: 0, prints: 0 })
    expect(instantiate).not.toHaveBeenCalled()
  })

  it('settles cancellation once and ignores late output', async () => {
    vi.useFakeTimers()
    vi.stubGlobal('Worker', FakeWorker)
    const onPrint = vi.fn()
    const handle = runInWorker(emptyModule(), { onPrint })
    const worker = FakeWorker.instances[0]
    handle.cancel()
    handle.cancel()
    worker.emit({ type: 'print', lines: ['late'] })
    expect(await handle.promise).toMatchObject({ ok: false, error: 'cancelled' })
    expect(worker.terminate).toHaveBeenCalledTimes(1)
    expect(onPrint).not.toHaveBeenCalled()
    expect(vi.getTimerCount()).toBe(0)
  })

  it('terminates an unresponsive worker at the deadline', async () => {
    vi.useFakeTimers()
    vi.stubGlobal('Worker', FakeWorker)
    const handle = runInWorker(emptyModule(), { timeoutMs: 25 })
    await vi.advanceTimersByTimeAsync(25)
    expect(await handle.promise).toMatchObject({ ok: false, timedOut: true, runMs: 25 })
    expect(FakeWorker.instances[0].terminate).toHaveBeenCalledTimes(1)
    expect(vi.getTimerCount()).toBe(0)
  })

  it('returns worker output and cleans up after completion', async () => {
    vi.useFakeTimers()
    vi.stubGlobal('Worker', FakeWorker)
    const onPrint = vi.fn()
    const handle = runInWorker(emptyModule(), { seed: 12, onPrint })
    const worker = FakeWorker.instances[0]
    expect(worker.postMessage).toHaveBeenCalledWith({ bytes: emptyModule(), seed: 12, entry: 'main' })
    worker.emit({ type: 'print', lines: ['42'] })
    worker.emit({ type: 'done', ok: true, instantiateMs: 1, runMs: 2, pixels: null, pixelWrites: 0, prints: 1, exports: ['main'], value: 42 })
    expect(await handle.promise).toMatchObject({ ok: true, value: 42, prints: 1 })
    expect(onPrint).toHaveBeenCalledWith(['42'])
    expect(worker.terminate).toHaveBeenCalledTimes(1)
    expect(vi.getTimerCount()).toBe(0)
  })

  it('settles a worker error and releases the deadline', async () => {
    vi.useFakeTimers()
    vi.stubGlobal('Worker', FakeWorker)
    const handle = runInWorker(emptyModule())
    FakeWorker.instances[0].onerror?.({ message: 'module failed' })
    expect(await handle.promise).toMatchObject({ ok: false, error: 'worker error: module failed' })
    expect(FakeWorker.instances[0].terminate).toHaveBeenCalledTimes(1)
    expect(vi.getTimerCount()).toBe(0)
  })

  it('settles postMessage failures without leaking the worker or deadline', async () => {
    vi.useFakeTimers()
    vi.stubGlobal('Worker', class extends FakeWorker {
      override postMessage = vi.fn(() => { throw new Error('clone failed') })
    })
    const handle = runInWorker(emptyModule())
    expect(await handle.promise).toMatchObject({ ok: false, error: expect.stringContaining('could not be sent') })
    expect(FakeWorker.instances[0].terminate).toHaveBeenCalledTimes(1)
    expect(vi.getTimerCount()).toBe(0)
  })
})
