import { useStore, type InspectorTab } from '../../state/store'
import { AstView } from './AstView'
import { BytesView } from './BytesView'
import { TokensView } from './TokensView'
import { WatView } from './WatView'

const TABS: { id: InspectorTab; label: string; hint: string }[] = [
  { id: 'tokens', label: 'Tokens', hint: 'lexer output' },
  { id: 'ast', label: 'AST', hint: 'parser + checker output' },
  { id: 'bytes', label: 'Bytes', hint: 'the emitted .wasm, annotated' },
  { id: 'wat', label: 'WAT', hint: 'disassembled from the bytes' },
]

export function Inspector() {
  const activeTab = useStore((s) => s.activeTab)
  const setActiveTab = useStore((s) => s.setActiveTab)
  const stages = useStore((s) => s.result.stages)

  const stageOk = (tab: InspectorTab): boolean | null => {
    switch (tab) {
      case 'tokens':
        return stages[1].ok
      case 'ast':
        return stages[2].ok
      case 'bytes':
      case 'wat':
        return stages[4].ok
    }
  }

  const onKeyDown = (e: React.KeyboardEvent): void => {
    const idx = TABS.findIndex((t) => t.id === activeTab)
    if (e.key === 'ArrowRight') setActiveTab(TABS[(idx + 1) % TABS.length].id)
    if (e.key === 'ArrowLeft') setActiveTab(TABS[(idx - 1 + TABS.length) % TABS.length].id)
  }

  return (
    <section className="panel h-full" aria-label="Inspector">
      <div className="flex h-9 shrink-0 items-center border-b border-line px-1" role="tablist" aria-label="Inspector tabs" onKeyDown={onKeyDown}>
        {TABS.map((t) => {
          const ok = stageOk(t.id)
          return (
            <button
              key={t.id}
              type="button"
              role="tab"
              id={`tab-${t.id}`}
              aria-selected={activeTab === t.id}
              aria-controls={`panel-${t.id}`}
              tabIndex={activeTab === t.id ? 0 : -1}
              className="tab"
              onClick={() => setActiveTab(t.id)}
              title={t.hint}
            >
              <span className={`h-1.5 w-1.5 rounded-full ${ok === true ? 'bg-ember' : ok === false ? 'bg-rust' : 'bg-line-2'}`} aria-hidden />
              {t.label}
            </button>
          )
        })}
      </div>
      <div id={`panel-${activeTab}`} role="tabpanel" aria-labelledby={`tab-${activeTab}`} className="flex min-h-0 flex-1 flex-col">
        {activeTab === 'tokens' && <TokensView />}
        {activeTab === 'ast' && <AstView />}
        {activeTab === 'bytes' && <BytesView />}
        {activeTab === 'wat' && <WatView />}
      </div>
    </section>
  )
}
