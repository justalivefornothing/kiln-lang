import { describe, expect, it } from 'vitest'
import { compile, compileOrThrow } from './compile'
import { createHost, runModule } from './host'

async function instantiate(src: string, imports: WebAssembly.Imports = { env: {} }) {
  const bytes = compileOrThrow(src)
  expect(WebAssembly.validate(bytes)).toBe(true)
  const { instance } = await WebAssembly.instantiate(bytes, imports)
  return instance.exports as Record<string, (...args: number[]) => number>
}

describe('end to end: emitted modules run in Node', () => {
  it('recursive fib', async () => {
    const { fib } = await instantiate(`
      export fn fib(n: i32) -> i32 {
        if n < 2 { return n; }
        return fib(n - 1) + fib(n - 2);
      }`)
    expect(fib(10)).toBe(55)
    expect(fib(20)).toBe(6765)
  })

  it('gcd with a while loop, remainder and mutable params', async () => {
    const { gcd } = await instantiate(`
      export fn gcd(a: i32, b: i32) -> i32 {
        while b != 0 { let t = b; b = a % b; a = t; }
        return a;
      }`)
    expect(gcd(48, 18)).toBe(6)
    expect(gcd(1071, 462)).toBe(21)
  })

  it('while loop summing 1..100 and break at the right count', async () => {
    const ex = await instantiate(`
      export fn sum() -> i32 {
        var total = 0;
        var i = 1;
        while i <= 100 { total += i; i += 1; }
        return total;
      }
      export fn breakAt(limit: i32) -> i32 {
        var i = 0;
        while true {
          if i == limit { break; }
          i += 1;
        }
        return i;
      }
      export fn nested() -> i32 {
        // break must only leave the inner loop; continue skips odd numbers
        var count = 0;
        var i = 0;
        while i < 10 {
          i += 1;
          if i % 2 == 1 { continue; }
          var j = 0;
          while true {
            j += 1;
            if j == 3 { break; }
          }
          count += j;
        }
        return count;
      }`)
    expect(ex.sum()).toBe(5050)
    expect(ex.breakAt(17)).toBe(17)
    expect(ex.breakAt(0)).toBe(0)
    expect(ex.nested()).toBe(15) // five even iterations x 3
  })

  it('f32 arithmetic: area of a circle', async () => {
    const { area } = await instantiate(`
      export fn area(r: f32) -> f32 {
        let pi = 3.1415;
        return pi * r * r;
      }`)
    expect(Math.abs(area(2) - 12.566)).toBeLessThan(1e-4)
  })

  it('casts, comparisons, booleans and short-circuit evaluation', async () => {
    const calls: number[] = []
    const ex = await instantiate(
      `
      export fn trunc(x: f32) -> i32 { return i32(x); }
      export fn half(x: i32) -> f32 { return f32(x) / 2.0; }
      export fn cmp(a: i32, b: i32) -> i32 {
        var r = 0;
        if a < b { r += 1; }
        if a <= b { r += 2; }
        if a == b { r += 4; }
        if a != b { r += 8; }
        if a > b { r += 16; }
        if a >= b { r += 32; }
        return r;
      }
      export fn shortAnd(a: bool) -> bool { return a && touch(1) != 0; }
      export fn shortOr(a: bool) -> bool { return a || touch(2) != 0; }
      fn touch(tag: i32) -> i32 { print(tag); return tag; }
      export fn neg(x: i32, y: f32) -> f32 { return f32(-x) + -y; }
      export fn logic(a: bool, b: bool) -> i32 { if !a && b { return 1; } return 0; }
    `,
      { env: { print: (v: number) => calls.push(v) } },
    )
    expect(ex.trunc(3.99)).toBe(3)
    expect(ex.trunc(-3.99)).toBe(-3)
    expect(ex.half(5)).toBeCloseTo(2.5)
    expect(ex.cmp(1, 2)).toBe(1 + 2 + 8)
    expect(ex.cmp(2, 2)).toBe(2 + 4 + 32)
    expect(ex.cmp(3, 2)).toBe(8 + 16 + 32)
    expect(ex.shortAnd(0)).toBe(0)
    expect(calls).toEqual([]) // right side not evaluated
    expect(ex.shortAnd(1)).toBe(1)
    expect(calls).toEqual([1])
    expect(ex.shortOr(1)).toBe(1)
    expect(calls).toEqual([1]) // still not evaluated
    expect(ex.shortOr(0)).toBe(1)
    expect(calls).toEqual([1, 2])
    expect(ex.neg(3, 0.5)).toBeCloseTo(-3.5)
    expect(ex.logic(0, 1)).toBe(1)
    expect(ex.logic(1, 1)).toBe(0)
  })

  it('reads and writes linear memory through mem, mem8 and memf views', async () => {
    const bytes = compileOrThrow(`
      export fn fill() -> i32 {
        mem[0] = 0x12345678;
        mem8[4] = 200;
        memf[2] = 1.5;
        mem[3] += 5;
        return mem[0] + mem8[4] + i32(memf[2] * 2.0) + mem[3];
      }`)
    const { instance } = await WebAssembly.instantiate(bytes, { env: {} })
    const fill = instance.exports.fill as () => number
    expect(fill()).toBe(0x12345678 + 200 + 3 + 5)
    const memory = instance.exports.memory as WebAssembly.Memory
    expect(memory.buffer.byteLength).toBe(65536)
    const view = new DataView(memory.buffer)
    expect(view.getInt32(0, true)).toBe(0x12345678)
    expect(view.getUint8(4)).toBe(200)
    expect(view.getFloat32(8, true)).toBe(1.5)
    expect(view.getInt32(12, true)).toBe(5)
  })

  it('surfaces traps through the host runner', async () => {
    const bytes = compileOrThrow(`export fn main() { let z = 0; print(10 / z); }`)
    const host = createHost()
    const res = await runModule(bytes, host)
    expect(res.ok).toBe(false)
    expect(res.trapped).toBe(true)
    expect(res.error).toMatch(/divide by zero/i)

    const oob = compileOrThrow(`export fn main() { mem[100000] = 1; }`)
    const r2 = await runModule(oob, createHost())
    expect(r2.error).toMatch(/out of bounds/i)

    const missing = await runModule(compileOrThrow('fn helper() {}'), createHost())
    expect(missing.ok).toBe(false)
    expect(missing.error).toMatch(/nothing to run/)
  })

  it('host: print, printf, setpixel and rand', async () => {
    const lines: string[] = []
    const host = createHost({ onPrint: (s) => lines.push(s), seed: 7 })
    const bytes = compileOrThrow(`
      export fn main() {
        print(42);
        printf(2.5);
        printf(3.0);
        setpixel(1, 2, 10, 20, 30);
        setpixel(999, 2, 10, 20, 30); // clipped, still counted
        let r = rand();
        if r >= 0.0 && r < 1.0 { print(1); } else { print(0); }
      }`)
    const res = await runModule(bytes, host)
    expect(res.ok).toBe(true)
    expect(lines).toEqual(['42', '2.5', '3.0', '1'])
    expect(host.pixelWrites).toBe(2)
    const i = (2 * 256 + 1) * 4
    expect([...host.pixels.subarray(i, i + 4)]).toEqual([10, 20, 30, 255])
  })

  it('reports timing and stages for a successful compile', () => {
    const r = compile('export fn main() {}')
    expect(r.ok).toBe(true)
    expect(r.stages.map((s) => s.ok)).toEqual([true, true, true, true, true])
    expect(r.stages.every((s) => s.ms >= 0)).toBe(true)
    expect(r.wat).toContain('(module')
    const failed = compile('export fn main() { let x: i32 = 1.5; }')
    expect(failed.ok).toBe(false)
    expect(failed.stages.map((s) => s.ok)).toEqual([true, true, true, false, null])
    expect(failed.bytes).toBeNull()
    expect(failed.diagnostics[0].span.line).toBe(1)
  })
})
