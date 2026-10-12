/**
 * @file antd-theme.ts
 * @project SlothVault
 * @module Component Theme Adapter
 * @description Maps application palettes to readable Ant Design text, controls, and semantic states.
 * @logic Keep the stock layout algorithm, pin semantic colors after its dark transformation, and give tags their own readable status and category palette.
 * @dependencies antd, app-theme, app-style, tag-colors
 * @index_tags theme,antd,contrast,accessibility,design-tokens
 * @author holic512
 */

import { theme as antdTheme, type ThemeConfig } from 'antd'

import type { AppStyle } from '@/theme/app-style'
import { appThemePalette, type AppTheme } from '@/theme/app-theme'
import { contentTagColors, tagPalettes } from '@/theme/tag-colors'

function blend(foreground: string, background: string, weight: number) {
  const channels = [1, 3, 5].map((offset) => {
    const front = Number.parseInt(foreground.slice(offset, offset + 2), 16)
    const back = Number.parseInt(background.slice(offset, offset + 2), 16)
    return Math.round(front * weight + back * (1 - weight)).toString(16).padStart(2, '0')
  })
  return `#${channels.join('')}`
}

export function getAntdTheme(style: AppStyle, mode: AppTheme): ThemeConfig {
  const palette = appThemePalette[style][mode]
  const dark = mode === 'dark'
  const baseAlgorithm = dark ? antdTheme.darkAlgorithm : antdTheme.defaultAlgorithm
  const tagPalette = tagPalettes[mode]
  const tagBackgroundWeight = dark ? 0.12 : 0.08
  const tagSemanticColors = {
    Info: tagPalette.processing,
    Success: tagPalette.success,
    Warning: tagPalette.warning,
    Error: tagPalette.error,
  }
  const tagStatusTokens = Object.fromEntries(
    Object.entries(tagSemanticColors).flatMap(([name, color]) => {
      return [
        [`color${name}`, color],
        [`color${name}Text`, color],
        [`color${name}Bg`, blend(color, palette.container, tagBackgroundWeight)],
        [`color${name}Border`, blend(color, palette.container, 0.3)],
      ]
    }),
  )
  const tagCategoryTokens = Object.fromEntries(contentTagColors.flatMap((name) => [
    [`${name}1`, blend(tagPalette[name], palette.container, tagBackgroundWeight)],
    [`${name}3`, blend(tagPalette[name], palette.container, 0.3)],
    [`${name}6`, tagPalette[name]],
    [`${name}7`, tagPalette[name]],
  ]))
  const semanticColors = {
    colorPrimary: palette.primary,
    colorInfo: palette.info,
    colorSuccess: palette.success,
    colorWarning: palette.warning,
    colorError: palette.error,
  }
  const statusTokens = Object.fromEntries(
    (['Info', 'Success', 'Warning', 'Error'] as const).flatMap((name) => {
      const color = semanticColors[`color${name}`]
      return [
        [`color${name}Text`, color],
        [`color${name}TextHover`, color],
        [`color${name}TextActive`, color],
        [`color${name}Bg`, blend(color, palette.container, 0.08)],
        [`color${name}BgHover`, blend(color, palette.container, 0.12)],
        [`color${name}Border`, blend(color, palette.container, 0.45)],
        [`color${name}BorderHover`, color],
        [`color${name}Hover`, blend(color, dark ? '#ffffff' : '#000000', 0.85)],
        [`color${name}Active`, blend(color, dark ? palette.container : '#000000', 0.9)],
      ]
    }),
  )

  return {
    // Seed colors are otherwise transformed again by darkAlgorithm before alias overrides.
    algorithm: (seed, map) => ({ ...baseAlgorithm(seed, map), ...semanticColors, colorLink: palette.link }),
    token: {
      ...semanticColors,
      ...statusTokens,
      colorBgBase: palette.background,
      colorBgLayout: palette.background,
      colorBgContainer: palette.container,
      colorBgElevated: palette.container,
      colorBgContainerDisabled: palette.soft,
      colorTextBase: palette.text,
      colorText: palette.text,
      colorTextHeading: palette.text,
      colorTextLabel: palette.muted,
      colorTextSecondary: palette.muted,
      colorTextDescription: palette.muted,
      colorTextTertiary: palette.subtle,
      colorTextQuaternary: palette.disabled,
      colorTextPlaceholder: palette.subtle,
      colorTextDisabled: palette.disabled,
      colorIcon: palette.subtle,
      colorIconHover: palette.text,
      colorBorder: palette.controlBorder,
      colorBorderSecondary: palette.border,
      colorFill: blend(palette.text, palette.container, 0.12),
      colorFillSecondary: blend(palette.text, palette.container, 0.08),
      colorFillTertiary: palette.soft,
      colorFillQuaternary: blend(palette.soft, palette.container, 0.5),
      colorPrimaryHover: palette.primaryHover,
      colorPrimaryActive: palette.primaryActive,
      colorPrimaryText: palette.link,
      colorPrimaryTextHover: palette.linkHover,
      colorPrimaryTextActive: palette.linkActive,
      colorPrimaryBg: blend(palette.primary, palette.container, 0.08),
      colorPrimaryBgHover: blend(palette.primary, palette.container, 0.12),
      colorPrimaryBorder: blend(palette.primary, palette.container, 0.45),
      colorPrimaryBorderHover: palette.primary,
      colorLink: palette.link,
      colorLinkHover: palette.linkHover,
      colorLinkActive: palette.linkActive,
      controlOutline: palette.link,
    },
    components: {
      Tag: {
        defaultColor: palette.muted,
        defaultBg: blend(palette.muted, palette.container, tagBackgroundWeight),
        colorBorder: blend(palette.muted, palette.container, 0.3),
        ...tagStatusTokens,
        ...tagCategoryTokens,
      },
      Button: {
        fontWeight: style === 'saas' ? 600 : 650,
        primaryColor: palette.primaryContrast,
        dangerColor: dark ? '#151515' : '#ffffff',
      },
      Checkbox: { colorWhite: palette.primaryContrast, colorPrimaryBorder: palette.link },
      Radio: {
        colorWhite: palette.primaryContrast,
        colorPrimaryBorder: palette.link,
        buttonSolidCheckedColor: palette.primaryContrast,
      },
      Segmented: { colorPrimaryBorder: palette.link },
      Switch: {
        colorTextQuaternary: palette.muted,
        colorTextTertiary: palette.subtle,
        colorTextLightSolid: palette.primaryContrast,
        handleBg: palette.primaryContrast,
      },
      // Decorative surfaces keep softer edges than interactive controls.
      Card: { headerFontSize: 15 },
      Layout: { bodyBg: 'transparent', headerBg: 'transparent', siderBg: palette.sider },
      Menu: {
        darkItemBg: 'transparent',
        darkSubMenuItemBg: 'transparent',
        itemBorderRadius: 10,
      },
      Table: { headerBg: palette.tableHeader },
    },
  }
}
