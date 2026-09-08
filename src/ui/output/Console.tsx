import { useEffect, useRef } from 'react'
import { useStore, type ConsoleLine } from '../../state/store'
import { TrashIcon } from '../Icons'

const KIND_CLASS: Record<ConsoleLine['kind'], string> = {
  out: 'text-ink',
  err: 'text-rust',
  info: 'text-muted',
  timing: 'text-ember-2',
  ok: 'text-sec-export',
}

export function Console() {
  const lines = useStore((s) => s.consoleLines)
  const clearConsole = useStore((s) => s.clearConsole)
  const scrollRef = useRef<HTMLDivElement>(null)
  const stickToBottom = useRef(true)

  useEffect(() => {
    const el = scrollRef.current
    if (el && stickToBottom.current) el.scrollTop = el.scrollHeight
  }, [lines])

  const onScroll = (): void => {
    const el = scrollRef.current
    if (!el) return
    stickToBottom.current = el.scrollHeight - el.scrollTop - el.clientHeight < 24
  }

  return (
    <section className="panel min-h-0 flex-1" aria-label="Console">
      <div className="panel-head">
        <span>console</span>
        <span className="whitespace-nowrap font-mono normal-case tracking-normal text-muted-2">{lines.length} lines</span>
        <button type="button" className="ml-auto rounded p-1 text-muted transition-colors hover:bg-panel-3 hover:text-ink" onClick={clearConsole} title="Clear console" aria-label="Clear console">
          <TrashIcon size={13} />
        </button>
      </div>
      <div ref={scrollRef} onScroll={onScroll} className="min-h-0 flex-1 overflow-auto px-3 py-2 font-mono text-[12px] leading-[1.55]" role="log" aria-live="polite">
        {lines.length === 0 ? <div className="text-muted-2">Console cleared.</div> : null}
        {lines.map((l) => (
          <div key={l.id} className={`whitespace-pre-wrap break-words ${KIND_CLASS[l.kind]}`}>
            {l.text}
          </div>
        ))}
      </div>
    </section>
  )
}
