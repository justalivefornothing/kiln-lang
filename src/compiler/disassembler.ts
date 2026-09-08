import { decodeF32, decodeS32, decodeU32 } from './leb128'
import { BLOCKTYPE_EMPTY, FUNC_TYPE_TAG, OPCODE_BY_BYTE, SECTION, VALTYPE_NAMES } from './opcodes'
import { formatF32 } from './emitter'

export interface WatInstr {
  offset: number
  opcode: number
  text: string
  /** Nesting depth used for indentation. */
  depth: number
}

export interface DisassembledFunc {
  index: number
  typeIndex: number
  locals: string[]
  instructions: WatInstr[]
  bodyStart: number
  bodyEnd: number
}

export interface DisassembledType {
  params: string[]
  results: string[]
}

export interface Disassembly {
  text: string
  types: DisassembledType[]
  imports: { module: string; name: string; typeIndex: number }[]
  funcs: DisassembledFunc[]
  exports: { name: string; kind: string; index: number }[]
  memories: { min: number; max: number | null }[]
  /** Total number of instructions across all function bodies (each opcode counts once, including `end`/`else`). */
  instructionCount: number
}

class Reader {
  pos = 0
  readonly bytes: Uint8Array

  constructor(bytes: Uint8Array) {
    this.bytes = bytes
  }

  get eof(): boolean {
    return this.pos >= this.bytes.length
  }

  u8(): number {
    if (this.pos >= this.bytes.length) throw new Error(`unexpected end of module at offset ${this.pos}`)
    return this.bytes[this.pos++]
  }

  u32(): number {
    const d = decodeU32(this.bytes, this.pos)
    this.pos += d.length
    return d.value
  }

  s32(): number {
    const d = decodeS32(this.bytes, this.pos)
    this.pos += d.length
    return d.value
  }

  f32(): number {
    const v = decodeF32(this.bytes, this.pos)
    this.pos += 4
    return v
  }

  name(): string {
    const len = this.u32()
    const slice = this.bytes.subarray(this.pos, this.pos + len)
    this.pos += len
    return new TextDecoder().decode(slice)
  }

  valtype(): string {
    const b = this.u8()
    const name = VALTYPE_NAMES[b]
    if (!name) throw new Error(`unknown value type 0x${b.toString(16)} at offset ${this.pos - 1}`)
    return name
  }
}

const EXTERNAL_KIND_NAMES: Record<number, string> = { 0: 'func', 1: 'table', 2: 'memory', 3: 'global' }

/**
 * Parse a binary module and print it as WebAssembly text. This deliberately
 * works from the bytes alone (never from the AST) so that it independently
 * verifies what the emitter produced.
 */
