import type {
  AssignOp,
  BinaryOp,
  Block,
  Expr,
  FnDecl,
  IdentExpr,
  IfStmt,
  IndexExpr,
  MemView,
  Param,
  Program,
  Stmt,
  Type,
  ValueType,
} from './ast'
import { spanFrom, type Diagnostic, type Span } from './span'
import type { Token } from './tokens'

export interface ParseResult {
  program: Program
  errors: Diagnostic[]
}

class ParseError extends Error {
  span: Span
  constructor(message: string, span: Span) {
    super(message)
    this.span = span
  }
}

/** Binding power of each binary operator; higher binds tighter. */
const BINARY_PRECEDENCE: Record<BinaryOp, number> = {
  '||': 1,
  '&&': 2,
  '==': 3,
  '!=': 3,
  '<': 4,
  '>': 4,
  '<=': 4,
  '>=': 4,
  '+': 5,
  '-': 5,
  '*': 6,
  '/': 6,
  '%': 6,
}

const UNARY_PRECEDENCE = 7

const ASSIGN_OPS = new Set<string>(['=', '+=', '-=', '*=', '/=', '%='])

function describe(tok: Token): string {
  if (tok.kind === 'eof') return 'end of input'
  return `'${tok.text}'`
}

/**
 * Precedence-climbing (Pratt) parser. Statements are parsed with panic-mode
 * recovery: after a syntax error we skip to the next `;` or `}` so that several
 * independent mistakes can be reported at once.
 */
class Parser {
  private pos = 0
  readonly errors: Diagnostic[] = []
  private readonly tokens: Token[]

  constructor(tokens: Token[]) {
    this.tokens = tokens
  }

  // ---- token helpers -------------------------------------------------------

  private peek(offset = 0): Token {
    return this.tokens[Math.min(this.pos + offset, this.tokens.length - 1)]
  }

  private next(): Token {
    const t = this.tokens[this.pos]
    if (this.pos < this.tokens.length - 1) this.pos++
    return t
  }

  private at(text: string): boolean {
    const t = this.peek()
    return t.kind !== 'eof' && t.text === text && (t.kind === 'op' || t.kind === 'punct' || t.kind === 'keyword')
  }

  private atKind(kind: Token['kind']): boolean {
    return this.peek().kind === kind
  }

  private accept(text: string): Token | null {
    if (this.at(text)) return this.next()
    return null
  }

  private expect(text: string, context: string): Token {
    if (this.at(text)) return this.next()
    const t = this.peek()
    throw new ParseError(`expected '${text}' ${context}, found ${describe(t)}`, t.span)
  }

  private expectIdent(context: string): Token {
    const t = this.peek()
    if (t.kind === 'ident') return this.next()
    if (t.kind === 'keyword' || t.kind === 'type' || t.kind === 'builtin' || t.kind === 'bool') {
      throw new ParseError(`expected identifier ${context}, but '${t.text}' is a reserved word`, t.span)
    }
    throw new ParseError(`expected identifier ${context}, found ${describe(t)}`, t.span)
  }

  private parseType(): ValueType {
    const t = this.peek()
    if (t.kind === 'type') {
      this.next()
      return t.text as ValueType
    }
    throw new ParseError(`expected a type (i32, f32 or bool), found ${describe(t)}`, t.span)
  }

  // ---- recovery ------------------------------------------------------------

  private record(err: ParseError): void {
    this.errors.push({ stage: 'parse', message: err.message, span: err.span })
  }

  /** Skip tokens until a statement boundary so parsing can continue. */
  private synchronize(): void {
    while (!this.atKind('eof')) {
      const t = this.peek()
      if (t.text === ';' && t.kind === 'punct') {
        this.next()
        return
      }
      if (t.text === '}' && t.kind === 'punct') return
      if (t.kind === 'keyword' && (t.text === 'fn' || t.text === 'export')) return
      this.next()
    }
  }

  // ---- program -------------------------------------------------------------

  parseProgram(): Program {
    const fns: FnDecl[] = []
    const first = this.peek()
    while (!this.atKind('eof')) {
      try {
        fns.push(this.parseFn())
      } catch (e) {
        if (!(e instanceof ParseError)) throw e
        this.record(e)
        // skip to the next top-level function
        while (!this.atKind('eof') && !this.at('fn') && !this.at('export')) this.next()
        if (this.errors.length > 25) break
      }
    }
    const last = this.peek()
    return { kind: 'Program', fns, span: spanFrom(first.span, last.span) }
  }

