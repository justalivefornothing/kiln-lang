import { useEffect, useRef, useState } from 'react'
import { EXAMPLES } from '../examples/index'
import { buildShareUrl } from '../lib/persist'
import { useStore } from '../state/store'
import { ChevronDownIcon, DownloadIcon, FlameMark, LinkIcon, PlayIcon, StopIcon } from './Icons'

function download(name: string, data: BlobPart, type: string): void {
  const blob = new Blob([data], { type })
  const url = URL.createObjectURL(blob)
  const a = document.createElement('a')
  a.href = url
  a.download = name
  document.body.appendChild(a)
  a.click()
  a.remove()
  setTimeout(() => URL.revokeObjectURL(url), 1000)
}

function formatBytes(n: number): string {
  if (n < 1024) return `${n} B`
  return `${(n / 1024).toFixed(2)} KiB`
}

export function Header() {
  const result = useStore((s) => s.result)
  const running = useStore((s) => s.running)
  const run = useStore((s) => s.run)
  const stopRun = useStore((s) => s.stopRun)
  const showToast = useStore((s) => s.showToast)
  const source = useStore((s) => s.source)
  const exampleId = useStore((s) => s.exampleId)

  const bytes = result.bytes
  const ok = result.ok && !!bytes
  const errorCount = result.diagnostics.length

  const onShare = async (): Promise<void> => {
    const url = buildShareUrl(source)
    history.replaceState(null, '', url)
    try {
      await navigator.clipboard.writeText(url)
      showToast('Share link copied to clipboard')
    } catch {
      showToast('Share link is in the address bar')
    }
  }

  const baseName = exampleId ?? 'program'

  return (
    <header className="flex h-14 shrink-0 items-center gap-3 border-b border-line bg-panel px-3 sm:px-4">
      <div className="flex min-w-0 items-center gap-2.5">
        <FlameMark />
        <div className="leading-tight">
          <div className="text-[15px] font-semibold tracking-tight">Kiln</div>
          <div className="hidden text-[11px] text-muted md:block">a tiny language that compiles to WebAssembly, byte by byte</div>
        </div>
      </div>

      <div className="mx-1 hidden h-6 w-px bg-line sm:block" />

      <ExamplesMenu />

      <div className="flex-1" />

      <div className="flex items-center gap-1.5 sm:gap-2">
        <span
          className={`pill ${ok ? 'border-ember/40 text-ember-2' : errorCount ? 'border-rust/40 text-rust' : ''}`}
          title={ok ? 'Size of the compiled module' : 'Module not available: fix the errors first'}
          aria-live="polite"
        >
          {ok ? formatBytes(bytes.length) : errorCount ? `${errorCount} error${errorCount === 1 ? '' : 's'}` : '—'}
        </span>

        <button
          type="button"
          className="btn hidden sm:inline-flex"
          disabled={!ok}
          onClick={() => bytes && download(`${baseName}.wasm`, bytes as BlobPart, 'application/wasm')}
          title="Download the compiled module"
        >
          <DownloadIcon size={14} />
          .wasm
        </button>
        <button
          type="button"
          className="btn hidden sm:inline-flex"
          disabled={!ok || !result.wat}
          onClick={() => result.wat && download(`${baseName}.wat`, result.wat, 'text/plain')}
          title="Download the disassembly"
        >
          <DownloadIcon size={14} />
          .wat
        </button>
        <button type="button" className="btn" onClick={() => void onShare()} title="Copy a link that contains this program">
          <LinkIcon size={14} />
          <span className="hidden sm:inline">Share</span>
        </button>

        {running ? (
          <button type="button" className="btn-ember" onClick={stopRun} title="Stop the running program">
            <StopIcon size={14} />
            Stop
          </button>
        ) : (
          <button
            type="button"
            className="btn-ember"
            onClick={() => void run()}
            title="Run the exported main() (Ctrl+Enter)"
            disabled={!ok}
          >
            <PlayIcon size={14} />
            Run
            <span className="ml-1 hidden rounded bg-black/15 px-1 font-mono text-[10px] font-medium lg:inline">Ctrl+↵</span>
          </button>
        )}
      </div>
    </header>
  )
}

function ExamplesMenu() {
  const [open, setOpen] = useState(false)
  const ref = useRef<HTMLDivElement>(null)
  const exampleId = useStore((s) => s.exampleId)
  const loadExample = useStore((s) => s.loadExample)
  const current = EXAMPLES.find((e) => e.id === exampleId)

  useEffect(() => {
    if (!open) return
    const onDoc = (e: MouseEvent): void => {
      if (ref.current && !ref.current.contains(e.target as Node)) setOpen(false)
    }
    const onKey = (e: KeyboardEvent): void => {
      if (e.key === 'Escape') setOpen(false)
    }
    document.addEventListener('mousedown', onDoc)
    document.addEventListener('keydown', onKey)
    return () => {
      document.removeEventListener('mousedown', onDoc)
      document.removeEventListener('keydown', onKey)
    }
  }, [open])

  return (
    <div ref={ref} className="relative">
      <button
        type="button"
        className="btn"
        aria-haspopup="listbox"
        aria-expanded={open}
        onClick={() => setOpen((o) => !o)}
        title="Load an example program"
      >
        <span className="text-muted">Example</span>
        <span className="font-mono text-[12px] text-ink">{current ? current.name : 'custom'}</span>
        <ChevronDownIcon size={14} className={`text-muted transition-transform ${open ? 'rotate-180' : ''}`} />
      </button>
      {open && (
        <ul
          role="listbox"
          aria-label="Example programs"
          className="fade-up absolute left-0 top-full z-30 mt-1.5 w-[min(92vw,380px)] overflow-hidden rounded-lg border border-line-2 bg-panel-2 p-1 shadow-2xl shadow-black/50"
        >
          {EXAMPLES.map((ex) => {
            const active = ex.id === exampleId
            return (
              <li key={ex.id} role="option" aria-selected={active}>
                <button
                  type="button"
                  className={`flex w-full flex-col items-start gap-0.5 rounded-md px-2.5 py-2 text-left transition-colors hover:bg-panel-3 ${active ? 'bg-ember/10' : ''}`}
                  onClick={() => {
                    loadExample(ex.id)
                    setOpen(false)
                  }}
                >
                  <span className={`font-mono text-[13px] ${active ? 'text-ember-2' : 'text-ink'}`}>{ex.name}</span>
                  <span className="text-[12px] leading-snug text-muted">{ex.description}</span>
                </button>
              </li>
            )
          })}
        </ul>
      )}
    </div>
  )
}
