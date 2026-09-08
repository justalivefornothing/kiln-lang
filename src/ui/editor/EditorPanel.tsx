import { useStore } from '../../state/store'
import { Editor } from './Editor'

export function EditorPanel() {
  const diagnostics = useStore((s) => s.result.diagnostics)
  const reveal = useStore((s) => s.reveal)
  const exampleId = useStore((s) => s.exampleId)
  const source = useStore((s) => s.source)
  const lineCount = source.split('\n').length

  return (
    <section className="panel h-full" aria-label="Editor">
      <div className="panel-head">
        <span>editor</span>
        <span className="font-mono normal-case tracking-normal text-muted-2">{exampleId ? `${exampleId}.kiln` : 'untitled.kiln'}</span>
        <span className="ml-auto font-mono text-[10px] normal-case tracking-normal text-muted-2">
          {lineCount} lines · compiles on change
        </span>
      </div>
      <Editor />
      <div className={`shrink-0 border-t border-line ${diagnostics.length ? 'bg-rust-dim/30' : 'bg-panel-2'}`} aria-live="polite">
        {diagnostics.length === 0 ? (
          <div className="flex items-center gap-2 px-3 py-1.5 text-[11.5px] text-muted">
            <span className="inline-block h-1.5 w-1.5 rounded-full bg-ember" />
            No problems. Module is ready to run.
          </div>
        ) : (
          <ul className="max-h-28 overflow-auto py-1">
            {diagnostics.map((d, i) => (
              <li key={i}>
                <button
                  type="button"
                  className="flex w-full items-start gap-2 px-3 py-1 text-left text-[12px] hover:bg-rust/10"
                  onClick={() => reveal(d.span)}
                  title="Jump to this error"
                >
                  <span className="shrink-0 font-mono text-[11px] text-rust">
                    {d.span.line}:{d.span.col}
                  </span>
                  <span className="shrink-0 rounded bg-rust/15 px-1 font-mono text-[10px] uppercase text-rust">{d.stage}</span>
                  <span className="text-ink-2">{d.message}</span>
                </button>
              </li>
            ))}
          </ul>
        )}
      </div>
    </section>
  )
}
