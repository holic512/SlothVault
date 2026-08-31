import sharp from 'sharp'
import { describe, expect, it } from 'vitest'

import {
  createSystemFaviconIco,
  FAVICON_SIZES,
  inspectIcoBuffer,
  validateSystemFaviconIco,
} from '@/server/services/system-favicon'

function icoWithOneEntry() {
  const directorySize = 22
  const payload = Buffer.from([0x89, 0x50, 0x4e, 0x47])
  const ico = Buffer.alloc(directorySize + payload.length)
  ico.writeUInt16LE(0, 0)
  ico.writeUInt16LE(1, 2)
  ico.writeUInt16LE(1, 4)
  ico.writeUInt8(16, 6)
  ico.writeUInt8(16, 7)
  ico.writeUInt16LE(1, 10)
  ico.writeUInt16LE(32, 12)
  ico.writeUInt32LE(payload.length, 14)
  ico.writeUInt32LE(directorySize, 18)
  payload.copy(ico, directorySize)
  return ico
}

describe('system favicon processing', () => {
  it('accepts a structurally valid ICO directory', () => {
    const ico = icoWithOneEntry()
    expect(inspectIcoBuffer(ico)).toEqual([{
      width: 16,
      height: 16,
      bytesInResource: 4,
      imageOffset: 22,
    }])
    expect(() => validateSystemFaviconIco(ico, 'favicon.ico')).not.toThrow()
  })

  it('rejects an invalid header, truncated directory, and out-of-bounds image data', () => {
    expect(() => validateSystemFaviconIco(Buffer.from('not an ico'), 'favicon.ico'))
      .toThrow('Invalid favicon ICO file: favicon.ico')

    const truncated = Buffer.alloc(6)
    truncated.writeUInt16LE(1, 2)
    truncated.writeUInt16LE(2, 4)
    expect(() => validateSystemFaviconIco(truncated, 'favicon.ico'))
      .toThrow('Invalid favicon ICO file: favicon.ico')

    const outOfBounds = icoWithOneEntry()
    outOfBounds.writeUInt32LE(999, 18)
    expect(() => validateSystemFaviconIco(outOfBounds, 'favicon.ico'))
      .toThrow('Invalid favicon ICO file: favicon.ico')
  })

  it('generates a transparent multi-resolution ICO from a logo image', async () => {
    const logo = await sharp({
      create: { width: 220, height: 80, channels: 4, background: '#2f7dd1' },
    }).png().toBuffer()

    const ico = await createSystemFaviconIco(logo)
    const entries = inspectIcoBuffer(ico)

    expect(entries.map((entry) => entry.width)).toEqual(FAVICON_SIZES)
    expect(entries.map((entry) => entry.height)).toEqual(FAVICON_SIZES)
    for (const entry of entries) {
      expect(ico.subarray(entry.imageOffset, entry.imageOffset + 8)).toEqual(
        Buffer.from([0x89, 0x50, 0x4e, 0x47, 0x0d, 0x0a, 0x1a, 0x0a]),
      )
    }
  })
})
