import { describe, expect, it } from 'vitest'
import { EXAMPLES, findExample } from '../examples/index'
import { compile, compileOrThrow } from './compile'
import { disassemble } from './disassembler'
import { emit } from './emitter'
import { createHost, runModule } from './host'
import { check } from './checker'
import { tokenize } from './lexer'
import { parse } from './parser'

const MAGIC_AND_VERSION = [0x00, 0x61, 0x73, 0x6d, 0x01, 0x00, 0x00, 0x00]

describe('bundled examples', () => {
  it('ships six examples with one-line descriptions', () => {
    expect(EXAMPLES).toHaveLength(6)
    expect(EXAMPLES.map((e) => e.id)).toEqual(['fib', 'primes', 'gcd', 'mandelbrot', 'sierpinski', 'plasma'])
    for (const e of EXAMPLES) {
      expect(e.description.length).toBeGreaterThan(10)
      expect(e.description).not.toContain('\n')
    }
  })

  it('every example starts with the magic header and validates', () => {
    for (const e of EXAMPLES) {
      const r = compile(e.source)
      expect(r.ok, `${e.id}: ${r.diagnostics.map((d) => d.message).join('; ')}`).toBe(true)
      const bytes = r.bytes!
      expect([...bytes.subarray(0, 8)]).toEqual(MAGIC_AND_VERSION)
      expect(WebAssembly.validate(bytes), `${e.id} should validate`).toBe(true)
    }
  })

  it('emits the sections in id order with sizes that match their content', () => {
    for (const e of EXAMPLES) {
      const r = compile(e.source)
      const names = r.sections.map((s) => s.name)
      expect(names).toEqual(['type', 'import', 'function', 'memory', 'export', 'code'])
      let pos = 8
      for (const s of r.sections) {
        expect(s.start).toBe(pos)
        pos = s.end
      }
      expect(pos).toBe(r.bytes!.length)
    }
    // a program with no host calls has no import section at all
    const bare = compile('export fn main() {}')
    expect(bare.sections.map((s) => s.name)).toEqual(['type', 'function', 'memory', 'export', 'code'])
  })

  it('disassembles fib with the expected instructions', () => {
    const r = compile(findExample('fib')!.source)
    const wat = r.wat!
    expect(wat).toContain('(func')
    expect(wat).toContain('(export "fib"')
    expect(wat).toContain('i32.lt_s')
    expect(wat).toContain('call')
    expect(wat).toContain('i32.add')
    expect(wat).toContain('(import "env" "print"')
    expect(wat).toContain('(memory')
  })

  it('round trip: disassembling the bytes yields the same instruction count as the emitter log', () => {
    for (const e of EXAMPLES) {
      const { tokens } = tokenize(e.source)
      const { program } = parse(tokens)
      const checked = check(program)
      const emitted = emit(checked)
      const dis = disassemble(emitted.bytes)
      expect(dis.instructionCount, e.id).toBe(emitted.instructions.length)
      // and the instruction text agrees byte-for-byte
      const emittedText = emitted.instructions.map((i) => i.text)
      const disText = dis.funcs.flatMap((f) => f.instructions.map((i) => i.text))
      expect(disText).toEqual(emittedText)
      const offsets = dis.funcs.flatMap((f) => f.instructions.map((i) => i.offset))
      expect(offsets).toEqual(emitted.instructions.map((i) => i.offset))
    }
  })

  it('mandelbrot calls setpixel exactly 65536 times with at least 1000 inside pixels', async () => {
    const bytes = compileOrThrow(findExample('mandelbrot')!.source)
    let calls = 0
    let inside = 0
    let outOfRange = 0
    const imports = {
      env: {
        setpixel: (x: number, y: number, r: number, g: number, b: number) => {
          calls++
          if (x < 0 || x >= 256 || y < 0 || y >= 256) outOfRange++
          if (r === 20 && g === 18 && b === 16) inside++
        },
      },
    }
    const { instance } = await WebAssembly.instantiate(bytes, imports)
    ;(instance.exports.main as () => void)()
    expect(calls).toBe(65536)
    expect(outOfRange).toBe(0)
    expect(inside).toBeGreaterThanOrEqual(1000)
    expect(inside).toBeLessThan(65536)
  })

  it('all examples run to completion through the host', async () => {
    for (const e of EXAMPLES) {
      const lines: string[] = []
      const host = createHost({ onPrint: (s) => lines.push(s), seed: 1 })
      const res = await runModule(compileOrThrow(e.source), host)
      expect(res.ok, `${e.id}: ${res.error}`).toBe(true)
      if (e.id === 'fib') expect(lines[20]).toBe('6765')
      if (e.id === 'primes') {
        expect(lines.slice(0, 5)).toEqual(['2', '3', '5', '7', '11'])
        expect(lines[lines.length - 1]).toBe('-46')
      }
      if (e.id === 'gcd') expect(lines).toEqual(['6', '21', '1', '256'])
      if (e.id === 'sierpinski' || e.id === 'plasma') expect(host.pixelWrites).toBeGreaterThan(50000)
    }
  })
})
