import { describe, expect, it } from 'vitest'
import { decodeF32, decodeS32, decodeU32, encodeF32, encodeS32, encodeU32 } from './leb128'

describe('LEB128', () => {
  it('encodes the canonical unsigned examples', () => {
    expect(encodeU32(624485)).toEqual([0xe5, 0x8e, 0x26])
    expect(encodeU32(0)).toEqual([0x00])
    expect(encodeU32(127)).toEqual([0x7f])
    expect(encodeU32(128)).toEqual([0x80, 0x01])
    expect(encodeU32(0xffffffff)).toEqual([0xff, 0xff, 0xff, 0xff, 0x0f])
  })

  it('encodes the canonical signed examples', () => {
    expect(encodeS32(-1)).toEqual([0x7f])
    expect(encodeS32(-123456)).toEqual([0xc0, 0xbb, 0x78])
    expect(encodeS32(0)).toEqual([0x00])
    expect(encodeS32(63)).toEqual([0x3f])
    expect(encodeS32(64)).toEqual([0xc0, 0x00]) // needs a second byte so the sign bit reads as positive
    expect(encodeS32(-64)).toEqual([0x40])
    expect(encodeS32(-65)).toEqual([0xbf, 0x7f])
    expect(encodeS32(2147483647)).toEqual([0xff, 0xff, 0xff, 0xff, 0x07])
    expect(encodeS32(-2147483648)).toEqual([0x80, 0x80, 0x80, 0x80, 0x78])
  })

  it('round-trips through the decoders', () => {
    for (const v of [0, 1, 127, 128, 300, 624485, 65535, 1 << 20, 0x7fffffff, 0xffffffff]) {
      const enc = encodeU32(v)
      expect(decodeU32(enc)).toEqual({ value: v, length: enc.length })
    }
    for (const v of [0, 1, -1, 63, 64, -64, -65, -123456, 123456, 0x7fffffff, -0x80000000]) {
      const enc = encodeS32(v)
      expect(decodeS32(enc)).toEqual({ value: v, length: enc.length })
    }
    expect(decodeU32([0x00, 0xe5, 0x8e, 0x26], 1)).toEqual({ value: 624485, length: 3 })
  })

  it('rejects out-of-range values', () => {
    expect(() => encodeU32(-1)).toThrow(RangeError)
    expect(() => encodeU32(2 ** 32)).toThrow(RangeError)
    expect(() => encodeS32(2 ** 31)).toThrow(RangeError)
    expect(() => decodeU32([0x80])).toThrow(RangeError)
  })

  it('encodes f32 little-endian', () => {
    expect(encodeF32(1)).toEqual([0x00, 0x00, 0x80, 0x3f])
    expect(encodeF32(-2.5)).toEqual([0x00, 0x00, 0x20, 0xc0])
    expect(decodeF32(encodeF32(3.14159))).toBeCloseTo(3.14159, 5)
  })
})
