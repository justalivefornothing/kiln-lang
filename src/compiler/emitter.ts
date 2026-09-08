import type { Block, Expr, Stmt, Type, ValueType } from './ast'
import type { CheckedProgram, FuncInfo, Signature } from './checker'
import { encodeF32, encodeS32, encodeU32, hexList } from './leb128'
import {
  BLOCKTYPE_EMPTY,
  EXTERNAL_KIND,
  FUNC_TYPE_TAG,
  OPCODES,
  SECTION,
  VALTYPE,
  type OpcodeInfo,
  type SectionName,
} from './opcodes'
import type { Span } from './span'

export type AnnotationKind =
  | 'magic'
  | 'version'
  | 'section-id'
  | 'section-size'
  | 'count'
  | 'leb'
  | 'byte'
  | 'string'
  | 'f32'
  | 'instr'
  | 'func-size'

export interface Annotation {
  /** Half-open byte range in the module. */
  start: number
  end: number
  kind: AnnotationKind
  section: SectionName | 'header'
  /** Short label, e.g. `i32.const 5` or `section size`. */
  label: string
  /** Longer explanation, e.g. the LEB128 decoding. */
  detail?: string
  /** Source range that produced these bytes (instructions only). */
  span?: Span
}

export interface InstrRecord {
  offset: number
  end: number
  opcode: number
  name: string
  /** WAT-style text of the instruction including immediates. */
  text: string
  funcIndex: number
  span?: Span
}

export interface SectionInfo {
  name: SectionName
  id: number
  start: number
  end: number
  /** Offset of the first byte after the size prefix. */
  bodyStart: number
}

export interface EmitResult {
  bytes: Uint8Array<ArrayBuffer>
  annotations: Annotation[]
  instructions: InstrRecord[]
  sections: SectionInfo[]
}

export const MODULE_MAGIC = [0x00, 0x61, 0x73, 0x6d]
export const MODULE_VERSION = [0x01, 0x00, 0x00, 0x00]
export const IMPORT_MODULE = 'env'
export const MEMORY_EXPORT = 'memory'
export const MEMORY_PAGES = 1

// ---- byte writer -----------------------------------------------------------

class Writer {
  bytes: number[] = []
  ann: Annotation[] = []
  instrs: InstrRecord[] = []
  section: SectionName | 'header' = 'header'

  get length(): number {
    return this.bytes.length
  }

  byte(b: number, label: string, kind: AnnotationKind = 'byte', detail?: string): void {
    const start = this.bytes.length
    this.bytes.push(b & 0xff)
    this.ann.push({ start, end: start + 1, kind, section: this.section, label, detail })
  }

  u32(value: number, label: string, kind: AnnotationKind = 'leb'): void {
    const enc = encodeU32(value)
    const start = this.bytes.length
    this.bytes.push(...enc)
    this.ann.push({
      start,
      end: start + enc.length,
      kind,
      section: this.section,
      label,
      detail: `unsigned LEB128 ${hexList(enc)} = ${value}`,
    })
  }

  s32(value: number, label: string): void {
    const enc = encodeS32(value)
    const start = this.bytes.length
    this.bytes.push(...enc)
    this.ann.push({
      start,
      end: start + enc.length,
      kind: 'leb',
      section: this.section,
      label,
      detail: `signed LEB128 ${hexList(enc)} = ${value}`,
    })
  }

  f32(value: number, label: string): void {
    const enc = encodeF32(value)
    const start = this.bytes.length
    this.bytes.push(...enc)
    this.ann.push({
      start,
      end: start + 4,
      kind: 'f32',
      section: this.section,
      label,
      detail: `IEEE-754 single, little-endian ${hexList(enc)} = ${Math.fround(value)}`,
    })
  }

  /** A UTF-8 name: length prefix followed by the bytes. */
  name(text: string, label: string): void {
    const utf8 = Array.from(new TextEncoder().encode(text))
    this.u32(utf8.length, `${label} length`, 'count')
    const start = this.bytes.length
    this.bytes.push(...utf8)
    this.ann.push({
      start,
      end: start + utf8.length,
      kind: 'string',
      section: this.section,
      label,
      detail: `utf-8 "${text}"`,
    })
  }