  private parseFn(): FnDecl {
    const startTok = this.peek()
    let exported = false
    if (this.accept('export')) exported = true
    if (!this.at('fn')) {
      const t = this.peek()
      throw new ParseError(
        exported
          ? `expected 'fn' after 'export', found ${describe(t)}`
          : `expected 'fn' or 'export fn' at top level, found ${describe(t)}`,
        t.span,
      )
    }
    this.next()
    const nameTok = this.expectIdent('after fn')
    this.expect('(', `after function name '${nameTok.text}'`)
    const params: Param[] = []
    if (!this.at(')')) {
      for (;;) {
        const pName = this.expectIdent('for parameter name')
        this.expect(':', `after parameter '${pName.text}' (parameters need a type, e.g. ${pName.text}: i32)`)
        const type = this.parseType()
        params.push({ name: pName.text, type, span: spanFrom(pName.span, this.tokens[this.pos - 1].span) })
        if (this.accept(',')) continue
        break
      }
    }
    this.expect(')', 'after parameter list')
    let ret: Type = 'void'
    if (this.accept('->')) ret = this.parseType()
    const body = this.parseBlock('for function body')
    return {
      kind: 'FnDecl',
      name: nameTok.text,
      nameSpan: nameTok.span,
      exported,
      params,
      ret,
      body,
      span: spanFrom(startTok.span, body.span),
    }
  }

  // ---- statements ----------------------------------------------------------

  private parseBlock(context: string): Block {
    const open = this.expect('{', context)
    const stmts: Stmt[] = []
    while (!this.at('}') && !this.atKind('eof')) {
      try {
        stmts.push(this.parseStmt())
      } catch (e) {
        if (!(e instanceof ParseError)) throw e
        this.record(e)
        this.synchronize()
        if (this.errors.length > 25) break
      }
    }
    const close = this.expect('}', 'to close block')
    return { kind: 'Block', stmts, span: spanFrom(open.span, close.span) }
  }

  private parseStmt(): Stmt {
    const t = this.peek()
    if (t.kind === 'keyword') {
      switch (t.text) {
        case 'let':
        case 'var':
          return this.parseLet()
        case 'if':
          return this.parseIf()
        case 'while':
          return this.parseWhile()
        case 'break': {
          this.next()
          const semi = this.expect(';', "after 'break'")
          return { kind: 'Break', span: spanFrom(t.span, semi.span) }
        }
        case 'continue': {
          this.next()
          const semi = this.expect(';', "after 'continue'")
          return { kind: 'Continue', span: spanFrom(t.span, semi.span) }
        }
        case 'return': {
          this.next()
          let value: Expr | null = null
          if (!this.at(';')) value = this.parseExpr()
          const semi = this.expect(';', 'after return statement')
          return { kind: 'Return', value, span: spanFrom(t.span, semi.span) }
        }
        case 'fn':
        case 'export':
          throw new ParseError('functions can only be declared at the top level', t.span)
        case 'else':
          throw new ParseError("'else' without a matching 'if'", t.span)
      }
    }
    if (this.at('{')) return this.parseBlock('for block')

    // assignment or expression statement
    const expr = this.parseExpr()
    const opTok = this.peek()
    if (opTok.kind === 'op' && ASSIGN_OPS.has(opTok.text)) {
      if (expr.kind !== 'Ident' && expr.kind !== 'Index') {
        throw new ParseError(`cannot assign to this expression; the left side of '${opTok.text}' must be a variable or mem[...]`, expr.span)
      }
      this.next()
      const value = this.parseExpr()
      const semi = this.expect(';', 'after assignment')
      return {
        kind: 'Assign',
        target: expr as IdentExpr | IndexExpr,
        op: opTok.text as AssignOp,
        value,
        span: spanFrom(expr.span, semi.span),
      }
    }
    const semi = this.expect(';', 'after expression statement')
    return { kind: 'ExprStmt', expr, span: spanFrom(expr.span, semi.span) }
  }

  private parseLet(): Stmt {
    const kw = this.next()
    const mutable = kw.text === 'var'
    const nameTok = this.expectIdent(`after '${kw.text}'`)
    let declared: ValueType | null = null
    if (this.accept(':')) declared = this.parseType()
    this.expect('=', `after '${kw.text} ${nameTok.text}' (declarations need an initial value)`)
    const init = this.parseExpr()
    const semi = this.expect(';', 'after declaration')
    return {
      kind: 'Let',
      name: nameTok.text,
      nameSpan: nameTok.span,
      mutable,
      declared,
      init,
      span: spanFrom(kw.span, semi.span),
    }
  }

