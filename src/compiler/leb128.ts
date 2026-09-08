/**
 * LEB128 variable-length integer encoding as used throughout the WebAssembly
 * binary format. Each output byte carries 7 payload bits; the high bit is a
 * continuation flag (1 = more bytes follow).
 */

/** Unsigned LEB128 (varuint32). */
export function encodeU32(value: number): number[] {
  if (value < 0 || value > 0xffffffff || !Number.isInteger(value)) {
    throw new RangeError(`encodeU32: ${value} is not a u32`)
  }
  const out: number[] = []
  let v = value
  do {
    let byte = v & 0x7f
    v = Math.floor(v / 128) // >>> 7 would break for values above 2^31 when combined with signed ops
    if (v !== 0) byte |= 0x80
    out.push(byte)
  } while (v !== 0)
  return out
}

/**
 * Signed LEB128 (varint32). The loop stops once the remaining value is all
 * sign bits *and* the sign bit of the last emitted byte agrees with it.
 */
export function encodeS32(value: number): number[] {
  if (!Number.isInteger(value) || value < -0x80000000 || value > 0x7fffffff) {
    throw new RangeError(`encodeS32: ${value} is not an s32`)
  }
  const out: number[] = []
  let v = value | 0
  for (;;) {
    const byte = v & 0x7f
    v >>= 7 // arithmetic shift keeps the sign
    const signBitSet = (byte & 0x40) !== 0
    const done = (v === 0 && !signBitSet) || (v === -1 && signBitSet)
    if (done) {
      out.push(byte)
      return out
    }
    out.push(byte | 0x80)
  }
}

/** Little-endian IEEE-754 single precision. */
export function encodeF32(value: number): number[] {
  const buf = new ArrayBuffer(4)
  new DataView(buf).setFloat32(0, value, true)
  return [...new Uint8Array(buf)]
}

export interface Decoded {
  value: number
  /** Number of bytes consumed. */
  length: number
}

export function decodeU32(bytes: ArrayLike<number>, offset = 0): Decoded {
  let result = 0
  let shift = 0
  let i = offset
  for (;;) {
    if (i >= bytes.length) throw new RangeError('decodeU32: unexpected end of bytes')
    const byte = bytes[i++]
    result += (byte & 0x7f) * 2 ** shift
    shift += 7
    if ((byte & 0x80) === 0) break
    if (shift > 35) throw new RangeError('decodeU32: value too large')
  }
  return { value: result, length: i - offset }
}

export function decodeS32(bytes: ArrayLike<number>, offset = 0): Decoded {
  let result = 0
  let shift = 0
  let i = offset
  let byte = 0
  for (;;) {
    if (i >= bytes.length) throw new RangeError('decodeS32: unexpected end of bytes')
    byte = bytes[i++]
    result |= (byte & 0x7f) << shift
    shift += 7
    if ((byte & 0x80) === 0) break
    if (shift > 35) throw new RangeError('decodeS32: value too large')
  }
  if (shift < 32 && (byte & 0x40) !== 0) result |= -1 << shift
  return { value: result | 0, length: i - offset }
}

export function decodeF32(bytes: ArrayLike<number>, offset = 0): number {
  const buf = new ArrayBuffer(4)
  const u8 = new Uint8Array(buf)
  for (let k = 0; k < 4; k++) u8[k] = bytes[offset + k]
  return new DataView(buf).getFloat32(0, true)
}

export function hex(byte: number): string {
  return byte.toString(16).padStart(2, '0').toUpperCase()
}

export function hexList(bytes: ArrayLike<number>): string {
  return Array.from(bytes, hex).join(' ')
}
