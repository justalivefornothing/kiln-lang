import { useEffect } from 'react'
import { useStore, type Pane } from './state/store'
import { Header } from './ui/Header'
import { Pipeline } from './ui/Pipeline'
import { EditorPanel } from './ui/editor/EditorPanel'
import { Inspector } from './ui/inspector/Inspector'
import { Canvas } from './ui/output/Canvas'
import { Console } from './ui/output/Console'

const PANES: { id: Pane; label: string }[] = [
  { id: 'editor', label: 'Editor' },
  { id: 'inspector', label: 'Inspector' },
  { id: 'output', label: 'Output' },
]

let autoRan = false

export default function App() {
  const pane = useStore((s) => s.pane)
  const setPane = useStore((s) => s.setPane)
  const toast = useStore((s) => s.toast)

  // run the initial program once so the canvas is never empty on first visit
  useEffect(() => {
    if (autoRan) return
    autoRan = true
    const state = useStore.getState()
    if (state.result.ok && new URLSearchParams(window.location.search).get('autorun') !== '0') void state.run()
  }, [])

  // global Ctrl+Enter (when focus is outside the editor)
  useEffect(() => {
    const onKey = (e: KeyboardEvent): void => {
      if ((e.ctrlKey || e.metaKey) && e.key === 'Enter') {
        e.preventDefault()
        void useStore.getState().run()
      }
    }
    window.addEventListener('keydown', onKey)
    return () => window.removeEventListener('keydown', onKey)
  }, [])

  return (
    <div className="flex h-full flex-col">
      <a href="#editor-pane" className="sr-only-focusable fixed left-2 top-2 z-50 rounded bg-ember px-2 py-1 text-charcoal">
        Skip to editor
      </a>
      <Header />
      <Pipeline />

      {/* narrow screens: segmented control switching between the three columns */}
      <div className="flex shrink-0 gap-1 border-b border-line bg-panel p-1.5 lg:hidden" role="tablist" aria-label="Panes">
        {PANES.map((p) => (
          <button
            key={p.id}
            type="button"
            role="tab"
            aria-selected={pane === p.id}
            className={`flex-1 rounded-md px-3 py-1.5 text-[12.5px] font-medium transition-colors ${
              pane === p.id ? 'bg-ember text-charcoal' : 'text-muted hover:bg-panel-3 hover:text-ink'
            }`}
            onClick={() => setPane(p.id)}
          >
            {p.label}
          </button>
        ))}
      </div>

      <main className="grid min-h-0 flex-1 gap-2 p-2 lg:grid-cols-[minmax(0,1fr)_minmax(0,1fr)_296px] lg:[grid-template-columns:minmax(0,50%)_minmax(0,1fr)_296px]">
        <div id="editor-pane" className={`min-h-0 ${pane === 'editor' ? 'flex' : 'hidden'} flex-col lg:flex`}>
          <EditorPanel />
        </div>
        <div className={`min-h-0 ${pane === 'inspector' ? 'flex' : 'hidden'} flex-col lg:flex`}>
          <Inspector />
        </div>
        <div className={`min-h-0 ${pane === 'output' ? 'flex' : 'hidden'} flex-col gap-2 lg:flex`}>
          <Canvas />
          <Console />
        </div>
      </main>

      {toast ? (
        <div className="fade-up pointer-events-none fixed bottom-4 left-1/2 z-50 -translate-x-1/2 rounded-md border border-ember/40 bg-panel-2 px-3 py-1.5 text-[12.5px] text-ink shadow-xl shadow-black/40" role="status">
          {toast}
        </div>
      ) : null}
    </div>
  )
}
