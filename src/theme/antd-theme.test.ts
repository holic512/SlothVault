import { readFileSync } from 'node:fs'

import { theme as antdTheme } from 'antd'
import { describe, expect, it } from 'vitest'

import { getAntdTheme } from '@/theme/antd-theme'
import { appStyles, type AppStyle } from '@/theme/app-style'
import { appThemePalette, appThemes, type AppTheme } from '@/theme/app-theme'
import { contentTagColors, tagPalettes } from '@/theme/tag-colors'

type Color = [number, number, number, number]

function parseColor(value: string): Color {
  if (value.startsWith('#')) {
    const hex = value.length === 4 ? value.slice(1).split('').map((c) => c + c).join('') : value.slice(1)
    return [0, 2, 4].map((i) => Number.parseInt(hex.slice(i, i + 2), 16)).concat(1) as Color
  }
  const channels = value.match(/[\d.]+%?/g)!
  return [
    ...channels.slice(0, 3).map(Number),
    channels[3] ? Number.parseFloat(channels[3]) / (channels[3].endsWith('%') ? 100 : 1) : 1,
  ] as Color
}

function luminance(channels: number[]) {
  return channels.slice(0, 3).map((channel) => {
    const value = channel / 255
    return value <= 0.04045 ? value / 12.92 : ((value + 0.055) / 1.055) ** 2.4
  }).reduce((sum, value, i) => sum + value * [0.2126, 0.7152, 0.0722][i], 0)
}

function contrast(foreground: string, background: string) {
  const front = parseColor(foreground)
  const back = parseColor(background)
  const first = luminance(front.slice(0, 3).map((v, i) => v * front[3] + back[i] * (1 - front[3])))
  const second = luminance(back)
  return (Math.max(first, second) + 0.05) / (Math.min(first, second) + 0.05)
}

function expectContrast(foreground: string, backgrounds: string[], minimum: number) {
  for (const background of backgrounds) {
    expect(contrast(foreground, background), `${foreground} on ${background}`).toBeGreaterThanOrEqual(minimum)
  }
}

