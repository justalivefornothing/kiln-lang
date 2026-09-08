import { describe, expect, it } from 'vitest'
import type { BinaryExpr, Expr, IfStmt, LetStmt, UnaryExpr } from './ast'
import { tokenize } from './lexer'
import { parse } from './parser'

function parseSource(src: string) {
  const { tokens } = tokenize(src)
  return parse(tokens)
}

function firstInit(src: string): Expr {
  const { program, errors } = parseSource(`fn main() { let x = ${src}; }`)
  expect(errors).toEqual([])
  const stmt = program.fns[0].body.stmts[0] as LetStmt
  return stmt.init
}

describe('parser', () => {
  it('nests multiplication under addition (precedence)', () => {
    const e = firstInit('1 + 2 * 3') as BinaryExpr
    expect(e.kind).toBe('Binary')
    expect(e.op).toBe('+')
    expect(e.left).toMatchObject({ kind: 'Int', value: 1 })
    expect(e.right).toMatchObject({ kind: 'Binary', op: '*' })
    const mul = e.right as BinaryExpr
    expect(mul.left).toMatchObject({ kind: 'Int', value: 2 })
    expect(mul.right).toMatchObject({ kind: 'Int', value: 3 })
  })

  it('is left associative and honours parentheses', () => {
    const sub = firstInit('10 - 3 - 2') as BinaryExpr
    expect(sub.left).toMatchObject({ kind: 'Binary', op: '-' })
    expect(sub.right).toMatchObject({ kind: 'Int', value: 2 })
    const paren = firstInit('(1 + 2) * 3') as BinaryExpr
    expect(paren.op).toBe('*')
    expect(paren.left).toMatchObject({ kind: 'Binary', op: '+' })
  })

  it('orders comparison, logical and unary operators correctly', () => {
    // a < b && !c || d  =>  ((a < b) && (!c)) || d
    const e = firstInit('a < b && !c || d') as BinaryExpr
    expect(e.op).toBe('||')
    const and = e.left as BinaryExpr
    expect(and.op).toBe('&&')
    expect(and.left).toMatchObject({ kind: 'Binary', op: '<' })
    expect(and.right).toMatchObject({ kind: 'Unary', op: '!' })
    // -x * y  =>  (-x) * y
    const neg = firstInit('-x * y') as BinaryExpr
    expect(neg.op).toBe('*')
    expect((neg.left as UnaryExpr).op).toBe('-')
  })

  it('parses casts, calls, memory views and spans', () => {
    const src = 'fn main() {\n  let v = f32(mem[i + 1]) * rand();\n}'
    const { program, errors } = parseSource(src)
    expect(errors).toEqual([])
    const init = (program.fns[0].body.stmts[0] as LetStmt).init as BinaryExpr
    expect(init.left).toMatchObject({ kind: 'Cast', to: 'f32' })
    expect(init.right).toMatchObject({ kind: 'Call', callee: 'rand', args: [] })
    const cast = init.left as Extract<Expr, { kind: 'Cast' }>
    expect(cast.operand).toMatchObject({ kind: 'Index', view: 'mem' })
    // spans point at the real source text
    expect(src.slice(init.span.start, init.span.end)).toBe('f32(mem[i + 1]) * rand()')
    expect(init.span).toMatchObject({ line: 2, col: 11 })
  })

  it('parses functions, params, return types, if/else chains and loops', () => {
    const { program, errors } = parseSource(`
      export fn f(a: i32, b: f32) -> bool {
        var i = 0;
        while i < 10 {
          if i == 3 { continue; } else if i == 7 { break; } else { i += 1; }
        }
        return a > 0;
      }
      fn g() { }
    `)
    expect(errors).toEqual([])
    expect(program.fns).toHaveLength(2)
    const f = program.fns[0]
    expect(f.exported).toBe(true)
    expect(f.params.map((p) => [p.name, p.type])).toEqual([
      ['a', 'i32'],
      ['b', 'f32'],
    ])
    expect(f.ret).toBe('bool')
    const loop = f.body.stmts[1]
    expect(loop.kind).toBe('While')
    if (loop.kind !== 'While') throw new Error()
    const ifs = loop.body.stmts[0] as IfStmt
    expect(ifs.then.stmts[0].kind).toBe('Continue')
    expect(ifs.else?.kind).toBe('If')
    expect(program.fns[1].ret).toBe('void')
  })

  it('reports syntax errors with position and an expected-token message', () => {
    const { errors } = parseSource('fn main() {\n  let x = 1\n  let y = 2;\n}')
    expect(errors.length).toBeGreaterThanOrEqual(1)
    expect(errors[0].message).toMatch(/expected ';'/)
    expect(errors[0].message).toContain("found 'let'")
    expect(errors[0].span).toMatchObject({ line: 3, col: 3 })
  })

  it('recovers and reports multiple independent errors', () => {
    const { errors } = parseSource('fn main() {\n  let = 1;\n  var y = 2;\n  y = ;\n}')
    expect(errors.length).toBe(2)
    expect(errors[0].span.line).toBe(2)
    expect(errors[1].span.line).toBe(4)
    expect(errors[0].message).toMatch(/expected identifier/)
    expect(errors[1].message).toMatch(/expected an expression/)
  })

  it('rejects assignment to a non-lvalue and nested fn declarations', () => {
    expect(parseSource('fn main() { 1 + 2 = 3; }').errors[0].message).toMatch(/cannot assign/)
    expect(parseSource('fn main() { fn inner() {} }').errors[0].message).toMatch(/top level/)
  })
})