export function disassemble(bytes: Uint8Array): Disassembly {
  const r = new Reader(bytes)
  const magic = [r.u8(), r.u8(), r.u8(), r.u8()]
  if (magic[0] !== 0x00 || magic[1] !== 0x61 || magic[2] !== 0x73 || magic[3] !== 0x6d) {
    throw new Error('not a WebAssembly module: bad magic number')
  }
  const version = r.u8() | (r.u8() << 8) | (r.u8() << 16) | (r.u8() << 24)
  if (version !== 1) throw new Error(`unsupported binary version ${version}`)

  const types: DisassembledType[] = []
  const imports: Disassembly['imports'] = []
  const funcTypeIndices: number[] = []
  const memories: Disassembly['memories'] = []
  const exports: Disassembly['exports'] = []
  const bodies: { start: number; end: number }[] = []

  while (!r.eof) {
    const id = r.u8()
    const size = r.u32()
    const end = r.pos + size
    switch (id) {
      case SECTION.type: {
        const count = r.u32()
        for (let i = 0; i < count; i++) {
          const tag = r.u8()
          if (tag !== FUNC_TYPE_TAG) throw new Error(`expected func type tag 0x60, got 0x${tag.toString(16)}`)
          const params: string[] = []
          const np = r.u32()
          for (let k = 0; k < np; k++) params.push(r.valtype())
          const results: string[] = []
          const nr = r.u32()
          for (let k = 0; k < nr; k++) results.push(r.valtype())
          types.push({ params, results })
        }
        break
      }
      case SECTION.import: {
        const count = r.u32()
        for (let i = 0; i < count; i++) {
          const module = r.name()
          const name = r.name()
          const kind = r.u8()
          if (kind !== 0) throw new Error(`only function imports are supported (kind ${kind})`)
          imports.push({ module, name, typeIndex: r.u32() })
        }
        break
      }
      case SECTION.function: {
        const count = r.u32()
        for (let i = 0; i < count; i++) funcTypeIndices.push(r.u32())
        break
      }
      case SECTION.memory: {
        const count = r.u32()
        for (let i = 0; i < count; i++) {
          const flags = r.u8()
          const min = r.u32()
          const max = flags & 1 ? r.u32() : null
          memories.push({ min, max })
        }
        break
      }
      case SECTION.export: {
        const count = r.u32()
        for (let i = 0; i < count; i++) {
          const name = r.name()
          const kind = r.u8()
          exports.push({ name, kind: EXTERNAL_KIND_NAMES[kind] ?? `kind${kind}`, index: r.u32() })
        }
        break
      }
      case SECTION.code: {
        const count = r.u32()
        for (let i = 0; i < count; i++) {
          const bodySize = r.u32()
          bodies.push({ start: r.pos, end: r.pos + bodySize })
          r.pos += bodySize
        }
        break
      }
      default:
        // sections Kiln never emits are skipped rather than rejected
        r.pos = end
    }
    if (r.pos !== end) throw new Error(`section ${id} size mismatch: ended at ${r.pos}, expected ${end}`)
  }

  const funcs: DisassembledFunc[] = bodies.map((b, i) => decodeBody(bytes, b.start, b.end, imports.length + i, funcTypeIndices[i]))
  const instructionCount = funcs.reduce((n, f) => n + f.instructions.length, 0)

  // ---- print --------------------------------------------------------------
  const lines: string[] = ['(module']
  types.forEach((t, i) => {
    const params = t.params.length ? ` (param ${t.params.join(' ')})` : ''
    const results = t.results.length ? ` (result ${t.results.join(' ')})` : ''
    lines.push(`  (type $t${i} (func${params}${results}))`)
  })
  imports.forEach((imp, i) => {
    lines.push(`  (import "${imp.module}" "${imp.name}" (func $${imp.name} (;${i};) (type $t${imp.typeIndex})))`)
  })
  memories.forEach((m, i) => {
    lines.push(`  (memory $m${i} ${m.min}${m.max !== null ? ' ' + m.max : ''})`)
  })
  const exportName = (f: DisassembledFunc): string => {
    const e = exports.find((x) => x.kind === 'func' && x.index === f.index)
    return e ? ` (export "${e.name}")` : ''
  }
  for (const f of funcs) {
    const t = types[f.typeIndex] ?? { params: [], results: [] }
    const params = t.params.length ? ` (param ${t.params.join(' ')})` : ''
    const results = t.results.length ? ` (result ${t.results.join(' ')})` : ''
    lines.push(`  (func $f${f.index}${exportName(f)} (type $t${f.typeIndex})${params}${results}`)
    if (f.locals.length) lines.push(`    (local ${f.locals.join(' ')})`)
    f.instructions.forEach((ins, i) => {
      // the body's final `end` is implied by the closing paren in text format
      if (i === f.instructions.length - 1 && ins.opcode === 0x0b) return
      lines.push('    ' + '  '.repeat(ins.depth) + ins.text)
    })
    lines.push('  )')
  }
  for (const e of exports) {
    if (e.kind === 'memory') lines.push(`  (export "${e.name}" (memory ${e.index}))`)
  }
  lines.push(')')

  return { text: lines.join('\n'), types, imports, funcs, exports, memories, instructionCount }
}

function blockTypeText(b: number): string {
  if (b === BLOCKTYPE_EMPTY) return ''
  const name = VALTYPE_NAMES[b]
  if (!name) throw new Error(`unknown block type 0x${b.toString(16)}`)
  return ` (result ${name})`
}

function decodeBody(bytes: Uint8Array, start: number, end: number, index: number, typeIndex: number): DisassembledFunc {
  const r = new Reader(bytes)
  r.pos = start
  const locals: string[] = []
  const groups = r.u32()
  for (let g = 0; g < groups; g++) {
    const count = r.u32()
    const type = r.valtype()
    for (let k = 0; k < count; k++) locals.push(type)
  }
  const instructions: WatInstr[] = []
  let depth = 0
  while (r.pos < end) {
    const offset = r.pos
    const opcode = r.u8()
    const info = OPCODE_BY_BYTE.get(opcode)
    if (!info) throw new Error(`unknown opcode 0x${opcode.toString(16).padStart(2, '0')} at offset ${offset}`)
    let text = info.name
    let lineDepth = depth
    switch (info.imm) {
      case 'none':
        break
      case 'blocktype':
        text += blockTypeText(r.u8())
        break
      case 'label':
      case 'local':
      case 'func':
        text += ` ${r.u32()}`
        break
      case 'memarg': {
        const align = r.u32()
        const off = r.u32()
        text += ` offset=${off} align=${1 << align}`
        break
      }
      case 'i32':
        text += ` ${r.s32()}`
        break
      case 'f32':
        text += ` ${formatF32(r.f32())}`
        break
    }
    // structured control: indent contents, dedent at else/end
    if (info.name === 'block' || info.name === 'loop' || info.name === 'if') {
      depth++
    } else if (info.name === 'else') {
      lineDepth = depth - 1
    } else if (info.name === 'end') {
      depth = Math.max(0, depth - 1)
      lineDepth = depth
    }
    instructions.push({ offset, opcode, text, depth: Math.max(0, lineDepth) })
  }
  if (r.pos !== end) throw new Error(`function ${index}: body overran its declared size`)
  return { index, typeIndex, locals, instructions, bodyStart: start, bodyEnd: end }
}