  /** Append another writer, shifting its annotation and instruction offsets. */
  append(other: Writer): void {
    const shift = this.bytes.length
    this.bytes.push(...other.bytes)
    for (const a of other.ann) this.ann.push({ ...a, start: a.start + shift, end: a.end + shift })
    for (const i of other.instrs) this.instrs.push({ ...i, offset: i.offset + shift, end: i.end + shift })
  }
}

function valtype(t: ValueType): number {
  return t === 'f32' ? VALTYPE.f32 : VALTYPE.i32
}

function valtypeName(t: Type): string {
  return t === 'f32' ? 'f32' : 'i32'
}

function sigKey(sig: Signature): string {
  return `${sig.params.map(valtypeName).join(',')}->${sig.ret === 'void' ? '' : valtypeName(sig.ret)}`
}

// ---- function body emitter ---------------------------------------------------

type CallResolver = (target: { kind: string; name: string }) => number

interface Control {
  kind: 'block' | 'loop' | 'if'
  breakTarget: boolean
  continueTarget: boolean
}

class FnEmitter {
  readonly w = new Writer()
  private controls: Control[] = []
  private readonly funcIndex: number
  private readonly resolve: CallResolver

  constructor(funcIndex: number, resolve: CallResolver) {
    this.funcIndex = funcIndex
    this.resolve = resolve
    this.w.section = 'code'
  }

  // ---- instruction helpers ------------------------------------------------

  private op(info: OpcodeInfo, span?: Span, immediate?: (w: Writer) => string): void {
    const start = this.w.length
    this.w.byte(info.code, info.name, 'byte', `opcode 0x${info.code.toString(16).padStart(2, '0')} ${info.name}`)
    const immText = immediate ? immediate(this.w) : ''
    const text = immText ? `${info.name} ${immText}` : info.name
    const end = this.w.length
    this.w.ann.push({ start, end, kind: 'instr', section: 'code', label: text, span })
    this.w.instrs.push({ offset: start, end, opcode: info.code, name: info.name, text, funcIndex: this.funcIndex, span })
  }

  private simple(info: OpcodeInfo, span?: Span): void {
    this.op(info, span)
  }

  private i32Const(v: number, span?: Span): void {
    this.op(OPCODES.i32_const, span, (w) => {
      w.s32(v, 'i32 immediate')
      return String(v)
    })
  }

  private f32Const(v: number, span?: Span): void {
    this.op(OPCODES.f32_const, span, (w) => {
      w.f32(v, 'f32 immediate')
      return formatF32(v)
    })
  }

  private local(info: OpcodeInfo, slot: number, span?: Span): void {
    this.op(info, span, (w) => {
      w.u32(slot, 'local index')
      return String(slot)
    })
  }

  private call(index: number, name: string, span?: Span): void {
    this.op(OPCODES.call, span, (w) => {
      w.u32(index, `function index (${name})`)
      return String(index)
    })
  }

  private branch(info: OpcodeInfo, depth: number, span?: Span): void {
    this.op(info, span, (w) => {
      w.u32(depth, 'label depth')
      return String(depth)
    })
  }

  private structured(info: OpcodeInfo, result: Type, control: Control, span?: Span): void {
    this.op(info, span, (w) => {
      if (result === 'void') {
        w.byte(BLOCKTYPE_EMPTY, 'block type (empty)', 'byte', 'block type 0x40 = no result')
        return ''
      }
      w.byte(valtype(result as ValueType), `block type (${valtypeName(result)})`, 'byte', `block type: result ${valtypeName(result)}`)
      return `(result ${valtypeName(result)})`
    })
    this.controls.push(control)
  }

  private end(span?: Span): void {
    this.controls.pop()
    this.simple(OPCODES.end, span)
  }

  private memory(info: OpcodeInfo, align: number, span?: Span): void {
    this.op(info, span, (w) => {
      w.u32(align, 'memarg align (log2)')
      w.u32(0, 'memarg offset')
      return `offset=0 align=${1 << align}`
    })
  }

