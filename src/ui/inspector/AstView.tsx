import { useCallback, useMemo, useState } from 'react'
import { nodeChildren, nodeLabel, type Node } from '../../compiler/ast'
import { useStore } from '../../state/store'
import { ChevronDownIcon, ChevronRightIcon } from '../Icons'

/** Stable path-based ids so collapse state survives re-parses of similar trees. */
function childId(parent: string, i: number): string {
  return `${parent}.${i}`
}

const TYPE_COLOR: Record<string, string> = {
  i32: 'text-tok-type',
  f32: 'text-tok-number',
  bool: 'text-tok-bool',
  void: 'text-muted-2',
}

function nodeType(node: Node): string | undefined {
  if ('type' in node && typeof node.type === 'string') return node.type
  if (node.kind === 'Let') return node.resolvedType
  if (node.kind === 'FnDecl') return node.ret
  return undefined
}

function kindGroup(node: Node): 'decl' | 'stmt' | 'expr' | 'lit' {
  switch (node.kind) {
    case 'Program':
    case 'FnDecl':
      return 'decl'
    case 'Int':
    case 'Float':
    case 'Bool':
      return 'lit'
    case 'Ident':
    case 'Unary':
    case 'Binary':
    case 'Call':
    case 'Cast':
    case 'Index':
      return 'expr'
    default:
      return 'stmt'
  }
}

const GROUP_COLOR = {
  decl: 'text-ember-2',
  stmt: 'text-tok-keyword',
  expr: 'text-ink',
  lit: 'text-tok-number',
}

export function AstView() {
  const ast = useStore((s) => s.result.ast)
  const checked = useStore((s) => s.result.checked)
  const diagnostics = useStore((s) => s.result.diagnostics)
  const [collapsed, setCollapsed] = useState<Set<string>>(() => new Set())
  const toggle = useCallback((id: string) => {
    setCollapsed((prev) => {
      const next = new Set(prev)
      if (next.has(id)) next.delete(id)
      else next.add(id)
      return next
    })
  }, [])

  const stats = useMemo(() => {
    if (!ast) return { nodes: 0, depth: 0 }
    let nodes = 0
    let depth = 0
    const walk = (n: Node, d: number): void => {
      nodes++
      depth = Math.max(depth, d)
      for (const c of nodeChildren(n)) walk(c, d + 1)
    }
    walk(ast, 1)
    return { nodes, depth }
  }, [ast])

  if (!ast) {
    return (
      <div className="flex flex-1 flex-col items-center justify-center gap-2 p-6 text-center text-muted">
        <span className="text-[13px]">No AST: the lexer reported errors.</span>
        <span className="font-mono text-[11px] text-rust">{diagnostics[0]?.message}</span>
      </div>
    )
  }

  return (
    <div className="flex min-h-0 flex-1 flex-col">
      <div className="flex items-center gap-3 border-b border-line px-3 py-2 font-mono text-[11px] text-muted">
        <span>{stats.nodes} nodes</span>
        <span>depth {stats.depth}</span>
        <span className={checked?.ok ? 'text-ember-2' : 'text-muted-2'}>{checked?.ok ? 'typed' : checked ? 'type errors' : 'unchecked'}</span>
        <span className="ml-auto hidden text-muted-2 sm:inline">hover a node to highlight its source</span>
      </div>
      <div className="min-h-0 flex-1 overflow-auto p-2" onMouseLeave={() => useStore.getState().setHoverSpan(null)}>
        <TreeNode node={ast} id="0" depth={0} collapsed={collapsed} toggle={toggle} />
      </div>
    </div>
  )
}

interface TreeNodeProps {
  node: Node
  id: string
  depth: number
  collapsed: Set<string>
  toggle: (id: string) => void
}

function TreeNode({ node, id, depth, collapsed, toggle }: TreeNodeProps) {
  const setHoverSpan = useStore((s) => s.setHoverSpan)
  const reveal = useStore((s) => s.reveal)
  const children = nodeChildren(node)
  const isCollapsed = collapsed.has(id)
  const type = nodeType(node)
  const group = kindGroup(node)
  const span = node.span

  return (
    <div>
      <div
        className="tree-row"
        style={{ paddingLeft: depth * 14 + 4 }}
        onMouseEnter={() => setHoverSpan(span)}
        onClick={() => reveal(span)}
        role="treeitem"
        aria-expanded={children.length ? !isCollapsed : undefined}
        aria-level={depth + 1}
        tabIndex={0}
        onFocus={() => setHoverSpan(span)}
        onKeyDown={(e) => {
          if (e.key === 'Enter') reveal(span)
          if ((e.key === 'ArrowRight' && isCollapsed) || (e.key === 'ArrowLeft' && !isCollapsed)) toggle(id)
        }}
      >
        {children.length > 0 ? (
          <button
            type="button"
            className="flex h-4 w-4 items-center justify-center rounded text-muted hover:text-ink"
            onClick={(e) => {
              e.stopPropagation()
              toggle(id)
            }}
            aria-label={isCollapsed ? 'expand' : 'collapse'}
            tabIndex={-1}
          >
            {isCollapsed ? <ChevronRightIcon size={12} /> : <ChevronDownIcon size={12} />}
          </button>
        ) : (
          <span className="inline-block h-4 w-4 text-center text-muted-2">·</span>
        )}
        <span className={GROUP_COLOR[group]}>{nodeLabel(node)}</span>
        {type && type !== 'void' ? <span className={`${TYPE_COLOR[type] ?? 'text-muted'}`}>: {type}</span> : null}
        {node.kind === 'FnDecl' && node.params.length > 0 ? (
          <span className="text-muted">({node.params.map((p) => `${p.name}: ${p.type}`).join(', ')})</span>
        ) : null}
        {node.kind === 'Ident' && node.slot !== undefined ? <span className="text-muted-2">slot {node.slot}</span> : null}
        {node.kind === 'Call' && node.target ? <span className="text-muted-2">{node.target.kind}</span> : null}
        {isCollapsed && children.length ? <span className="text-muted-2">… {children.length}</span> : null}
        <span className="ml-auto pl-3 text-[10px] text-muted-2">
          {span.line}:{span.col}
        </span>
      </div>
      {!isCollapsed &&
        children.map((c, i) => <TreeNode key={childId(id, i)} node={c} id={childId(id, i)} depth={depth + 1} collapsed={collapsed} toggle={toggle} />)}
    </div>
  )
}