  private parseIf(): IfStmt {
    const kw = this.next()
    const cond = this.parseExpr()
    const then = this.parseBlock("for 'if' body (conditions do not need parentheses)")
    let elseBranch: Block | IfStmt | null = null
    if (this.accept('else')) {
      if (this.at('if')) elseBranch = this.parseIf()
      else elseBranch = this.parseBlock("after 'else'")
    }
    return { kind: 'If', cond, then, else: elseBranch, span: spanFrom(kw.span, (elseBranch ?? then).span) }
  }

  private parseWhile(): Stmt {
    const kw = this.next()
    const cond = this.parseExpr()
    const body = this.parseBlock("for 'while' body")
    return { kind: 'While', cond, body, span: spanFrom(kw.span, body.span) }
  }

  // ---- expressions (Pratt) -------------------------------------------------

  parseExpr(minPrec = 1): Expr {
    let left = this.parseUnary()
    for (;;) {
      const t = this.peek()
      if (t.kind !== 'op') break
      const prec = BINARY_PRECEDENCE[t.text as BinaryOp]
      if (prec === undefined || prec < minPrec) break
      this.next()
      // all binary operators are left-associative: parse the right side one level tighter
      const right = this.parseExpr(prec + 1)
      left = { kind: 'Binary', op: t.text as BinaryOp, left, right, span: spanFrom(left.span, right.span) }
    }
    return left
  }

  private parseUnary(): Expr {
    const t = this.peek()
    if (t.kind === 'op' && (t.text === '-' || t.text === '!')) {
      this.next()
      const operand = this.parseExpr(UNARY_PRECEDENCE)
      return { kind: 'Unary', op: t.text, operand, span: spanFrom(t.span, operand.span) }
    }
    return this.parsePrimary()
  }

  private parseArgs(callee: string): { args: Expr[]; close: Token } {
    this.expect('(', `after '${callee}'`)
    const args: Expr[] = []
    if (!this.at(')')) {
      for (;;) {
        args.push(this.parseExpr())
        if (this.accept(',')) continue
        break
      }
    }
    const close = this.expect(')', `to close the argument list of '${callee}'`)
    return { args, close }
  }

  private parsePrimary(): Expr {
    const t = this.peek()
    switch (t.kind) {
      case 'int':
        this.next()
        return { kind: 'Int', value: t.value ?? 0, span: t.span }
      case 'float':
        this.next()
        return { kind: 'Float', value: t.value ?? 0, span: t.span }
      case 'bool':
        this.next()
        return { kind: 'Bool', value: t.text === 'true', span: t.span }
      case 'type': {
        // explicit cast: i32(expr) / f32(expr)
        this.next()
        if (t.text === 'bool') {
          throw new ParseError("cannot cast to bool; compare instead, e.g. 'x != 0'", t.span)
        }
        const { args, close } = this.parseArgs(t.text)
        if (args.length !== 1) {
          throw new ParseError(`cast ${t.text}(...) takes exactly one argument, got ${args.length}`, spanFrom(t.span, close.span))
        }
        return { kind: 'Cast', to: t.text as ValueType, operand: args[0], span: spanFrom(t.span, close.span) }
      }
      case 'ident':
      case 'builtin': {
        this.next()
        if (this.at('(')) {
          const { args, close } = this.parseArgs(t.text)
          return { kind: 'Call', callee: t.text, calleeSpan: t.span, args, span: spanFrom(t.span, close.span) }
        }
        return { kind: 'Ident', name: t.text, span: t.span }
      }
      case 'keyword': {
        if (t.text === 'mem' || t.text === 'mem8' || t.text === 'memf') {
          this.next()
          this.expect('[', `after '${t.text}' (memory access looks like ${t.text}[index])`)
          const index = this.parseExpr()
          const close = this.expect(']', `to close ${t.text}[...]`)
          return { kind: 'Index', view: t.text as MemView, index, span: spanFrom(t.span, close.span) }
        }
        throw new ParseError(`expected an expression, found keyword '${t.text}'`, t.span)
      }
      case 'punct': {
        if (t.text === '(') {
          this.next()
          const inner = this.parseExpr()
          this.expect(')', 'to close parenthesized expression')
          return inner
        }
        throw new ParseError(`expected an expression, found ${describe(t)}`, t.span)
      }
      case 'op':
        throw new ParseError(`expected an expression, found operator '${t.text}'`, t.span)
      case 'error':
        throw new ParseError(`unexpected character '${t.text}'`, t.span)
      case 'eof':
        throw new ParseError('expected an expression, found end of input', t.span)
    }
  }
}

export function parse(tokens: Token[]): ParseResult {
  const p = new Parser(tokens)
  const program = p.parseProgram()
  return { program, errors: p.errors }
}
