import type { Block, Expr, FnDecl, IdentExpr, LetStmt, Program, Stmt, Type, ValueType } from './ast'
import type { Diagnostic, Span } from './span'

export interface Signature {
  params: ValueType[]
  ret: Type
}

/** Functions supplied by the host through the `env` import module. */
export const HOST_FUNCTIONS: Record<string, Signature> = {
  print: { params: ['i32'], ret: 'void' },
  printf: { params: ['f32'], ret: 'void' },
  setpixel: { params: ['i32', 'i32', 'i32', 'i32', 'i32'], ret: 'void' },
  rand: { params: [], ret: 'f32' },
  clear: { params: [], ret: 'void' },
}

/** Functions lowered directly to a single WebAssembly opcode. */
export const INTRINSICS: Record<string, Signature> = {
  sqrt: { params: ['f32'], ret: 'f32' },
  floor: { params: ['f32'], ret: 'f32' },
  abs: { params: ['f32'], ret: 'f32' },
  min: { params: ['f32', 'f32'], ret: 'f32' },
  max: { params: ['f32', 'f32'], ret: 'f32' },
}

export interface LocalVar {
  name: string
  type: ValueType
  mutable: boolean
  isParam: boolean
  slot: number
  span: Span
}

export interface FuncInfo {
  name: string
  sig: Signature
  decl: FnDecl
  /** Non-parameter locals in slot order (slot = params.length + position). */
  locals: LocalVar[]
  /** Function index in the module's index space (imports come first). */
  index: number
}

export interface ImportInfo {
  name: string
  sig: Signature
  index: number
}

export interface CheckedProgram {
  program: Program
  funcs: FuncInfo[]
  /** Host functions actually referenced by the program, in index order. */
  imports: ImportInfo[]
  errors: Diagnostic[]
  ok: boolean
}

function describeType(t: Type | undefined): string {
  return t ?? '?'
}

function sigText(name: string, sig: Signature): string {
  return `${name}(${sig.params.join(', ')})${sig.ret === 'void' ? '' : ' -> ' + sig.ret}`
}

/**
 * Scope-aware type checker. Annotates every expression with its type, resolves
 * identifiers to local slots and calls to their targets, verifies return paths
 * and collects the host imports the program uses.
 */
class Checker {
  readonly errors: Diagnostic[] = []
  readonly funcs = new Map<string, FuncInfo>()
  readonly usedImports = new Map<string, ImportInfo>()

  private scopes: Map<string, LocalVar>[] = []
  private current: FuncInfo | null = null
  private loopDepth = 0
  private pendingIdents: { node: IdentExpr | LetStmt; local: LocalVar }[] = []
  readonly program: Program

  constructor(program: Program) {
    this.program = program
  }

  error(message: string, span: Span): void {
    this.errors.push({ stage: 'check', message, span })
  }

  // ---- program -------------------------------------------------------------

  check(): void {
    // pass 1: signatures, so functions may call each other in any order (recursion included)
    for (const fn of this.program.fns) {
      if (this.funcs.has(fn.name)) {
        this.error(`duplicate function '${fn.name}'`, fn.nameSpan)
        continue
      }
      if (fn.name in HOST_FUNCTIONS || fn.name in INTRINSICS) {
        this.error(`'${fn.name}' is a built-in function and cannot be redefined`, fn.nameSpan)
        continue
      }
      const seen = new Set<string>()
      for (const p of fn.params) {
        if (seen.has(p.name)) this.error(`duplicate parameter '${p.name}'`, p.span)
        seen.add(p.name)
      }
      this.funcs.set(fn.name, {
        name: fn.name,
        sig: { params: fn.params.map((p) => p.type), ret: fn.ret },
        decl: fn,
        locals: [],
        index: -1,
      })
    }

    // pass 2: bodies
    for (const fn of this.program.fns) {
      const info = this.funcs.get(fn.name)
      if (!info || info.decl !== fn) continue
      this.checkFn(info)
    }

    // final index assignment: imports first (in table order for determinism), then user functions
    let index = 0
    const ordered = Object.keys(HOST_FUNCTIONS)
      .filter((n) => this.usedImports.has(n))
      .map((n) => this.usedImports.get(n)!)
    for (const imp of ordered) imp.index = index++
    for (const info of this.funcs.values()) info.index = index++
  }

