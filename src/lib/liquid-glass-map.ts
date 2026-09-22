/**
 * @file liquid-glass-map.ts
 * @project SlothVault
 * @module Liquid Glass Refraction Map
 * @description Builds bounded RGBA displacement maps for rounded liquid-glass surfaces.
 * @logic Measure a rounded lens in CSS pixels, bend the backdrop along its edge normals, and encode displacement within a bounded raster budget.
 * @dependencies none
 * @index_tags liquid-glass,canvas,svg,displacement-map,performance
 * @author holic512
 */

export type LiquidGlassQuality = 'auto' | 'low' | 'high'

export type LiquidGlassMapDimensions = {
  width: number
  height: number
  pixelRatio: number
}

export type LiquidGlassMap = LiquidGlassMapDimensions & {
  data: Uint8ClampedArray
  scale: number
}

export type CreateLiquidGlassMapOptions = {
  width: number
  height: number
  radius: number
  refraction: number
  quality: LiquidGlassQuality
  devicePixelRatio?: number
}

const QUALITY_PIXEL_BUDGET: Record<LiquidGlassQuality, number> = {
  low: 18_000,
  auto: 48_000,
  high: 96_000,
}

const QUALITY_PIXEL_RATIO: Record<LiquidGlassQuality, number> = {
  low: 0.75,
  auto: 1.25,
  high: 2,
}

const NEUTRAL_CHANNEL = 128
const MAX_REFRACTION = 32

function clamp(value: number, minimum: number, maximum: number) {
  return Math.min(Math.max(value, minimum), maximum)
}

function finiteOr(value: number, fallback: number) {
  return Number.isFinite(value) ? value : fallback
}

function smoothStep(from: number, to: number, value: number) {
  if (from === to) return value < from ? 0 : 1
  const normalized = clamp((value - from) / (to - from), 0, 1)
  return normalized * normalized * (3 - 2 * normalized)
}

function roundedRectSignedDistance(
  x: number,
  y: number,
  halfWidth: number,
  halfHeight: number,
  radius: number,
) {
  const qx = Math.abs(x) - halfWidth + radius
  const qy = Math.abs(y) - halfHeight + radius
  return Math.min(Math.max(qx, qy), 0) + Math.hypot(Math.max(qx, 0), Math.max(qy, 0)) - radius
}

function writeNeutralMap(data: Uint8ClampedArray) {
  for (let index = 0; index < data.length; index += 4) {
    data[index] = NEUTRAL_CHANNEL
    data[index + 1] = NEUTRAL_CHANNEL
    data[index + 2] = 0
    data[index + 3] = 255
  }
}

/**
 * Calculates a bounded raster size while preserving the source card's aspect ratio.
 */
export function getLiquidGlassMapDimensions(
  width: number,
  height: number,
  quality: LiquidGlassQuality,
  devicePixelRatio = 1,
): LiquidGlassMapDimensions {
  const safeWidth = Math.max(1, finiteOr(width, 1))
  const safeHeight = Math.max(1, finiteOr(height, 1))
  const safePixelRatio = clamp(finiteOr(devicePixelRatio, 1), 1, QUALITY_PIXEL_RATIO[quality])
  const requestedRatio = Math.min(safePixelRatio, QUALITY_PIXEL_RATIO[quality])
  const requestedArea = safeWidth * safeHeight * requestedRatio * requestedRatio
  const budgetRatio = Math.min(1, Math.sqrt(QUALITY_PIXEL_BUDGET[quality] / requestedArea))
  const requestedPixelRatio = requestedRatio * budgetRatio
  const pixelWidth = Math.max(1, Math.floor(safeWidth * requestedPixelRatio))
  const pixelHeight = Math.max(1, Math.floor(safeHeight * requestedPixelRatio))

  return {
    width: pixelWidth,
    height: pixelHeight,
    pixelRatio: Math.min(pixelWidth / safeWidth, pixelHeight / safeHeight),
  }
}

/**
 * Adapted from Shu Ding's SDF → canvas → SVG displacement pipeline.
 * https://github.com/shuding/liquid-glass (MIT; see THIRD_PARTY_NOTICES.md).
 * The reference's fixed UV lens is replaced with a CSS-pixel edge field so a
 * wide navigation bar and a square card have the same glass thickness.
 */
export function createLiquidGlassMap(options: CreateLiquidGlassMapOptions): LiquidGlassMap {
  const cssWidth = Math.max(1, finiteOr(options.width, 1))
  const cssHeight = Math.max(1, finiteOr(options.height, 1))
  const refraction = clamp(finiteOr(options.refraction, 0), 0, MAX_REFRACTION)
  const dimensions = getLiquidGlassMapDimensions(
    cssWidth, cssHeight, options.quality, options.devicePixelRatio,
  )
  const data = new Uint8ClampedArray(dimensions.width * dimensions.height * 4)
  writeNeutralMap(data)

  if (refraction === 0) return { ...dimensions, data, scale: 0 }

  const halfWidth = cssWidth / 2
  const halfHeight = cssHeight / 2
  const radius = clamp(finiteOr(options.radius, 0), 0, Math.min(halfWidth, halfHeight))
  const edgeWidth = Math.min(32, radius > 0 ? radius : 32, halfWidth, halfHeight)
  // smoothStep peaks at slope 1.5. A wider lens admits the navigation's
  // 8px refraction while keeping the sampling derivative >= 0.535
  // (magnification < 1.87), avoiding the earlier stretched background dots.
  // Ending the field before the corner's medial axis also avoids a seam.
  const strength = Math.min(refraction, edgeWidth * 0.31)
  // SVG offsets are scale * (channel / 255 - 0.5). Twice the peak
  // displacement encodes the full signed range without clipping either end.
  const scale = strength * 2

  for (let y = 0; y < dimensions.height; y += 1) {
    for (let x = 0; x < dimensions.width; x += 1) {
      const px = (x + 0.5) * cssWidth / dimensions.width - halfWidth
      const py = (y + 0.5) * cssHeight / dimensions.height - halfHeight
      const distance = roundedRectSignedDistance(px, py, halfWidth, halfHeight, radius)
      // Extend the field past the clip curve, avoiding a neutral-color seam
      // when the SVG image interpolates pixels at a rounded corner.
      if (distance < -edgeWidth) continue

      const qx = Math.abs(px) - halfWidth + radius
      const qy = Math.abs(py) - halfHeight + radius
      const nx = Math.max(qx, 0)
      const ny = Math.max(qy, 0)
      const normalLength = Math.hypot(nx, ny)
      const normalX = normalLength > 0 ? nx / normalLength : Number(qx > qy)
      const normalY = normalLength > 0 ? ny / normalLength : Number(qy >= qx)
      const bend = strength * (1 - smoothStep(0, edgeWidth, -distance))
      const offset = (y * dimensions.width + x) * 4
      data[offset] = Math.round((0.5 - Math.sign(px) * normalX * bend / scale) * 255)
      data[offset + 1] = Math.round((0.5 - Math.sign(py) * normalY * bend / scale) * 255)
    }
  }

  return { ...dimensions, data, scale }
}
