import { describe, expect, it } from 'vitest'
import { check } from './checker'
import { tokenize } from './lexer'
import { parse } from './parser'
import type { Diagnostic } from './span'

function checkSource(src: string): Diagnostic[] {
  const { tokens } = tokenize(src)
  const { program, errors } = parse(tokens)
  expect(errors).toEqual([])
  return check(program).errors
}

describe('type checker', () => {
  it('rejects initializing an i32 with a float literal, pointing at the literal', () => {
    const src = 'fn main() {\n  let x: i32 = 1.5;\n}'
    const errors = checkSource(src)
    expect(errors).toHaveLength(1)
    expect(errors[0].message).toMatch(/cannot initialize 'x: i32' with a value of type f32/)
    expect(errors[0].span).toMatchObject({ line: 2, col: 16 })
    expect(src.slice(errors[0].span.start, errors[0].span.end)).toBe('1.5')
  })

  it('reports undefined identifiers at the exact line and column', () => {
    const src = 'fn main() {\n  let a = 1;\n  let b = a + missing;\n}'
    const errors = checkSource(src)
    expect(errors).toHaveLength(1)
    expect(errors[0].message).toBe("undefined variable 'missing'")
    expect(errors[0].span).toMatchObject({ line: 3, col: 15 })
  })

  it('has no implicit numeric conversion but accepts explicit casts', () => {
    expect(checkSource('fn f(a: i32, b: f32) -> f32 { return a + b; }')[0].message).toMatch(/same type, found i32 and f32 \(use an explicit cast/)
    expect(checkSource('fn f(a: i32, b: f32) -> f32 { return f32(a) + b; }')).toEqual([])
    expect(checkSource('fn f(a: i32, b: f32) -> i32 { return a + i32(b); }')).toEqual([])
    expect(checkSource('fn f(a: i32, b: f32) -> bool { return a < b; }')[0].message).toMatch(/cannot compare i32 with f32/)
  })

  it('checks declarations, duplicates and immutability', () => {
    const dup = checkSource('fn main() { let x = 1; let x = 2; }')
    expect(dup[0].message).toMatch(/duplicate declaration of 'x'/)
    expect(dup[0].span).toMatchObject({ line: 1, col: 28 })
    expect(checkSource('fn main() { let x = 1; x = 2; }')[0].message).toMatch(/immutable variable 'x'/)
    expect(checkSource('fn main() { var x = 1; x = 2; }')).toEqual([])
    expect(checkSource('fn main() { var x = 1; { let x = 2.0; } x = 3; }')).toEqual([]) // shadowing in inner scope is fine
    expect(checkSource('fn main(x: i32) { let x = 1; }')[0].message).toMatch(/already declared as a parameter/)
  })

  it('checks conditions, logical operators and unary operators', () => {
    expect(checkSource('fn main() { if 1 { } }')[0].message).toMatch(/if condition must be bool, found i32/)
    expect(checkSource('fn main() { while 2.0 { } }')[0].message).toMatch(/while condition must be bool/)
    expect(checkSource('fn main() { let b = 1 && true; }')[0].message).toMatch(/'&&' expects bool operands/)
    expect(checkSource('fn main() { let b = !3; }')[0].message).toMatch(/'!' expects a bool/)
    expect(checkSource('fn main() { let b = -true; }')[0].message).toMatch(/unary '-' expects a numeric/)
    expect(checkSource('fn main() { let r = 1.5 % 2.0; }')[0].message).toMatch(/'%' is only defined for i32/)
  })

  it('checks function calls: existence, arity and argument types', () => {
    expect(checkSource('fn main() { foo(); }')[0].message).toBe("undefined function 'foo'")
    expect(checkSource('fn f(a: i32) {} fn main() { f(1, 2); }')[0].message).toMatch(/expects 1 argument but got 2/)
    expect(checkSource('fn f(a: i32) {} fn main() { f(1.0); }')[0].message).toMatch(/argument 1 of 'f' must be i32, found f32/)
    expect(checkSource('fn main() { print(1.0); }')[0].message).toMatch(/must be i32/)
    expect(checkSource('fn main() { printf(1.0); setpixel(1, 2, 3, 4, 5); let r = rand(); clear(); }')).toEqual([])
    expect(checkSource('fn main() { let s = sqrt(4); }')[0].message).toMatch(/must be f32/)
  })

  it('verifies return paths', () => {
    expect(checkSource('fn f(a: i32) -> i32 { if a > 0 { return 1; } }')[0].message).toMatch(/must return a value of type i32 on every path/)
    expect(checkSource('fn f(a: i32) -> i32 { if a > 0 { return 1; } else { return 2; } }')).toEqual([])
    expect(checkSource('fn f(a: i32) -> i32 { while true { if a > 0 { return a; } a += 1; } }')).toEqual([])
    expect(checkSource('fn f(a: i32) -> i32 { while true { if a > 0 { break; } } }')[0].message).toMatch(/every path/)
    expect(checkSource('fn f() { return 1; }')[0].message).toMatch(/has no return type/)
    expect(checkSource('fn f() -> f32 { return 1; }')[0].message).toMatch(/returns f32, but this value has type i32/)
  })

  it('rejects break/continue outside loops and duplicate functions', () => {
    expect(checkSource('fn main() { break; }')[0].message).toMatch(/'break' outside of a loop/)
    expect(checkSource('fn main() { continue; }')[0].message).toMatch(/'continue' outside/)
    expect(checkSource('fn a() {} fn a() {}')[0].message).toMatch(/duplicate function 'a'/)
    // built-in names are reserved words, so redefining one is already a syntax error
    const { tokens } = tokenize('fn print() {}')
    expect(parse(tokens).errors[0].message).toMatch(/reserved word/)
  })

  it('types memory views and collects the imports a program uses', () => {
    const { tokens } = tokenize('fn main() { mem[0] = 1; memf[1] = 2.5; mem8[8] = 255; print(mem[0]); printf(memf[1]); }')
    const { program } = parse(tokens)
    const checked = check(program)
    expect(checked.errors).toEqual([])
    expect(checked.imports.map((i) => i.name)).toEqual(['print', 'printf'])
    expect(checked.funcs[0].index).toBe(2) // after the two imports
    expect(checkSource('fn main() { mem[1.0] = 1; }')[0].message).toMatch(/index must be i32/)
    expect(checkSource('fn main() { mem[0] = 1.0; }')[0].message).toMatch(/cannot assign a value of type f32 to a target of type i32/)
  })

  it('assigns local slots grouped by type after the parameters', () => {
    const { tokens } = tokenize('fn f(p: i32) { let a = 1; let b = 2.0; let c = 3; let d = 4.0; }')
    const { program } = parse(tokens)
    const checked = check(program)
    const slots = checked.funcs[0].locals.map((l) => [l.name, l.type, l.slot])
    expect(slots).toEqual([
      ['a', 'i32', 1],
      ['c', 'i32', 2],
      ['b', 'f32', 3],
      ['d', 'f32', 4],
    ])
  })
})