  private checkFn(info: FuncInfo): void {
    this.current = info
    this.scopes = [new Map()]
    this.loopDepth = 0
    this.pendingIdents = []
    const rawLocals: LocalVar[] = []

    info.decl.params.forEach((p, i) => {
      this.scopes[0].set(p.name, { name: p.name, type: p.type, mutable: true, isParam: true, slot: i, span: p.span })
    })

    const declare = (name: string, type: ValueType, mutable: boolean, span: Span): LocalVar => {
      const local: LocalVar = { name, type, mutable, isParam: false, slot: -1, span }
      rawLocals.push(local)
      return local
    }

    this.checkBlock(info.decl.body, declare, false)

    if (info.sig.ret !== 'void' && !blockAlwaysReturns(info.decl.body)) {
      const close = info.decl.body.span
      this.error(
        `function '${info.name}' must return a value of type ${info.sig.ret} on every path`,
        { start: close.end - 1, end: close.end, line: close.endLine, col: Math.max(1, close.endCol - 1), endLine: close.endLine, endCol: close.endCol },
      )
    }

    // Assign slots grouped by type so the emitter can run-length compress the local declarations.
    const grouped = [...rawLocals.filter((l) => l.type !== 'f32'), ...rawLocals.filter((l) => l.type === 'f32')]
    grouped.forEach((l, i) => {
      l.slot = info.decl.params.length + i
    })
    info.locals = grouped
    for (const { node, local } of this.pendingIdents) node.slot = local.slot
    this.current = null
  }

  // ---- scopes --------------------------------------------------------------

  private lookup(name: string): LocalVar | null {
    for (let i = this.scopes.length - 1; i >= 0; i--) {
      const v = this.scopes[i].get(name)
      if (v) return v
    }
    return null
  }

  // ---- statements ----------------------------------------------------------

  private checkBlock(block: Block, declare: DeclareFn, newScope = true): void {
    if (newScope) this.scopes.push(new Map())
    for (const stmt of block.stmts) this.checkStmt(stmt, declare)
    if (newScope) this.scopes.pop()
  }

  private checkStmt(stmt: Stmt, declare: DeclareFn): void {
    switch (stmt.kind) {
      case 'Let': {
        const initType = this.checkExpr(stmt.init)
        let type: ValueType | null = stmt.declared
        if (type) {
          if (initType !== undefined && initType !== type) {
            this.error(
              `cannot initialize '${stmt.name}: ${type}' with a value of type ${describeType(initType)}${castHint(type, initType)}`,
              stmt.init.span,
            )
          }
        } else if (initType === 'void') {
          this.error(`cannot infer a type for '${stmt.name}': the initializer has no value`, stmt.init.span)
          type = 'i32'
        } else if (initType !== undefined) {
          type = initType
        }
        const scope = this.scopes[this.scopes.length - 1]
        const existing = scope.get(stmt.name)
        if (existing) {
          this.error(
            existing.isParam
              ? `'${stmt.name}' is already declared as a parameter`
              : `duplicate declaration of '${stmt.name}' in the same scope (first declared at ${existing.span.line}:${existing.span.col})`,
            stmt.nameSpan,
          )
        }
        const local = declare(stmt.name, type ?? 'i32', stmt.mutable, stmt.nameSpan)
        stmt.resolvedType = local.type
        this.pendingIdents.push({ node: stmt, local })
        scope.set(stmt.name, local)
        return
      }
      case 'Assign': {
        const valueType = this.checkExpr(stmt.value)
        if (stmt.target.kind === 'Ident') {
          const local = this.lookup(stmt.target.name)
          if (!local) {
            this.error(`undefined variable '${stmt.target.name}'`, stmt.target.span)
            return
          }
          stmt.target.type = local.type
          this.pendingIdents.push({ node: stmt.target, local })
          if (!local.mutable) {
            this.error(`cannot assign to immutable variable '${local.name}' (declared with 'let'; use 'var' to allow assignment)`, stmt.target.span)
          }
          this.checkAssignTypes(local.type, valueType, stmt)
        } else {
          const targetType = this.checkExpr(stmt.target)
          this.checkAssignTypes(targetType as ValueType, valueType, stmt)
        }
        return
      }
      case 'If': {
        const c = this.checkExpr(stmt.cond)
        if (c !== undefined && c !== 'bool') {
          this.error(`if condition must be bool, found ${c}${c === 'i32' ? " (compare explicitly, e.g. 'x != 0')" : ''}`, stmt.cond.span)
        }
        this.checkBlock(stmt.then, declare)
        if (stmt.else) {
          if (stmt.else.kind === 'If') this.checkStmt(stmt.else, declare)
          else this.checkBlock(stmt.else, declare)
        }
        return
      }
      case 'While': {
        const c = this.checkExpr(stmt.cond)
        if (c !== undefined && c !== 'bool') this.error(`while condition must be bool, found ${c}`, stmt.cond.span)
        this.loopDepth++
        this.checkBlock(stmt.body, declare)
        this.loopDepth--
        return
      }
      case 'Break':
        if (this.loopDepth === 0) this.error("'break' outside of a loop", stmt.span)
        return
      case 'Continue':
        if (this.loopDepth === 0) this.error("'continue' outside of a loop", stmt.span)
        return
      case 'Return': {
        const fn = this.current!
        if (stmt.value) {
          const t = this.checkExpr(stmt.value)
          if (fn.sig.ret === 'void') {
            this.error(`function '${fn.name}' has no return type, but this returns a value of type ${describeType(t)}`, stmt.value.span)
          } else if (t !== undefined && t !== fn.sig.ret) {
            this.error(`function '${fn.name}' returns ${fn.sig.ret}, but this value has type ${t}${castHint(fn.sig.ret, t)}`, stmt.value.span)
          }
        } else if (fn.sig.ret !== 'void') {
          this.error(`function '${fn.name}' must return a value of type ${fn.sig.ret}`, stmt.span)
        }
        return
      }
      case 'ExprStmt':
        this.checkExpr(stmt.expr)
        return
      case 'Block':
        this.checkBlock(stmt, declare)
        return
    }
  }

