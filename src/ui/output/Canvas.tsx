import { useEffect, useRef } from 'react'
import { CANVAS_SIZE } from '../../compiler/host'
import { useStore } from '../../state/store'

export function Canvas() {
  const ref = useRef<HTMLCanvasElement>(null)
  const pixels = useStore((s) => s.pixels)
  const version = useStore((s) => s.pixelsVersion)
  const running = useStore((s) => s.running)
  const lastRun = useStore((s) => s.lastRun)

  // blit the pixel buffer written by setpixel after each run
  useEffect(() => {
    const canvas = ref.current
    if (!canvas) return
    const ctx = canvas.getContext('2d')
    if (!ctx) return
    const image = new ImageData(new Uint8ClampedArray(pixels), CANVAS_SIZE, CANVAS_SIZE)
    ctx.putImageData(image, 0, 0)
  }, [pixels, version])

  return (
    <section className="panel shrink-0" aria-label="Canvas output">
      <div className="panel-head">
        <span>canvas</span>
        <span className="font-mono normal-case tracking-normal text-muted-2">256 × 256</span>
        <span className="ml-auto font-mono text-[10px] normal-case tracking-normal text-muted-2">
          {running ? <span className="text-ember-2">running…</span> : lastRun ? `blit after ${lastRun.runMs.toFixed(1)} ms run` : 'setpixel(x, y, r, g, b)'}
        </span>
      </div>
      <div className="flex items-center justify-center bg-charcoal p-3">
        <canvas
          ref={ref}
          width={CANVAS_SIZE}
          height={CANVAS_SIZE}
          className={`pixel-canvas block h-[256px] w-[256px] max-w-full rounded-sm border border-line transition-opacity ${running ? 'opacity-60' : ''}`}
          style={{ aspectRatio: '1 / 1', height: 'auto' }}
          role="img"
          aria-label="Program output canvas, 256 by 256 pixels"
        />
      </div>
    </section>
  )
}
