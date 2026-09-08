import type { StageName, StageResult } from '../compiler/compile'
import { useStore } from '../state/store'
import { ArrowRightIcon, CheckIcon, DashIcon, XIcon } from './Icons'

const LABELS: Record<StageName, { title: string; sub: string }> = {
  source: { title: 'source', sub: 'text' },
  tokens: { title: 'tokens', sub: 'lexer' },
  ast: { title: 'AST', sub: 'parser' },
  typed: { title: 'typed AST', sub: 'checker' },
  bytes: { title: 'bytes', sub: 'emitter' },
}

function fmtMs(ms: number): string {
  if (ms < 0.005) return '<0.01 ms'
  return `${ms.toFixed(2)} ms`
}

export function Pipeline() {
  const stages = useStore((s) => s.result.stages)
  const compileId = useStore((s) => s.compileId)
  const totalMs = useStore((s) => s.result.totalMs)
  const source = useStore((s) => s.source)
  const tokens = useStore((s) => s.result.tokens.length)
  const bytes = useStore((s) => s.result.bytes?.length ?? 0)
  const ok = useStore((s) => s.result.ok)

  // the "active" stage is the furthest one that ran: ember when it passed, rust when it failed
  const lastIndex = stages.reduce((idx, s, i) => (s.ok === null ? idx : i), 0)

  const counts: Partial<Record<StageName, string>> = {
    source: `${source.length} chars`,
    tokens: `${tokens} tokens`,
    bytes: bytes ? `${bytes} B` : undefined,
  }

  return (
    <div className="flex h-11 shrink-0 items-center gap-1 overflow-x-auto border-b border-line bg-charcoal px-3 sm:px-4" aria-label="Compilation pipeline">
      <ol className="flex items-center gap-1">
        {stages.map((stage, i) => (
          <li key={stage.name} className="flex items-center gap-1">
            <Stage stage={stage} active={i === lastIndex} compileId={compileId} count={counts[stage.name]} />
            {i < stages.length - 1 && <ArrowRightIcon size={13} className={`shrink-0 ${stage.ok ? 'text-muted' : 'text-line-2'}`} />}
          </li>
        ))}
      </ol>
      <div className="flex-1" />
      <div className={`hidden shrink-0 font-mono text-[11px] sm:block ${ok ? 'text-muted' : 'text-rust'}`} aria-live="polite">
        {ok ? `compiled in ${fmtMs(totalMs)}` : 'compile failed'}
      </div>
    </div>
  )
}

function Stage({ stage, active, compileId, count }: { stage: StageResult; active: boolean; compileId: number; count?: string }) {
  const label = LABELS[stage.name]
  const state = stage.ok === null ? 'skipped' : stage.ok ? 'ok' : 'fail'
  const ring =
    state === 'ok'
      ? active
        ? 'border-ember bg-ember text-charcoal'
        : 'border-ember/50 bg-ember/10 text-ember-2'
      : state === 'fail'
        ? 'border-rust bg-rust/15 text-rust'
        : 'border-line-2 bg-panel text-muted-2'
  const title =
    state === 'ok'
      ? `${label.title}: ok in ${fmtMs(stage.ms)}`
      : state === 'fail'
        ? `${label.title}: ${stage.errorCount} error${stage.errorCount === 1 ? '' : 's'} (${fmtMs(stage.ms)})`
        : `${label.title}: not reached`
  return (
    <div
      className={`flex items-center gap-2 rounded-md border px-2 py-1 transition-colors ${
        active && state === 'ok' ? 'border-ember/40 bg-ember/5' : active && state === 'fail' ? 'border-rust/40 bg-rust/5' : 'border-transparent'
      }`}
      title={title}
      aria-label={title}
    >
      <span key={`${compileId}-${state}`} className={`stage-icon flex h-5 w-5 items-center justify-center rounded-full border ${ring}`}>
        {state === 'ok' ? <CheckIcon size={12} strokeWidth={3} /> : state === 'fail' ? <XIcon size={11} strokeWidth={3} /> : <DashIcon size={11} />}
      </span>
      <span className="leading-none">
        <span className={`block text-[12px] font-semibold ${state === 'skipped' ? 'text-muted-2' : state === 'fail' ? 'text-rust' : 'text-ink'}`}>
          {label.title}
        </span>
        <span className="mt-0.5 block font-mono text-[10px] text-muted">
          {state === 'skipped' ? label.sub : state === 'fail' ? `${stage.errorCount} error${stage.errorCount === 1 ? '' : 's'}` : count ?? fmtMs(stage.ms)}
          {state === 'ok' && count ? <span className="hidden xl:inline"> · {fmtMs(stage.ms)}</span> : null}
        </span>
      </span>
    </div>
  )
}