  private checkAssignTypes(target: Type | undefined, value: Type | undefined, stmt: Extract<Stmt, { kind: 'Assign' }>): void {
    if (target === undefined || value === undefined) return
    if (stmt.op !== '=') {
      const arith = stmt.op.slice(0, 1)
      if (target === 'bool') {
        this.error(`operator '${stmt.op}' cannot be applied to bool`, stmt.span)
        return
      }
      if (arith === '%' && target === 'f32') {
        this.error("operator '%=' is only defined for i32", stmt.span)
        return
      }
    }
    if (target !== value) {
      this.error(`cannot assign a value of type ${value} to a target of type ${target}${castHint(target, value)}`, stmt.value.span)
    }
  }

  // ---- expressions ---------------------------------------------------------

  /** Returns the expression's type, or undefined if it could not be determined because of an earlier error. */
  private checkExpr(e: Expr): Type | undefined {
    const t = this.inferExpr(e)
    if (t !== undefined) e.type = t
    return t
  }

  private inferExpr(e: Expr): Type | undefined {
    switch (e.kind) {
      case 'Int':
        return 'i32'
      case 'Float':
        return 'f32'
      case 'Bool':
        return 'bool'
      case 'Ident': {
        const local = this.lookup(e.name)
        if (!local) {
          const fn = this.funcs.get(e.name)
          this.error(
            fn ? `'${e.name}' is a function; call it with parentheses: ${e.name}(...)` : `undefined variable '${e.name}'`,
            e.span,
          )
          return undefined
        }
        this.pendingIdents.push({ node: e, local })
        return local.type
      }
      case 'Unary': {
        const t = this.checkExpr(e.operand)
        if (t === undefined) return undefined
        if (e.op === '!') {
          if (t !== 'bool') {
            this.error(`operator '!' expects a bool operand, found ${t}`, e.span)
            return undefined
          }
          return 'bool'
        }
        if (t !== 'i32' && t !== 'f32') {
          this.error(`unary '-' expects a numeric operand, found ${t}`, e.span)
          return undefined
        }
        return t
      }
      case 'Binary': {
        const l = this.checkExpr(e.left)
        const r = this.checkExpr(e.right)
        if (l === undefined || r === undefined) return undefined
        switch (e.op) {
          case '&&':
          case '||':
            if (l !== 'bool' || r !== 'bool') {
              this.error(`operator '${e.op}' expects bool operands, found ${l} and ${r}`, e.span)
              return undefined
            }
            return 'bool'
          case '==':
          case '!=':
            if (l !== r) {
              this.error(`cannot compare ${l} with ${r}${castHint(l, r)}`, e.span)
              return undefined
            }
            return 'bool'
          case '<':
          case '>':
          case '<=':
          case '>=':
            if (l === 'bool' || r === 'bool') {
              this.error(`operator '${e.op}' cannot be applied to bool`, e.span)
              return undefined
            }
            if (l !== r) {
              this.error(`cannot compare ${l} with ${r}: Kiln has no implicit numeric conversion${castHint(l, r)}`, e.span)
              return undefined
            }
            return 'bool'
          default: {
            if (l === 'bool' || r === 'bool') {
              this.error(`operator '${e.op}' cannot be applied to bool`, e.span)
              return undefined
            }
            if (l !== r) {
              this.error(`operator '${e.op}' needs operands of the same type, found ${l} and ${r}${castHint(l, r)}`, e.span)
              return undefined
            }
            if (e.op === '%' && l === 'f32') {
              this.error("operator '%' is only defined for i32 (WebAssembly has no f32 remainder)", e.span)
              return undefined
            }
            return l
          }
        }
      }
      case 'Cast': {
        const t = this.checkExpr(e.operand)
        if (t === undefined) return undefined
        if (t === 'void') {
          this.error(`cannot cast a value-less expression to ${e.to}`, e.operand.span)
          return undefined
        }
        if (e.to === 'f32' && t === 'bool') {
          this.error('cannot cast bool to f32; cast to i32 first', e.span)
          return undefined
        }
        return e.to
      }
      case 'Call':
        return this.checkCall(e)
      case 'Index': {
        const t = this.checkExpr(e.index)
        if (t !== undefined && t !== 'i32') this.error(`${e.view}[...] index must be i32, found ${t}`, e.index.span)
        return e.view === 'memf' ? 'f32' : 'i32'
      }
    }
  }