  // ---- body ------------------------------------------------------------------

  emitBody(fn: FuncInfo): void {
    const body = fn.decl.body
    this.emitBlock(body)
    const last = body.stmts[body.stmts.length - 1]
    if (fn.sig.ret !== 'void' && !(last && last.kind === 'Return')) {
      // The checker proved every path returns, so this point is unreachable; tell the validator.
      this.simple(OPCODES.unreachable, { ...body.span, start: body.span.end - 1 })
    }
    this.simple(OPCODES.end, { ...body.span, start: body.span.end - 1 })
  }

  private emitBlock(block: Block): void {
    for (const s of block.stmts) this.emitStmt(s)
  }

  private emitStmt(s: Stmt): void {
    switch (s.kind) {
      case 'Let':
        this.emitExpr(s.init)
        this.local(OPCODES.local_set, s.slot!, s.span)
        return
      case 'Assign': {
        if (s.target.kind === 'Ident') {
          const slot = s.target.slot!
          if (s.op === '=') {
            this.emitExpr(s.value)
          } else {
            this.local(OPCODES.local_get, slot, s.target.span)
            this.emitExpr(s.value)
            this.arith(s.op.slice(0, 1), s.target.type as ValueType, s.span)
          }
          this.local(OPCODES.local_set, slot, s.span)
        } else {
          const view = s.target.view
          this.emitAddress(s.target)
          if (s.op === '=') {
            this.emitExpr(s.value)
          } else {
            this.emitAddress(s.target)
            this.emitLoad(view, s.target.span)
            this.emitExpr(s.value)
            this.arith(s.op.slice(0, 1), s.target.type as ValueType, s.span)
          }
          if (view === 'mem') this.memory(OPCODES.i32_store, 2, s.span)
          else if (view === 'memf') this.memory(OPCODES.f32_store, 2, s.span)
          else this.memory(OPCODES.i32_store8, 0, s.span)
        }
        return
      }
      case 'If': {
        this.emitExpr(s.cond)
        this.structured(OPCODES.if, 'void', { kind: 'if', breakTarget: false, continueTarget: false }, s.cond.span)
        this.emitBlock(s.then)
        if (s.else) {
          this.simple(OPCODES.else, s.else.span)
          if (s.else.kind === 'If') this.emitStmt(s.else)
          else this.emitBlock(s.else)
        }
        this.end(s.span)
        return
      }
      case 'While': {
        // block $exit          ; break target
        //   loop $again        ; continue target
        //     <cond> i32.eqz br_if $exit
        //     <body>
        //     br $again
        //   end
        // end
        this.structured(OPCODES.block, 'void', { kind: 'block', breakTarget: true, continueTarget: false }, s.span)
        this.structured(OPCODES.loop, 'void', { kind: 'loop', breakTarget: false, continueTarget: true }, s.span)
        this.emitExpr(s.cond)
        this.simple(OPCODES.i32_eqz, s.cond.span)
        this.branch(OPCODES.br_if, this.depthTo('break'), s.cond.span)
        this.emitBlock(s.body)
        this.branch(OPCODES.br, this.depthTo('continue'), s.span)
        this.end(s.span)
        this.end(s.span)
        return
      }
      case 'Break':
        this.branch(OPCODES.br, this.depthTo('break'), s.span)
        return
      case 'Continue':
        this.branch(OPCODES.br, this.depthTo('continue'), s.span)
        return
      case 'Return':
        if (s.value) this.emitExpr(s.value)
        this.simple(OPCODES.return, s.span)
        return
      case 'ExprStmt':
        this.emitExpr(s.expr)
        if (s.expr.type !== 'void') this.simple(OPCODES.drop, s.span)
        return
      case 'Block':
        this.emitBlock(s)
        return
    }
  }

  /** Relative label depth of the innermost enclosing break/continue target. */
  private depthTo(kind: 'break' | 'continue'): number {
    for (let i = this.controls.length - 1; i >= 0; i--) {
      const c = this.controls[i]
      if ((kind === 'break' && c.breakTarget) || (kind === 'continue' && c.continueTarget)) {
        return this.controls.length - 1 - i
      }
    }
    throw new Error(`internal: no enclosing loop for ${kind}`)
  }

