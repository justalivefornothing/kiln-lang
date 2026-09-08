/** Kinds of immediate operands an instruction carries after its opcode byte. */
export type ImmediateKind = 'none' | 'blocktype' | 'label' | 'local' | 'func' | 'memarg' | 'i32' | 'f32'

export interface OpcodeInfo {
  code: number
  name: string
  imm: ImmediateKind
}

/** The subset of the WebAssembly MVP instruction set the Kiln compiler emits. */
export const OPCODES = {
  unreachable: { code: 0x00, name: 'unreachable', imm: 'none' },
  nop: { code: 0x01, name: 'nop', imm: 'none' },
  block: { code: 0x02, name: 'block', imm: 'blocktype' },
  loop: { code: 0x03, name: 'loop', imm: 'blocktype' },
  if: { code: 0x04, name: 'if', imm: 'blocktype' },
  else: { code: 0x05, name: 'else', imm: 'none' },
  end: { code: 0x0b, name: 'end', imm: 'none' },
  br: { code: 0x0c, name: 'br', imm: 'label' },
  br_if: { code: 0x0d, name: 'br_if', imm: 'label' },
  return: { code: 0x0f, name: 'return', imm: 'none' },
  call: { code: 0x10, name: 'call', imm: 'func' },
  drop: { code: 0x1a, name: 'drop', imm: 'none' },
  select: { code: 0x1b, name: 'select', imm: 'none' },
  local_get: { code: 0x20, name: 'local.get', imm: 'local' },
  local_set: { code: 0x21, name: 'local.set', imm: 'local' },
  local_tee: { code: 0x22, name: 'local.tee', imm: 'local' },
  i32_load: { code: 0x28, name: 'i32.load', imm: 'memarg' },
  f32_load: { code: 0x2a, name: 'f32.load', imm: 'memarg' },
  i32_load8_u: { code: 0x2d, name: 'i32.load8_u', imm: 'memarg' },
  i32_store: { code: 0x36, name: 'i32.store', imm: 'memarg' },
  f32_store: { code: 0x38, name: 'f32.store', imm: 'memarg' },
  i32_store8: { code: 0x3a, name: 'i32.store8', imm: 'memarg' },
  i32_const: { code: 0x41, name: 'i32.const', imm: 'i32' },
  f32_const: { code: 0x43, name: 'f32.const', imm: 'f32' },
  i32_eqz: { code: 0x45, name: 'i32.eqz', imm: 'none' },
  i32_eq: { code: 0x46, name: 'i32.eq', imm: 'none' },
  i32_ne: { code: 0x47, name: 'i32.ne', imm: 'none' },
  i32_lt_s: { code: 0x48, name: 'i32.lt_s', imm: 'none' },
  i32_gt_s: { code: 0x4a, name: 'i32.gt_s', imm: 'none' },
  i32_le_s: { code: 0x4c, name: 'i32.le_s', imm: 'none' },
  i32_ge_s: { code: 0x4e, name: 'i32.ge_s', imm: 'none' },
  f32_eq: { code: 0x5b, name: 'f32.eq', imm: 'none' },
  f32_ne: { code: 0x5c, name: 'f32.ne', imm: 'none' },
  f32_lt: { code: 0x5d, name: 'f32.lt', imm: 'none' },
  f32_gt: { code: 0x5e, name: 'f32.gt', imm: 'none' },
  f32_le: { code: 0x5f, name: 'f32.le', imm: 'none' },
  f32_ge: { code: 0x60, name: 'f32.ge', imm: 'none' },
  i32_add: { code: 0x6a, name: 'i32.add', imm: 'none' },
  i32_sub: { code: 0x6b, name: 'i32.sub', imm: 'none' },
  i32_mul: { code: 0x6c, name: 'i32.mul', imm: 'none' },
  i32_div_s: { code: 0x6d, name: 'i32.div_s', imm: 'none' },
  i32_rem_s: { code: 0x6f, name: 'i32.rem_s', imm: 'none' },
  i32_and: { code: 0x71, name: 'i32.and', imm: 'none' },
  i32_or: { code: 0x72, name: 'i32.or', imm: 'none' },
  i32_xor: { code: 0x73, name: 'i32.xor', imm: 'none' },
  i32_shl: { code: 0x74, name: 'i32.shl', imm: 'none' },
  f32_abs: { code: 0x8b, name: 'f32.abs', imm: 'none' },
  f32_neg: { code: 0x8c, name: 'f32.neg', imm: 'none' },
  f32_floor: { code: 0x8e, name: 'f32.floor', imm: 'none' },
  f32_sqrt: { code: 0x91, name: 'f32.sqrt', imm: 'none' },
  f32_add: { code: 0x92, name: 'f32.add', imm: 'none' },
  f32_sub: { code: 0x93, name: 'f32.sub', imm: 'none' },
  f32_mul: { code: 0x94, name: 'f32.mul', imm: 'none' },
  f32_div: { code: 0x95, name: 'f32.div', imm: 'none' },
  f32_min: { code: 0x96, name: 'f32.min', imm: 'none' },
  f32_max: { code: 0x97, name: 'f32.max', imm: 'none' },
  i32_trunc_f32_s: { code: 0xa8, name: 'i32.trunc_f32_s', imm: 'none' },
  f32_convert_i32_s: { code: 0xb2, name: 'f32.convert_i32_s', imm: 'none' },
} as const satisfies Record<string, OpcodeInfo>

export type OpcodeName = keyof typeof OPCODES

/** Reverse lookup: opcode byte -> info. Used by the disassembler and the hex inspector. */
export const OPCODE_BY_BYTE: ReadonlyMap<number, OpcodeInfo> = new Map(Object.values(OPCODES).map((o) => [o.code, o]))

// Value types and block types
export const VALTYPE = { i32: 0x7f, f32: 0x7d } as const
export const BLOCKTYPE_EMPTY = 0x40
export const FUNC_TYPE_TAG = 0x60

export const VALTYPE_NAMES: Record<number, string> = { 0x7f: 'i32', 0x7e: 'i64', 0x7d: 'f32', 0x7c: 'f64' }

// Section ids
export const SECTION = {
  custom: 0,
  type: 1,
  import: 2,
  function: 3,
  table: 4,
  memory: 5,
  global: 6,
  export: 7,
  start: 8,
  element: 9,
  code: 10,
  data: 11,
} as const

export type SectionName = keyof typeof SECTION

export const SECTION_NAMES: Record<number, SectionName> = Object.fromEntries(
  Object.entries(SECTION).map(([k, v]) => [v, k as SectionName]),
) as Record<number, SectionName>

// External kinds (import/export descriptors)
export const EXTERNAL_KIND = { func: 0x00, table: 0x01, memory: 0x02, global: 0x03 } as const