  private checkCall(e: Extract<Expr, { kind: 'Call' }>): Type | undefined {
    let sig: Signature | undefined
    if (this.funcs.has(e.callee)) {
      sig = this.funcs.get(e.callee)!.sig
      e.target = { kind: 'user', name: e.callee }
    } else if (e.callee in HOST_FUNCTIONS) {
      sig = HOST_FUNCTIONS[e.callee]
      e.target = { kind: 'import', name: e.callee }
      if (!this.usedImports.has(e.callee)) this.usedImports.set(e.callee, { name: e.callee, sig, index: -1 })
    } else if (e.callee in INTRINSICS) {
      sig = INTRINSICS[e.callee]
      e.target = { kind: 'intrinsic', name: e.callee }
    }

    const argTypes = e.args.map((a) => this.checkExpr(a))
    if (!sig) {
      const local = this.lookup(e.callee)
      this.error(local ? `'${e.callee}' is a variable, not a function` : `undefined function '${e.callee}'`, e.calleeSpan)
      return undefined
    }
    if (argTypes.length !== sig.params.length) {
      this.error(`'${e.callee}' expects ${sig.params.length} argument${sig.params.length === 1 ? '' : 's'} but got ${argTypes.length}: ${sigText(e.callee, sig)}`, e.span)
      return sig.ret
    }
    argTypes.forEach((t, i) => {
      if (t !== undefined && t !== sig.params[i]) {
        this.error(`argument ${i + 1} of '${e.callee}' must be ${sig.params[i]}, found ${t}${castHint(sig.params[i], t)}`, e.args[i].span)
      }
    })
    return sig.ret
  }
}

type DeclareFn = (name: string, type: ValueType, mutable: boolean, span: Span) => LocalVar

function castHint(expected: Type | undefined, found: Type | undefined): string {
  if ((expected === 'i32' && found === 'f32') || (expected === 'f32' && found === 'i32')) {
    return ` (use an explicit cast: ${expected}(...))`
  }
  return ''
}

/** True if control can never fall off the end of the block. */
export function blockAlwaysReturns(block: Block): boolean {
  return block.stmts.some(stmtAlwaysReturns)
}

function stmtAlwaysReturns(stmt: Stmt): boolean {
  switch (stmt.kind) {
    case 'Return':
      return true
    case 'Block':
      return blockAlwaysReturns(stmt)
    case 'If':
      return (
        stmt.else !== null &&
        blockAlwaysReturns(stmt.then) &&
        (stmt.else.kind === 'If' ? stmtAlwaysReturns(stmt.else) : blockAlwaysReturns(stmt.else))
      )
    case 'While':
      // `while true { ... }` without a break either loops forever or returns from inside
      return stmt.cond.kind === 'Bool' && stmt.cond.value && !containsBreak(stmt.body)
    default:
      return false
  }
}

function containsBreak(block: Block): boolean {
  for (const s of block.stmts) {
    switch (s.kind) {
      case 'Break':
        return true
      case 'Block':
        if (containsBreak(s)) return true
        break
      case 'If':
        if (containsBreak(s.then)) return true
        if (s.else && (s.else.kind === 'If' ? containsBreak({ kind: 'Block', stmts: [s.else], span: s.else.span }) : containsBreak(s.else))) return true
        break
      default:
        break // breaks inside nested while loops belong to that loop
    }
  }
  return false
}

export function check(program: Program): CheckedProgram {
  const c = new Checker(program)
  c.check()
  const imports = Object.keys(HOST_FUNCTIONS)
    .filter((n) => c.usedImports.has(n))
    .map((n) => c.usedImports.get(n)!)
  return {
    program,
    funcs: [...c.funcs.values()],
    imports,
    errors: c.errors,
    ok: c.errors.length === 0,
  }
}