  private arith(op: string, type: ValueType, span?: Span): void {
    const f = type === 'f32'
    switch (op) {
      case '+':
        return this.simple(f ? OPCODES.f32_add : OPCODES.i32_add, span)
      case '-':
        return this.simple(f ? OPCODES.f32_sub : OPCODES.i32_sub, span)
      case '*':
        return this.simple(f ? OPCODES.f32_mul : OPCODES.i32_mul, span)
      case '/':
        return this.simple(f ? OPCODES.f32_div : OPCODES.i32_div_s, span)
      case '%':
        return this.simple(OPCODES.i32_rem_s, span)
    }
    throw new Error(`internal: unknown arithmetic operator ${op}`)
  }

  private compare(op: string, type: ValueType, span?: Span): void {
    const f = type === 'f32'
    switch (op) {
      case '==':
        return this.simple(f ? OPCODES.f32_eq : OPCODES.i32_eq, span)
      case '!=':
        return this.simple(f ? OPCODES.f32_ne : OPCODES.i32_ne, span)
      case '<':
        return this.simple(f ? OPCODES.f32_lt : OPCODES.i32_lt_s, span)
      case '>':
        return this.simple(f ? OPCODES.f32_gt : OPCODES.i32_gt_s, span)
      case '<=':
        return this.simple(f ? OPCODES.f32_le : OPCODES.i32_le_s, span)
      case '>=':
        return this.simple(f ? OPCODES.f32_ge : OPCODES.i32_ge_s, span)
    }
    throw new Error(`internal: unknown comparison ${op}`)
  }

  /** Push the byte address of a memory view element: word views scale the index by 4. */
  private emitAddress(e: Extract<Expr, { kind: 'Index' }>): void {
    this.emitExpr(e.index)
    if (e.view !== 'mem8') {
      this.i32Const(2, e.index.span)
      this.simple(OPCODES.i32_shl, e.index.span)
    }
  }

  private emitLoad(view: Extract<Expr, { kind: 'Index' }>['view'], span: Span): void {
    if (view === 'mem') this.memory(OPCODES.i32_load, 2, span)
    else if (view === 'memf') this.memory(OPCODES.f32_load, 2, span)
    else this.memory(OPCODES.i32_load8_u, 0, span)
  }

