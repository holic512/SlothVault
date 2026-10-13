import { describe, expect, it } from 'vitest'

import { createLiquidGlassMap, getLiquidGlassMapDimensions } from '@/lib/liquid-glass-map'

describe('liquid glass displacement maps', () => {
  it('returns a neutral, SVG-safe map when refraction is disabled', () => {
    const map = createLiquidGlassMap({
      width: 320,
      height: 180,
      radius: 24,
      refraction: 0,
      quality: 'auto',
    })

    expect(map.scale).toBe(0)
    expect(map.data.length).toBe(map.width * map.height * 4)
    for (let index = 0; index < map.data.length; index += 4) {
      expect(map.data.slice(index, index + 4)).toEqual(new Uint8ClampedArray([128, 128, 0, 255]))
    }
  })

  it('keeps map dimensions and channels valid across rounded card shapes', () => {
    const cases = [
      { width: 280, height: 160, radius: 20 },
      { width: 160, height: 280, radius: 48 },
      { width: 540, height: 120, radius: 999 },
    ]

    for (const shape of cases) {
      const map = createLiquidGlassMap({
        ...shape,
        refraction: 14,
        quality: 'auto',
        devicePixelRatio: 2,
      })

      expect(map.data.length).toBe(map.width * map.height * 4)
      expect(map.scale).toBeGreaterThan(0)
      expect([...map.data].every(Number.isFinite)).toBe(true)
      expect([...map.data].every((value) => value >= 0 && value <= 255)).toBe(true)
    }
  })

  it('bends opposite edges inward and leaves the reading area neutral', () => {
    const map = createLiquidGlassMap({ width: 320, height: 80, radius: 24, refraction: 14, quality: 'high' })
    const channel = (x: number, y: number, axis: number) => map.data[(y * map.width + x) * 4 + axis]
    const midX = Math.floor(map.width / 2)
    const midY = Math.floor(map.height / 2)
    expect(channel(midX, 0, 1)).toBeGreaterThan(200)
    expect(channel(midX, map.height - 1, 1)).toBeLessThan(55)
    expect(channel(0, midY, 0)).toBeGreaterThan(200)
    expect(channel(map.width - 1, midY, 0)).toBeLessThan(55)
    expect(channel(midX, midY, 0)).toBe(128)
    expect(channel(midX, midY, 1)).toBe(128)
    expect(channel(0, midY, 0) + channel(map.width - 1, midY, 0)).toBe(255)
  })

  it('uses the actual corner radius instead of a fixed UV lens', () => {
    const options = { width: 320, height: 80, refraction: 14, quality: 'high' as const }
    const square = createLiquidGlassMap({ ...options, radius: 0 })
    const rounded = createLiquidGlassMap({ ...options, radius: 32 })
    // A square corner bends on one axis; a curved corner bends on both.
    expect(square.data.slice(0, 2)).not.toEqual(new Uint8ClampedArray([128, 128]))
    expect(rounded.data[0]).toBeGreaterThan(128)
    expect(rounded.data[1]).toBeGreaterThan(128)
    expect(rounded.data).not.toEqual(square.data)
  })

  it('keeps the optical strength in CSS pixels across sizes and quality levels', () => {
    for (const width of [320, 1180]) {
      for (const quality of ['low', 'auto', 'high'] as const) {
        const map = createLiquidGlassMap({ width, height: 58, radius: 29, refraction: 8, quality })
        const top = (Math.floor(map.width / 2) * 4) + 1
        const displacement = map.scale * (map.data[top] / 255 - 0.5)
        expect(displacement).toBeGreaterThan(7.5)
        expect(displacement).toBeLessThanOrEqual(8)
      }
    }
    const weak = createLiquidGlassMap({ width: 320, height: 80, radius: 24, refraction: 4, quality: 'auto' })
    const strong = createLiquidGlassMap({ width: 320, height: 80, radius: 24, refraction: 14, quality: 'auto' })
    expect(strong.scale).toBeGreaterThan(weak.scale)
  })

  it('honors 8px refraction on both desktop and mobile navigation', () => {
    for (const shape of [{ width: 1180, height: 58 }, { width: 370, height: 52 }]) {
      const map = createLiquidGlassMap({ ...shape, radius: shape.height / 2, refraction: 8, quality: 'high' })
      // SVG scale spans both signed directions: 16 encodes -8px through +8px.
      expect(map.scale).toBe(16)
    }
  })

  it('slightly strengthens navigation and smaller card lenses without exceeding the curvature cap', () => {
    for (const shape of [
      { width: 1180, height: 58, radius: 29, peak: 9 },
      { width: 370, height: 52, radius: 26, peak: 8.84 },
      { width: 852, height: 223, radius: 20, peak: 6.8 },
      { width: 252, height: 300, radius: 18, peak: 6.12 },
    ]) {
      const map = createLiquidGlassMap({ ...shape, refraction: 9, quality: 'high' })
      expect(map.scale / 2).toBeCloseTo(shape.peak)
    }
  })

  it('raises fine sampling on retina surfaces while keeping each quality budget bounded', () => {
    const cases = [
      { quality: 'low' as const, budget: 18_000, ratio: 0.75 },
      { quality: 'auto' as const, budget: 72_000, ratio: 1.5 },
      { quality: 'high' as const, budget: 144_000, ratio: 2 },
    ]
    for (const { quality, budget, ratio } of cases) {
      const small = getLiquidGlassMapDimensions(120, 80, quality, 3)
      expect(small.pixelRatio).toBe(ratio)
      for (const [width, height] of [[1180, 58], [852, 223], [2000, 1000]]) {
        const map = getLiquidGlassMapDimensions(width, height, quality, 2)
        expect(map.width * map.height).toBeLessThanOrEqual(budget)
        expect(map.pixelRatio).toBeLessThanOrEqual(ratio)
        if (quality === 'auto') expect(map.width * map.height).toBeGreaterThan(48_000)
        if (quality === 'high') expect(map.width * map.height).toBeGreaterThan(96_000)
      }
    }
  })

  it('preserves symmetric rounded edges and a neutral center at fractional CSS sizes', () => {
    const map = createLiquidGlassMap({ width: 370.5, height: 52.25, radius: 26.125, refraction: 9, quality: 'high', devicePixelRatio: 2 })
    const channel = (x: number, y: number, axis: number) => map.data[(y * map.width + x) * 4 + axis]
    // One encoded step is the maximum permitted mirror error, including neutral 128.
    for (const [x, y] of [[0, 0], [8, 6], [20, 20]]) {
      expect(Math.abs(channel(x, y, 0) + channel(map.width - 1 - x, y, 0) - 255)).toBeLessThanOrEqual(1)
      expect(Math.abs(channel(x, y, 1) + channel(x, map.height - 1 - y, 1) - 255)).toBeLessThanOrEqual(1)
    }
    const x = Math.floor(map.width / 2), y = Math.floor(map.height / 2)
    // An even-height raster samples either side of the center; 127 and 128
    // both represent zero to within half an 8-bit encoding step.
    for (const axis of [0, 1]) {
      const offset = map.scale * (channel(x, y, axis) / 255 - 0.5)
      expect(Math.abs(offset)).toBeLessThanOrEqual(map.scale / 510 + 1e-12)
    }
  })

  it('limits magnification so small dots do not stretch into lines', () => {
    for (const radius of [12, 20, 29]) {
      const map = createLiquidGlassMap({ width: 320, height: 58, radius, refraction: 32, quality: 'high' })
      const midX = Math.floor(map.width / 2)
      let previous = -Infinity
      for (let y = 0; y < map.height; y += 1) {
        const displacement = map.scale * (map.data[(y * map.width + midX) * 4 + 1] / 255 - 0.5)
        const sampledY = (y + 0.5) * 58 / map.height + displacement
        // The analytic slope stays >= 0.49; allow for the map's 8-bit
        // channel quantization when checking the decoded sampling distance.
        expect(sampledY - previous).toBeGreaterThanOrEqual(0.45)
        previous = sampledY
      }
    }
  })

  it('caps automatic quality while retaining the card aspect ratio', () => {
    const dimensions = getLiquidGlassMapDimensions(2_000, 1_000, 'auto', 2)

    expect(dimensions.width * dimensions.height).toBeLessThanOrEqual(72_000)
    expect(dimensions.width / dimensions.height).toBeCloseTo(2, 1)
    expect(dimensions.pixelRatio).toBeLessThanOrEqual(1.5)
  })
})
