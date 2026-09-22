'use client'

/**
 * @file liquid-glass-card.tsx
 * @project SlothVault
 * @module Liquid Glass Card
 * @description Provides a standalone, accessible content container with bounded SVG-backed background refraction.
 * @logic Render one semantic-neutral content surface, build an instance-scoped displacement filter from measured bounds, and update the lens only while pointer motion is meaningful.
 * @dependencies React, liquid-glass-map, liquid-glass-card.module.css
 * @index_tags component,liquid-glass,card,canvas,svg,accessibility
 * @author holic512
 */

import {
  useCallback,
  useEffect,
  useId,
  useMemo,
  useRef,
  useState,
  type ComponentPropsWithoutRef,
  type CSSProperties,
  type PointerEvent,
  type ReactNode,
} from 'react'

import { createLiquidGlassMap, type LiquidGlassQuality } from '@/lib/liquid-glass-map'
import styles from '@/styles/modules/liquid-glass-card.module.css'

export type { LiquidGlassQuality } from '@/lib/liquid-glass-map'

export type LiquidGlassInteraction = 'pointer' | 'static'

type LiquidGlassStyle = CSSProperties & Record<`--sv-liquid-glass-${string}`, string>

export type LiquidGlassCardProps = Omit<ComponentPropsWithoutRef<'div'>, 'children'> & {
  children: ReactNode
  width?: CSSProperties['width']
  height?: CSSProperties['height']
  minWidth?: CSSProperties['minWidth']
  minHeight?: CSSProperties['minHeight']
  padding?: CSSProperties['padding']
  margin?: CSSProperties['margin']
  outerRadius?: CSSProperties['borderRadius']
  innerRadius?: CSSProperties['borderRadius']
  refraction?: number
  blur?: number
  quality?: LiquidGlassQuality
  interaction?: LiquidGlassInteraction
  contentClassName?: string
  contentStyle?: CSSProperties
}

const DEFAULT_POINTER = { x: 0.5, y: 0.5 }
const FILTER_NAMESPACE = 'http://www.w3.org/1999/xlink'

function clamp(value: number, minimum: number, maximum: number) {
  return Math.min(Math.max(value, minimum), maximum)
}

function asCssLength(value: string | number | undefined, fallback: string) {
  if (value === undefined) return fallback
  return typeof value === 'number' ? `${value}px` : value
}

function classNames(...values: Array<string | undefined>) {
  return values.filter(Boolean).join(' ')
}

function supportsBackdropFilter() {
  if (typeof CSS === 'undefined') return false
  return CSS.supports('backdrop-filter', 'blur(1px)')
    || CSS.supports('-webkit-backdrop-filter', 'blur(1px)')
}

function readCornerRadius(element: HTMLElement, width: number, height: number) {
  const radius = Number.parseFloat(window.getComputedStyle(element).borderTopLeftRadius)
  return Number.isFinite(radius) ? clamp(radius, 0, Math.min(width, height) / 2) : 0
}

