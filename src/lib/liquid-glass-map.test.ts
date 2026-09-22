import { describe, expect, it } from 'vitest'

import { createLiquidGlassMap, getLiquidGlassMapDimensions } from '@/lib/liquid-glass-map'

describe('liquid glass displacement maps', () => {
  it('returns a neutral, SVG-safe map when refraction is disabled', () => {
    const map = createLiquidGlassMap({
      width: 320,
      height: 180,
      radius: 24,
      refraction: 0,
      pointer: { x: 0.5, y: 0.5 },
      quality: 'auto',
    })

    expect(map.scale).toBe(1)
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
        pointer: { x: 0.72, y: 0.21 },
        quality: 'auto',
        devicePixelRatio: 2,
      })

      expect(map.data.length).toBe(map.width * map.height * 4)
      expect(map.scale).toBeGreaterThan(0)
      expect([...map.data].every(Number.isFinite)).toBe(true)
      expect([...map.data].every((value) => value >= 0 && value <= 255)).toBe(true)
    }
  })

  it('changes the local lens when the normalized pointer changes', () => {
    const base = {
      width: 320,
      height: 200,
      radius: 24,
      refraction: 14,
      quality: 'high' as const,
    }
    const nearStart = createLiquidGlassMap({ ...base, pointer: { x: 0.18, y: 0.26 } })
    const nearEnd = createLiquidGlassMap({ ...base, pointer: { x: 0.82, y: 0.74 } })

    expect(nearStart.data).not.toEqual(nearEnd.data)
  })

  it('caps automatic quality while retaining the card aspect ratio', () => {
    const dimensions = getLiquidGlassMapDimensions(2_000, 1_000, 'auto', 2)

    expect(dimensions.width * dimensions.height).toBeLessThanOrEqual(48_000)
    expect(dimensions.width / dimensions.height).toBeCloseTo(2, 1)
    expect(dimensions.pixelRatio).toBeLessThanOrEqual(1.25)
  })
})
