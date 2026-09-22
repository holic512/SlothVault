'use client'

/**
 * @file liquid-glass-card.tsx
 * @project SlothVault
 * @module Liquid Glass Card
 * @description Provides a standalone, accessible content container with bounded SVG-backed background refraction.
 * @logic Keep SVG definitions outside the filtered surface, rebuild a static lens only when its geometry changes, and retain a readable CSS fallback.
 * @dependencies React, liquid-glass-map, liquid-glass-card.module.css
 * @index_tags component,liquid-glass,card,canvas,svg,accessibility
 * @author holic512
 */

import {
  useEffect,
  useId,
  useRef,
  type ComponentPropsWithoutRef,
  type CSSProperties,
  type ReactNode,
} from 'react'

import { createLiquidGlassMap, type LiquidGlassQuality } from '@/lib/liquid-glass-map'
import styles from '@/styles/modules/liquid-glass-card.module.css'

export type { LiquidGlassQuality } from '@/lib/liquid-glass-map'

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
  contentClassName?: string
  contentStyle?: CSSProperties
}

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

function supportsSvgBackdropFilter() {
  // CSS.supports alone only validates syntax; WebKit/Gecko can parse url()
  // without rendering SVG backdrop displacement. Keep their CSS fallback.
  return typeof CSS !== 'undefined'
    && CSS.supports('backdrop-filter', 'url("#glass")')
    && /(?:Chrome|Chromium|Edg)\//.test(navigator.userAgent)
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
  refraction = 4,
  blur = 0.25,
  quality = 'auto',
  className,
  contentClassName,
  contentStyle,
  style,
  ...rest
}: LiquidGlassCardProps) {
  const rootRef = useRef<HTMLDivElement>(null)
  const filterRef = useRef<SVGFilterElement>(null)
  const imageRef = useRef<SVGFEImageElement>(null)
  const displacementRef = useRef<SVGFEDisplacementMapElement>(null)
  const reactId = useId()
  const filterId = `sv-liquid-glass-${reactId.replace(/[^a-zA-Z0-9_-]/g, '')}`
  const safeRefraction = clamp(Number.isFinite(refraction) ? refraction : 4, 0, 32)
  const safeBlur = clamp(Number.isFinite(blur) ? blur : 0.25, 0, 40)
  const outerRadiusValue = asCssLength(outerRadius, '24px')
  const innerRadiusValue = innerRadius === undefined
    ? `max(0px, calc(${outerRadiusValue} - 3px))`
    : asCssLength(innerRadius, outerRadiusValue)

  useEffect(() => {
    const root = rootRef.current
    const filter = filterRef.current
    const image = imageRef.current
    const displacement = displacementRef.current
    if (!root || !filter || !image || !displacement || !supportsSvgBackdropFilter()) return

    const canvas = document.createElement('canvas')
    const context = canvas.getContext('2d')
    if (!context) return
    const forcedColors = window.matchMedia('(forced-colors: active)')
    let frame: number | undefined
    let lastGeometry = ''

    const reset = () => {
      root.removeAttribute('data-refraction')
      root.style.removeProperty('--sv-liquid-glass-filter')
      lastGeometry = ''
    }
    const draw = () => {
      frame = undefined
      if (forcedColors.matches) { reset(); return }
      const { width: measuredWidth, height: measuredHeight } = root.getBoundingClientRect()
      if (measuredWidth < 1 || measuredHeight < 1) return
      const radius = readCornerRadius(root, measuredWidth, measuredHeight)
      const geometry = `${measuredWidth}:${measuredHeight}:${radius}:${window.devicePixelRatio}`
      if (geometry === lastGeometry) return
      const map = createLiquidGlassMap({
        width: measuredWidth, height: measuredHeight, radius,
        refraction: safeRefraction, quality, devicePixelRatio: window.devicePixelRatio,
      })
      canvas.width = map.width
      canvas.height = map.height
      context.putImageData(new ImageData(new Uint8ClampedArray(map.data), map.width, map.height), 0, 0)
      filter.setAttribute('width', `${measuredWidth}`)
      filter.setAttribute('height', `${measuredHeight}`)
      image.setAttribute('width', `${measuredWidth}`)
      image.setAttribute('height', `${measuredHeight}`)
      image.setAttribute('href', canvas.toDataURL('image/png'))
      displacement.setAttribute('scale', `${map.scale}`)
      root.style.setProperty('--sv-liquid-glass-filter', `url("#${filterId}") blur(${safeBlur}px) saturate(1.12)`)
      root.dataset.refraction = 'enabled'
      lastGeometry = geometry
    }
    const scheduleDraw = () => {
      if (frame === undefined) frame = window.requestAnimationFrame(draw)
    }
    const observer = new ResizeObserver(scheduleDraw)
    observer.observe(root)
    window.addEventListener('resize', scheduleDraw)
    forcedColors.addEventListener('change', scheduleDraw)
    scheduleDraw()

    return () => {
      observer.disconnect()
      window.removeEventListener('resize', scheduleDraw)
      forcedColors.removeEventListener('change', scheduleDraw)
      if (frame !== undefined) window.cancelAnimationFrame(frame)
      reset()
    }
  }, [filterId, quality, safeRefraction, safeBlur, outerRadiusValue])

  const rootStyle: LiquidGlassStyle = {
    '--sv-liquid-glass-width': asCssLength(width, '100%'),
    '--sv-liquid-glass-height': asCssLength(height, 'auto'),
    '--sv-liquid-glass-min-width': asCssLength(minWidth, '0'),
    '--sv-liquid-glass-min-height': asCssLength(minHeight, '0'),
    '--sv-liquid-glass-padding': asCssLength(padding, '20px'),
    '--sv-liquid-glass-margin': asCssLength(margin, '0'),
    '--sv-liquid-glass-outer-radius': outerRadiusValue,
    '--sv-liquid-glass-inner-radius': innerRadiusValue,
    ...style,
  }

  return (
    <>
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
            <feImage ref={imageRef} result="liquid-glass-map" preserveAspectRatio="none" />
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
      <div {...rest} ref={rootRef} className={classNames(styles.root, className)} style={rootStyle}>
        <div className={classNames(styles.content, contentClassName)} style={contentStyle}>
          {children}
        </div>
      </div>
    </>
  )
}