export function LiquidGlassCard({
  children,
  width = '100%',
  height = 'auto',
  minWidth = 0,
  minHeight = 0,
  padding = '20px',
  margin = 0,
  outerRadius = '24px',
  innerRadius,
  refraction = 14,
  blur = 8,
  quality = 'auto',
  interaction = 'pointer',
  className,
  contentClassName,
  contentStyle,
  style,
  onPointerMove,
  onPointerLeave,
  ...rest
}: LiquidGlassCardProps) {
  const rootRef = useRef<HTMLDivElement>(null)
  const filterRef = useRef<SVGFilterElement>(null)
  const imageRef = useRef<SVGFEImageElement>(null)
  const displacementRef = useRef<SVGFEDisplacementMapElement>(null)
  const canvasRef = useRef<HTMLCanvasElement | null>(null)
  const pointerRef = useRef(DEFAULT_POINTER)
  const frameRef = useRef<number | null>(null)
  const supportedRef = useRef(false)
  const canTrackPointerRef = useRef(false)
  const visibleRef = useRef(true)
  const [hasRefraction, setHasRefraction] = useState(false)
  const reactId = useId()
  const filterId = `sv-liquid-glass-${reactId.replaceAll(':', '')}`
  const safeRefraction = clamp(Number.isFinite(refraction) ? refraction : 14, 0, 32)
  const safeBlur = clamp(Number.isFinite(blur) ? blur : 8, 0, 40)
  const outerRadiusValue = asCssLength(outerRadius, '24px')
  const innerRadiusValue = innerRadius === undefined
    ? `max(0px, calc(${outerRadiusValue} - 3px))`
    : asCssLength(innerRadius, outerRadiusValue)

  const drawMap = useCallback(() => {
    const root = rootRef.current
    const filter = filterRef.current
    const image = imageRef.current
    const displacement = displacementRef.current

    if (!root || !filter || !image || !displacement || !supportedRef.current) return

    const bounds = root.getBoundingClientRect()
    if (bounds.width < 1 || bounds.height < 1) return

    const map = createLiquidGlassMap({
      width: bounds.width,
      height: bounds.height,
      radius: readCornerRadius(root, bounds.width, bounds.height),
      refraction: safeRefraction,
      pointer: pointerRef.current,
      quality,
      devicePixelRatio: window.devicePixelRatio,
    })
    const canvas = canvasRef.current ?? document.createElement('canvas')
    const context = canvas.getContext('2d')

    if (!context) return

    canvasRef.current = canvas
    canvas.width = map.width
    canvas.height = map.height
    const imageData = new Uint8ClampedArray(map.data.length)
    imageData.set(map.data)
    context.putImageData(new ImageData(imageData, map.width, map.height), 0, 0)

    const imageDataUrl = canvas.toDataURL('image/png')
    filter.setAttribute('width', `${bounds.width}`)
    filter.setAttribute('height', `${bounds.height}`)
    image.setAttribute('width', `${bounds.width}`)
    image.setAttribute('height', `${bounds.height}`)
    image.setAttribute('href', imageDataUrl)
    image.setAttributeNS(FILTER_NAMESPACE, 'href', imageDataUrl)
    displacement.setAttribute('scale', `${map.scale}`)
    setHasRefraction((current) => current || true)
  }, [quality, safeRefraction])

  useEffect(() => {
    const root = rootRef.current

    if (!root || !supportsBackdropFilter()) {
      supportedRef.current = false
      return undefined
    }

    const motionQuery = window.matchMedia('(prefers-reduced-motion: reduce)')
    const forcedColorsQuery = window.matchMedia('(forced-colors: active)')
    let visible = typeof IntersectionObserver === 'undefined'
    visibleRef.current = visible

    const updateActivity = () => {
      supportedRef.current = !forcedColorsQuery.matches
      canTrackPointerRef.current = supportedRef.current
        && interaction === 'pointer'
        && visible
        && document.visibilityState === 'visible'
        && !motionQuery.matches
        && !forcedColorsQuery.matches
    }
    const redraw = () => drawMap()
    const onVisibilityChange = () => {
      updateActivity()
      if (document.visibilityState === 'visible') redraw()
    }
    const onPreferenceChange = () => {
      updateActivity()
      if (supportedRef.current) redraw()
    }
    const resizeObserver = typeof ResizeObserver === 'undefined'
      ? null
      : new ResizeObserver(redraw)
    const intersectionObserver = typeof IntersectionObserver === 'undefined'
      ? null
      : new IntersectionObserver((entries) => {
        visible = entries.some((entry) => entry.isIntersecting)
        visibleRef.current = visible
        updateActivity()
        if (visible) redraw()
      }, { threshold: 0.01 })

    updateActivity()
    resizeObserver?.observe(root)
    intersectionObserver?.observe(root)
    window.addEventListener('resize', redraw)
    document.addEventListener('visibilitychange', onVisibilityChange)
    motionQuery.addEventListener('change', onPreferenceChange)
    forcedColorsQuery.addEventListener('change', onPreferenceChange)
    if (supportedRef.current && visible) redraw()

    return () => {
      supportedRef.current = false
      canTrackPointerRef.current = false
      resizeObserver?.disconnect()
      intersectionObserver?.disconnect()
      window.removeEventListener('resize', redraw)
      document.removeEventListener('visibilitychange', onVisibilityChange)
      motionQuery.removeEventListener('change', onPreferenceChange)
      forcedColorsQuery.removeEventListener('change', onPreferenceChange)
      if (frameRef.current !== null) {
        window.cancelAnimationFrame(frameRef.current)
        frameRef.current = null
      }
    }
  }, [drawMap, interaction])

  useEffect(() => {
    if (visibleRef.current) drawMap()
  }, [drawMap, outerRadiusValue])

  const queuePointerMap = useCallback(() => {
    if (!supportedRef.current || !canTrackPointerRef.current || !visibleRef.current || frameRef.current !== null) {
      return
    }

    frameRef.current = window.requestAnimationFrame(() => {
      frameRef.current = null
      drawMap()
    })
  }, [drawMap])

  const handlePointerMove = useCallback((event: PointerEvent<HTMLDivElement>) => {
    onPointerMove?.(event)

    if (event.pointerType === 'touch' || interaction !== 'pointer') return

    const bounds = event.currentTarget.getBoundingClientRect()
    if (bounds.width < 1 || bounds.height < 1) return

    pointerRef.current = {
      x: clamp((event.clientX - bounds.left) / bounds.width, 0, 1),
      y: clamp((event.clientY - bounds.top) / bounds.height, 0, 1),
    }
    event.currentTarget.style.setProperty('--sv-liquid-glass-pointer-x', `${pointerRef.current.x * 100}%`)
    event.currentTarget.style.setProperty('--sv-liquid-glass-pointer-y', `${pointerRef.current.y * 100}%`)
    queuePointerMap()
  }, [interaction, onPointerMove, queuePointerMap])

  const handlePointerLeave = useCallback((event: PointerEvent<HTMLDivElement>) => {
    onPointerLeave?.(event)

    if (interaction !== 'pointer') return

    pointerRef.current = DEFAULT_POINTER
    event.currentTarget.style.setProperty('--sv-liquid-glass-pointer-x', '50%')
    event.currentTarget.style.setProperty('--sv-liquid-glass-pointer-y', '50%')
    queuePointerMap()
  }, [interaction, onPointerLeave, queuePointerMap])

  const rootStyle = useMemo<LiquidGlassStyle>(() => {
    const backdropFilter = `url(#${filterId}) blur(${safeBlur}px) saturate(132%) brightness(106%)`

    return {
      '--sv-liquid-glass-width': asCssLength(width, '100%'),
      '--sv-liquid-glass-height': asCssLength(height, 'auto'),
      '--sv-liquid-glass-min-width': asCssLength(minWidth, '0'),
      '--sv-liquid-glass-min-height': asCssLength(minHeight, '0'),
      '--sv-liquid-glass-padding': asCssLength(padding, '20px'),
      '--sv-liquid-glass-margin': asCssLength(margin, '0'),
      '--sv-liquid-glass-outer-radius': outerRadiusValue,
      '--sv-liquid-glass-inner-radius': innerRadiusValue,
      '--sv-liquid-glass-blur': `${safeBlur}px`,
      '--sv-liquid-glass-pointer-x': '50%',
      '--sv-liquid-glass-pointer-y': '50%',
      ...(hasRefraction ? { backdropFilter, WebkitBackdropFilter: backdropFilter } : {}),
      ...style,
    }
  }, [filterId, hasRefraction, height, innerRadiusValue, margin, minHeight, minWidth, outerRadiusValue, padding, safeBlur, style, width])

  return (
    <div
      {...rest}
      ref={rootRef}
      className={classNames(styles.root, className)}
      style={rootStyle}
      data-refraction={hasRefraction ? 'enabled' : undefined}
      onPointerMove={handlePointerMove}
      onPointerLeave={handlePointerLeave}
    >
      <svg className={styles.filter} aria-hidden="true" focusable="false">
        <defs>
          <filter
            ref={filterRef}
            id={filterId}
            filterUnits="userSpaceOnUse"
            colorInterpolationFilters="sRGB"
            x="0"
            y="0"
            width="1"
            height="1"
          >
            <feImage ref={imageRef} result="liquid-glass-map" />
            <feDisplacementMap
              ref={displacementRef}
              in="SourceGraphic"
              in2="liquid-glass-map"
              xChannelSelector="R"
              yChannelSelector="G"
            />
          </filter>
        </defs>
      </svg>
      <div className={classNames(styles.content, contentClassName)} style={contentStyle}>
        {children}
      </div>
    </div>
  )
}