  private emitExpr(e: Expr): void {
    switch (e.kind) {
      case 'Int':
        return this.i32Const(e.value, e.span)
      case 'Float':
        return this.f32Const(e.value, e.span)
      case 'Bool':
        return this.i32Const(e.value ? 1 : 0, e.span)
      case 'Ident':
        return this.local(OPCODES.local_get, e.slot!, e.span)
      case 'Unary': {
        if (e.op === '!') {
          this.emitExpr(e.operand)
          return this.simple(OPCODES.i32_eqz, e.span)
        }
        // negative literals fold into the constant
        if (e.operand.kind === 'Int') return this.i32Const(-e.operand.value | 0, e.span)
        if (e.operand.kind === 'Float') return this.f32Const(-e.operand.value, e.span)
        if (e.type === 'f32') {
          this.emitExpr(e.operand)
          return this.simple(OPCODES.f32_neg, e.span)
        }
        this.i32Const(0, e.span)
        this.emitExpr(e.operand)
        return this.simple(OPCODES.i32_sub, e.span)
      }
      case 'Binary': {
        if (e.op === '&&') {
          // a && b  =>  a; if (result i32) b else 0 end
          this.emitExpr(e.left)
          this.structured(OPCODES.if, 'i32', { kind: 'if', breakTarget: false, continueTarget: false }, e.span)
          this.emitExpr(e.right)
          this.simple(OPCODES.else, e.span)
          this.i32Const(0, e.span)
          return this.end(e.span)
        }
        if (e.op === '||') {
          this.emitExpr(e.left)
          this.structured(OPCODES.if, 'i32', { kind: 'if', breakTarget: false, continueTarget: false }, e.span)
          this.i32Const(1, e.span)
          this.simple(OPCODES.else, e.span)
          this.emitExpr(e.right)
          return this.end(e.span)
        }
        this.emitExpr(e.left)
        this.emitExpr(e.right)
        const operandType = (e.left.type ?? 'i32') as ValueType
        if (['==', '!=', '<', '>', '<=', '>='].includes(e.op)) return this.compare(e.op, operandType, e.span)
        return this.arith(e.op, operandType, e.span)
      }
      case 'Call': {
        for (const a of e.args) this.emitExpr(a)
        const target = e.target!
        if (target.kind === 'intrinsic') {
          switch (target.name) {
            case 'sqrt':
              return this.simple(OPCODES.f32_sqrt, e.span)
            case 'floor':
              return this.simple(OPCODES.f32_floor, e.span)
            case 'abs':
              return this.simple(OPCODES.f32_abs, e.span)
            case 'min':
              return this.simple(OPCODES.f32_min, e.span)
            case 'max':
              return this.simple(OPCODES.f32_max, e.span)
          }
          throw new Error(`internal: unknown intrinsic ${target.name}`)
        }
        return this.call(this.resolve(target), target.name, e.span)
      }
      case 'Cast': {
        this.emitExpr(e.operand)
        const from = e.operand.type
        if (e.to === 'i32' && from === 'f32') return this.simple(OPCODES.i32_trunc_f32_s, e.span)
        if (e.to === 'f32' && from === 'i32') return this.simple(OPCODES.f32_convert_i32_s, e.span)
        return // i32 <-> bool and identity casts are free: bool is already an i32
      }
      case 'Index':
        this.emitAddress(e)
        return this.emitLoad(e.view, e.span)
    }
  }
}

export function formatF32(v: number): string {
  if (Number.isInteger(v)) return v.toFixed(1)
  return String(Math.fround(v))
}

// ---- module emitter ----------------------------------------------------------

/**
 * Emit a complete WebAssembly module from a checked program:
 *   magic + version, then Type(1) Import(2) Function(3) Memory(5) Export(7) Code(10).
 * Sections are built into separate writers and glued in with their size prefix.
 */
