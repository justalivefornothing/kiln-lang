import type { Span } from './span'

/** Kiln value types. `bool` is lowered to i32 in WebAssembly; `void` is only a return type. */
export type Type = 'i32' | 'f32' | 'bool' | 'void'

export type ValueType = Exclude<Type, 'void'>

export type BinaryOp = '+' | '-' | '*' | '/' | '%' | '==' | '!=' | '<' | '>' | '<=' | '>=' | '&&' | '||'
export type UnaryOp = '-' | '!'
export type AssignOp = '=' | '+=' | '-=' | '*=' | '/=' | '%='
export type MemView = 'mem' | 'mem8' | 'memf'

export interface Program {
  kind: 'Program'
  fns: FnDecl[]
  span: Span
}

export interface Param {
  name: string
  type: ValueType
  span: Span
}

export interface FnDecl {
  kind: 'FnDecl'
  name: string
  nameSpan: Span
  exported: boolean
  params: Param[]
  ret: Type
  body: Block
  span: Span
}

export interface Block {
  kind: 'Block'
  stmts: Stmt[]
  span: Span
}

export interface LetStmt {
  kind: 'Let'
  name: string
  nameSpan: Span
  mutable: boolean
  declared: ValueType | null
  init: Expr
  span: Span
  /** Filled by the checker. */
  resolvedType?: ValueType
  /** Local slot index, filled by the checker. */
  slot?: number
}

export interface AssignStmt {
  kind: 'Assign'
  target: IdentExpr | IndexExpr
  op: AssignOp
  value: Expr
  span: Span
}

export interface IfStmt {
  kind: 'If'
  cond: Expr
  then: Block
  else: Block | IfStmt | null
  span: Span
}

export interface WhileStmt {
  kind: 'While'
  cond: Expr
  body: Block
  span: Span
}

export interface BreakStmt {
  kind: 'Break'
  span: Span
}

export interface ContinueStmt {
  kind: 'Continue'
  span: Span
}

export interface ReturnStmt {
  kind: 'Return'
  value: Expr | null
  span: Span
}

export interface ExprStmt {
  kind: 'ExprStmt'
  expr: Expr
  span: Span
}

export type Stmt = LetStmt | AssignStmt | IfStmt | WhileStmt | BreakStmt | ContinueStmt | ReturnStmt | ExprStmt | Block

interface ExprBase {
  span: Span
  /** Result type, filled by the checker. */
  type?: Type
}

export interface IntLit extends ExprBase {
  kind: 'Int'
  value: number
}

export interface FloatLit extends ExprBase {
  kind: 'Float'
  value: number
}

export interface BoolLit extends ExprBase {
  kind: 'Bool'
  value: boolean
}

export interface IdentExpr extends ExprBase {
  kind: 'Ident'
  name: string
  /** Local slot index, filled by the checker. */
  slot?: number
}

export interface UnaryExpr extends ExprBase {
  kind: 'Unary'
  op: UnaryOp
  operand: Expr
}

export interface BinaryExpr extends ExprBase {
  kind: 'Binary'
  op: BinaryOp
  left: Expr
  right: Expr
}

export type CallTarget =
  | { kind: 'user'; name: string }
  | { kind: 'import'; name: string }
  | { kind: 'intrinsic'; name: string }

export interface CallExpr extends ExprBase {
  kind: 'Call'
  callee: string
  calleeSpan: Span
  args: Expr[]
  /** Filled by the checker. */
  target?: CallTarget
}

export interface CastExpr extends ExprBase {
  kind: 'Cast'
  to: ValueType
  operand: Expr
}

export interface IndexExpr extends ExprBase {
  kind: 'Index'
  view: MemView
  index: Expr
}

export type Expr = IntLit | FloatLit | BoolLit | IdentExpr | UnaryExpr | BinaryExpr | CallExpr | CastExpr | IndexExpr

export type Node = Program | FnDecl | Stmt | Expr

/** Human readable label for a node kind, used by the AST inspector. */
export function nodeLabel(node: Node): string {
  switch (node.kind) {
    case 'Program':
      return 'Program'
    case 'FnDecl':
      return `${node.exported ? 'export ' : ''}fn ${node.name}`
    case 'Block':
      return 'Block'
    case 'Let':
      return `${node.mutable ? 'var' : 'let'} ${node.name}${node.declared ? ': ' + node.declared : ''}`
    case 'Assign':
      return `Assign ${node.op}`
    case 'If':
      return 'If'
    case 'While':
      return 'While'
    case 'Break':
      return 'Break'
    case 'Continue':
      return 'Continue'
    case 'Return':
      return 'Return'
    case 'ExprStmt':
      return 'ExprStmt'
    case 'Int':
      return `Int ${node.value}`
    case 'Float':
      return `Float ${node.value}`
    case 'Bool':
      return `Bool ${node.value}`
    case 'Ident':
      return `Ident ${node.name}`
    case 'Unary':
      return `Unary ${node.op}`
    case 'Binary':
      return `Binary ${node.op}`
    case 'Call':
      return `Call ${node.callee}`
    case 'Cast':
      return `Cast ${node.to}`
    case 'Index':
      return `${node.view}[ ]`
  }
}

/** Ordered children of a node, used for generic traversal (AST inspector, tests). */
export function nodeChildren(node: Node): Node[] {
  switch (node.kind) {
    case 'Program':
      return node.fns
    case 'FnDecl':
      return [node.body]
    case 'Block':
      return node.stmts
    case 'Let':
      return [node.init]
    case 'Assign':
      return [node.target, node.value]
    case 'If':
      return node.else ? [node.cond, node.then, node.else] : [node.cond, node.then]
    case 'While':
      return [node.cond, node.body]
    case 'Break':
    case 'Continue':
      return []
    case 'Return':
      return node.value ? [node.value] : []
    case 'ExprStmt':
      return [node.expr]
    case 'Int':
    case 'Float':
    case 'Bool':
    case 'Ident':
      return []
    case 'Unary':
      return [node.operand]
    case 'Binary':
      return [node.left, node.right]
    case 'Call':
      return node.args
    case 'Cast':
      return [node.operand]
    case 'Index':
      return [node.index]
  }
}
