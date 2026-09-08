import { closeBrackets, closeBracketsKeymap, completionKeymap } from '@codemirror/autocomplete'
import { defaultKeymap, history, historyKeymap, indentWithTab } from '@codemirror/commands'
import { bracketMatching, indentOnInput, indentUnit } from '@codemirror/language'
import { EditorSelection, EditorState } from '@codemirror/state'
import { EditorView, drawSelection, highlightActiveLine, highlightActiveLineGutter, keymap, lineNumbers } from '@codemirror/view'
import { useEffect, useRef } from 'react'
import { useStore } from '../../state/store'
import { diagnosticsExtension, hoverSpanField, kilnTheme, setDiagnostics, setHoverSpan } from './extensions'
import { kilnSupport } from './kilnLanguage'

export function Editor() {
  const hostRef = useRef<HTMLDivElement>(null)
  const viewRef = useRef<EditorView | null>(null)
  const source = useStore((s) => s.source)
  const diagnostics = useStore((s) => s.result.diagnostics)
  const hoverSpan = useStore((s) => s.hoverSpan)
  const revealSpan = useStore((s) => s.revealSpan)

  // create the view once
  useEffect(() => {
    if (!hostRef.current || viewRef.current) return
    const state = EditorState.create({
      doc: useStore.getState().source,
      extensions: [
        lineNumbers(),
        highlightActiveLine(),
        highlightActiveLineGutter(),
        history(),
        drawSelection(),
        bracketMatching(),
        closeBrackets(),
        indentOnInput(),
        indentUnit.of('  '),
        EditorState.tabSize.of(2),
        keymap.of([
          {
            key: 'Mod-Enter',
            run: () => {
              void useStore.getState().run()
              return true
            },
          },
          ...closeBracketsKeymap,
          ...completionKeymap,
          ...defaultKeymap,
          ...historyKeymap,
          indentWithTab,
        ]),
        kilnSupport(),
        diagnosticsExtension(),
        hoverSpanField,
        kilnTheme,
        EditorView.updateListener.of((update) => {
          if (update.docChanged) {
            const text = update.state.doc.toString()
            if (text !== useStore.getState().source) useStore.getState().setSource(text)
          }
        }),
        EditorView.contentAttributes.of({ 'aria-label': 'Kiln source editor', spellcheck: 'false' }),
      ],
    })
    const view = new EditorView({ state, parent: hostRef.current })
    viewRef.current = view
    view.dispatch({ effects: setDiagnostics.of(useStore.getState().result.diagnostics) })
    return () => {
      view.destroy()
      viewRef.current = null
    }
  }, [])

  // external source changes (examples, share links)
  useEffect(() => {
    const view = viewRef.current
    if (!view) return
    const current = view.state.doc.toString()
    if (current !== source) {
      view.dispatch({
        changes: { from: 0, to: current.length, insert: source },
        selection: EditorSelection.cursor(0),
        scrollIntoView: true,
      })
    }
  }, [source])

  useEffect(() => {
    viewRef.current?.dispatch({ effects: setDiagnostics.of(diagnostics) })
  }, [diagnostics])

  useEffect(() => {
    viewRef.current?.dispatch({ effects: setHoverSpan.of(hoverSpan) })
  }, [hoverSpan])

  useEffect(() => {
    const view = viewRef.current
    if (!view || !revealSpan) return
    const len = view.state.doc.length
    const from = Math.min(revealSpan.span.start, len)
    const to = Math.min(revealSpan.span.end, len)
    view.dispatch({
      selection: EditorSelection.range(from, Math.max(from, to)),
      effects: EditorView.scrollIntoView(from, { y: 'center' }),
    })
    view.focus()
  }, [revealSpan])

  return <div ref={hostRef} className="min-h-0 flex-1 overflow-hidden" />
}