export function emit(checked: CheckedProgram): EmitResult {
  if (!checked.ok) throw new Error('emit called on a program with type errors')
  const { funcs, imports } = checked

  // function type deduplication
  const typeKeys: string[] = []
  const typeSigs: Signature[] = []
  const typeIndexOf = (sig: Signature): number => {
    const key = sigKey(sig)
    let idx = typeKeys.indexOf(key)
    if (idx < 0) {
      idx = typeKeys.length
      typeKeys.push(key)
      typeSigs.push(sig)
    }
    return idx
  }
  for (const imp of imports) typeIndexOf(imp.sig)
  for (const fn of funcs) typeIndexOf(fn.sig)

  const resolveCall = (target: { kind: string; name: string }): number => {
    if (target.kind === 'user') return funcs.find((f) => f.name === target.name)!.index
    return imports.find((i) => i.name === target.name)!.index
  }

  const module = new Writer()
  module.section = 'header'
  for (const b of MODULE_MAGIC) module.byte(b, 'magic', 'magic', 'magic number "\\0asm"')
  for (const b of MODULE_VERSION) module.byte(b, 'version', 'version', 'binary format version 1 (little-endian u32)')

  const sections: SectionInfo[] = []
  const addSection = (name: SectionName, body: Writer): void => {
    const id = SECTION[name]
    const start = module.length
    module.section = name
    module.byte(id, `section id ${id} (${name})`, 'section-id', `section id ${id} = ${name} section`)
    module.u32(body.length, 'section size', 'section-size')
    const bodyStart = module.length
    module.append(body)
    sections.push({ name, id, start, end: module.length, bodyStart })
  }

  // -- Type section (1): vector of func types 0x60 [params] [results]
  const typeSec = new Writer()
  typeSec.section = 'type'
  typeSec.u32(typeSigs.length, 'type count', 'count')
  typeSigs.forEach((sig, i) => {
    typeSec.byte(FUNC_TYPE_TAG, `type ${i}: func`, 'byte', '0x60 = function type')
    typeSec.u32(sig.params.length, 'param count', 'count')
    for (const p of sig.params) typeSec.byte(valtype(p), `param ${p}`, 'byte', `value type ${p}`)
    if (sig.ret === 'void') {
      typeSec.u32(0, 'result count', 'count')
    } else {
      typeSec.u32(1, 'result count', 'count')
      typeSec.byte(valtype(sig.ret), `result ${sig.ret}`, 'byte', `value type ${valtypeName(sig.ret)}`)
    }
  })
  addSection('type', typeSec)

  // -- Import section (2): only host functions the program uses
  if (imports.length > 0) {
    const importSec = new Writer()
    importSec.section = 'import'
    importSec.u32(imports.length, 'import count', 'count')
    for (const imp of imports) {
      importSec.name(IMPORT_MODULE, 'module name')
      importSec.name(imp.name, 'field name')
      importSec.byte(EXTERNAL_KIND.func, 'import kind: func', 'byte', 'external kind 0x00 = function')
      importSec.u32(typeIndexOf(imp.sig), `type index for ${imp.name}`)
    }
    addSection('import', importSec)
  }

  // -- Function section (3): type index of each defined function
  const funcSec = new Writer()
  funcSec.section = 'function'
  funcSec.u32(funcs.length, 'function count', 'count')
  for (const fn of funcs) funcSec.u32(typeIndexOf(fn.sig), `type index for ${fn.name}`)
  addSection('function', funcSec)

  // -- Memory section (5): one memory, min 1 page, no max
  const memSec = new Writer()
  memSec.section = 'memory'
  memSec.u32(1, 'memory count', 'count')
  memSec.byte(0x00, 'limits: min only', 'byte', 'limits flag 0x00 = minimum only, no maximum')
  memSec.u32(MEMORY_PAGES, 'min pages (64 KiB each)')
  addSection('memory', memSec)

  // -- Export section (7): memory + every `export fn`
  const exported = funcs.filter((f) => f.decl.exported)
  const exportSec = new Writer()
  exportSec.section = 'export'
  exportSec.u32(exported.length + 1, 'export count', 'count')
  exportSec.name(MEMORY_EXPORT, 'export name')
  exportSec.byte(EXTERNAL_KIND.memory, 'export kind: memory', 'byte', 'external kind 0x02 = memory')
  exportSec.u32(0, 'memory index')
  for (const fn of exported) {
    exportSec.name(fn.name, 'export name')
    exportSec.byte(EXTERNAL_KIND.func, 'export kind: func', 'byte', 'external kind 0x00 = function')
    exportSec.u32(fn.index, `function index (${fn.name})`)
  }
  addSection('export', exportSec)

  // -- Code section (10): one size-prefixed body per function
  const codeSec = new Writer()
  codeSec.section = 'code'
  codeSec.u32(funcs.length, 'function body count', 'count')
  for (const fn of funcs) {
    const body = new Writer()
    body.section = 'code'
    // locals as run-length groups of identical types
    const runs: { type: ValueType; count: number }[] = []
    for (const l of fn.locals) {
      const last = runs[runs.length - 1]
      if (last && last.type === l.type) last.count++
      else runs.push({ type: l.type, count: 1 })
    }
    body.u32(runs.length, `${fn.name}: local group count`, 'count')
    for (const r of runs) {
      body.u32(r.count, `${r.count} x ${r.type}`)
      body.byte(valtype(r.type), `local type ${r.type}`, 'byte', `value type ${r.type}`)
    }
    const fe = new FnEmitter(fn.index, resolveCall)
    fe.emitBody(fn)
    body.append(fe.w)
    codeSec.u32(body.length, `${fn.name}: body size`, 'func-size')
    codeSec.append(body)
  }
  addSection('code', codeSec)

  return {
    bytes: Uint8Array.from(module.bytes),
    annotations: module.ann,
    instructions: module.instrs,
    sections,
  }
}