const css = readFileSync(new URL('../styles/tokens.css', import.meta.url), 'utf8').replace(/\/\*[\s\S]*?\*\//g, '')

function cssTokens(style: AppStyle, mode: AppTheme) {
  const selectors = new Set([
    ':root',
    ...(mode === 'dark' ? ['.dark'] : []),
    ...(style === 'saas' ? [":root[data-style='saas']"] : []),
    ...(style === 'saas' && mode === 'dark' ? [":root[data-style='saas'].dark"] : []),
  ])
  const variables = new Map<string, string>()
  for (const block of css.matchAll(/([^{}]+)\{([^{}]*)\}/g)) {
    if (!selectors.has(block[1].trim())) continue
    for (const property of block[2].matchAll(/(--sv-[\w-]+):\s*([^;]+);/g)) {
      variables.set(property[1], property[2].trim())
    }
  }
  function resolve(name: string): string {
    const value = variables.get(name)
    if (!value) throw new Error(`Missing CSS token ${name}`)
    return value.startsWith('var(') ? resolve(value.slice(4, -1)) : value
  }
  return resolve
}

describe.each(appStyles.flatMap((style) => appThemes.map((mode) => ({ style, mode }))))(
  '$style $mode reading contrast',
  ({ style, mode }) => {
    const config = getAntdTheme(style, mode)
    const token = antdTheme.getDesignToken(config)
    const palette = appThemePalette[style][mode]
    const surfaces = [token.colorBgLayout, token.colorBgContainer, token.colorBgElevated, palette.soft, palette.tableHeader]
    const resolve = cssTokens(style, mode)

    it('keeps reading text, descriptions, placeholders, and links readable after the real theme algorithm', () => {
      for (const color of [
        token.colorText, token.colorTextDescription, token.colorTextLabel, token.colorTextSecondary,
        token.colorTextTertiary, token.colorTextPlaceholder, token.colorLink, token.colorLinkHover, token.colorLinkActive,
      ]) expectContrast(color, surfaces, 4.5)
      expectContrast(token.colorText, surfaces, 7)
      expectContrast(token.colorPrimaryText, [token.colorPrimaryBg, token.colorPrimaryBgHover], 4.5)
    })

    it('pairs filled controls with readable foregrounds in every interactive state', () => {
      const states = [token.colorPrimary, token.colorPrimaryHover, token.colorPrimaryActive]
      expectContrast(config.components!.Button!.primaryColor!, states, 4.5)
      expectContrast(config.components!.Radio!.buttonSolidCheckedColor!, states, 4.5)
      expectContrast(config.components!.Checkbox!.colorWhite!, states, 3)
      expectContrast(config.components!.Radio!.colorWhite!, states, 3)
      expectContrast(config.components!.Switch!.colorTextLightSolid!, [
        ...states, config.components!.Switch!.colorTextQuaternary!, config.components!.Switch!.colorTextTertiary!,
      ], 4.5)
      expectContrast(config.components!.Switch!.handleBg!, states, 3)
      expectContrast(config.components!.Button!.dangerColor!, [token.colorError, token.colorErrorHover, token.colorErrorActive], 4.5)
      expect(token.colorTextLightSolid).toBe('#fff')
    })

    it('keeps semantic notices readable on their tinted backgrounds', () => {
      for (const name of ['Info', 'Success', 'Warning', 'Error'] as const) {
        expectContrast(token[`color${name}Text`], [token[`color${name}Bg`], token[`color${name}BgHover`], ...surfaces], 4.5)
      }
    })

    it('gives tags distinct semantic colors and readable category backgrounds independently of the page accent', () => {
      const tag = config.components!.Tag!
      const colors = ['Info', 'Success', 'Warning', 'Error'] as const
      expect(new Set(colors.map((name) => tag[`color${name}`])).size).toBe(4)
      for (const name of colors) {
        expectContrast(tag[`color${name}`]!, [tag[`color${name}Bg`]!], 4.5)
        expect(tag[`color${name}Border`]).not.toBe(tag[`color${name}Bg`])
      }
      for (const name of contentTagColors) {
        expect(tag[`${name}7`]).toBe(tagPalettes[mode][name])
        expectContrast(tag[`${name}7`]!, [tag[`${name}1`]!], 4.5)
      }
      expectContrast(tag.defaultColor!, [tag.defaultBg!], 4.5)
      expect(parseColor(resolve('--sv-tag-membership'))).toEqual(parseColor(tag.purple7!))
    })

    it('distinguishes controls and focus indicators without strengthening decorative borders', () => {
      expectContrast(token.colorBorder, surfaces, 3)
      expectContrast(token.controlOutline, surfaces, 3)
      expectContrast(config.components!.Checkbox!.colorPrimaryBorder!, surfaces, 3)
      expectContrast(config.components!.Radio!.colorPrimaryBorder!, surfaces, 3)
      expectContrast(config.components!.Segmented!.colorPrimaryBorder!, surfaces, 3)
      expect(token.colorBorder).not.toBe(token.colorBorderSecondary)
      expect(token.colorTextDisabled).not.toBe(token.colorTextPlaceholder)
    })

    it('keeps navigation text readable on the 96% glass scrim even over opposite-color content', () => {
      const surface = parseColor(palette.container)
      for (const backing of [0, 255]) {
        const composite = `rgb(${surface.slice(0, 3).map((v) => v * 0.96 + backing * 0.04).join(',')})`
        expectContrast(palette.muted, [composite], 4.5)
        expectContrast(palette.subtle, [composite], 4.5)
      }
    })

    it('keeps CSS and resolved component colors in agreement', () => {
      const pairs = {
        '--sv-bg': token.colorBgLayout,
        '--sv-bg-solid': token.colorBgContainer,
        '--sv-text': token.colorText,
        '--sv-text-muted': token.colorTextDescription,
        '--sv-text-subtle': token.colorTextTertiary,
        '--sv-text-placeholder': token.colorTextPlaceholder,
        '--sv-control-border': token.colorBorder,
        '--sv-primary': token.colorPrimary,
        '--sv-primary-hover': token.colorPrimaryHover,
        '--sv-primary-active': token.colorPrimaryActive,
        '--sv-primary-contrast': config.components!.Button!.primaryColor!,
        '--sv-link': token.colorLink,
        '--sv-link-hover': token.colorLinkHover,
        '--sv-link-active': token.colorLinkActive,
        '--sv-focus-ring': token.controlOutline,
      }
      for (const [name, value] of Object.entries(pairs)) {
        expect(parseColor(resolve(name)), name).toEqual(parseColor(value))
      }
      // Custom Mono status labels intentionally retain their existing colored accents.
      for (const name of ['--sv-success', '--sv-warning', '--sv-danger']) {
        expectContrast(resolve(name), surfaces, 4.5)
      }
    })
  },
)
