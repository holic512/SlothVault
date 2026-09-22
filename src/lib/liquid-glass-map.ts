/**
 * @file liquid-glass-map.ts
 * @project SlothVault
 * @module Liquid Glass Refraction Map
 * @description Builds bounded RGBA displacement maps for rounded liquid-glass surfaces.
 * @logic Scale a card to a quality budget, combine its rounded edge distance field with a normalized pointer lens, and encode the resulting displacement into SVG-compatible channels.
 * @dependencies none
 * @index_tags liquid-glass,canvas,svg,displacement-map,performance
 * @author holic512
 */

export type LiquidGlassQuality = 'auto' | 'low' | 'high'

export type LiquidGlassPointer = {
  x: number
  y: number
}

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
  pointer: LiquidGlassPointer
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

function normalizedGradient(
  x: number,
  y: number,
  halfWidth: number,
  halfHeight: number,
  radius: number,
) {
  const epsilon = 0.5
  const xDelta = roundedRectSignedDistance(x + epsilon, y, halfWidth, halfHeight, radius)
    - roundedRectSignedDistance(x - epsilon, y, halfWidth, halfHeight, radius)
  const yDelta = roundedRectSignedDistance(x, y + epsilon, halfWidth, halfHeight, radius)
    - roundedRectSignedDistance(x, y - epsilon, halfWidth, halfHeight, radius)
  const length = Math.hypot(xDelta, yDelta)

  if (length < 0.0001) return { x: 0, y: 0 }

  return { x: xDelta / length, y: yDelta / length }
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
 * Encodes a rounded edge lens and pointer lens into an SVG displacement map.
 */
export function createLiquidGlassMap(options: CreateLiquidGlassMapOptions): LiquidGlassMap {
  const cssWidth = Math.max(1, finiteOr(options.width, 1))
  const cssHeight = Math.max(1, finiteOr(options.height, 1))
  const refraction = clamp(finiteOr(options.refraction, 0), 0, MAX_REFRACTION)
  const dimensions = getLiquidGlassMapDimensions(
    cssWidth,
    cssHeight,
    options.quality,
    options.devicePixelRatio,
  )
  const data = new Uint8ClampedArray(dimensions.width * dimensions.height * 4)

  if (refraction === 0) {
    writeNeutralMap(data)
    return { ...dimensions, data, scale: 1 }
  }

  const pointer = {
    x: clamp(finiteOr(options.pointer.x, 0.5), 0, 1),
    y: clamp(finiteOr(options.pointer.y, 0.5), 0, 1),
  }
  const maximumRadius = Math.min(cssWidth, cssHeight) / 2
  const radius = clamp(finiteOr(options.radius, 0), 0, maximumRadius)
  const halfWidth = cssWidth / 2
  const halfHeight = cssHeight / 2
  const pointerX = pointer.x * cssWidth
  const pointerY = pointer.y * cssHeight
  const pointerReach = Math.max(Math.min(cssWidth, cssHeight) * 0.58, 96)
  const edgeWidth = Math.max(Math.min(cssWidth, cssHeight) * 0.12, 12)
  const scale = refraction * 1.45

  for (let y = 0; y < dimensions.height; y += 1) {
    const cssY = ((y + 0.5) / dimensions.height) * cssHeight

    for (let x = 0; x < dimensions.width; x += 1) {
      const cssX = ((x + 0.5) / dimensions.width) * cssWidth
      const localX = cssX - halfWidth
      const localY = cssY - halfHeight
      const edgeDistance = -roundedRectSignedDistance(localX, localY, halfWidth, halfHeight, radius)
      const edgeInfluence = 1 - smoothStep(edgeWidth * 0.35, edgeWidth * 1.6, Math.max(edgeDistance, 0))
      const edgeNormal = normalizedGradient(localX, localY, halfWidth, halfHeight, radius)

      const pointerDeltaX = cssX - pointerX
      const pointerDeltaY = cssY - pointerY
      const pointerDistance = Math.hypot(pointerDeltaX, pointerDeltaY)
      const pointerInfluence = 1 - smoothStep(pointerReach * 0.15, pointerReach, pointerDistance)
      const pointerNormal = pointerDistance > 0.001
        ? { x: pointerDeltaX / pointerDistance, y: pointerDeltaY / pointerDistance }
        : { x: 0, y: 0 }

      const edgeStrength = refraction * edgeInfluence * (0.58 + pointerInfluence * 0.42)
      const pointerStrength = refraction * pointerInfluence * (1 - edgeInfluence * 0.4) * 0.32
      const displacementX = edgeNormal.x * edgeStrength + pointerNormal.x * pointerStrength
      const displacementY = edgeNormal.y * edgeStrength + pointerNormal.y * pointerStrength
      const index = (y * dimensions.width + x) * 4

      data[index] = Math.round(clamp(0.5 + displacementX / scale, 0, 1) * 255)
      data[index + 1] = Math.round(clamp(0.5 + displacementY / scale, 0, 1) * 255)
      data[index + 2] = 0
      data[index + 3] = 255
    }
  }

  return { ...dimensions, data, scale }
}
