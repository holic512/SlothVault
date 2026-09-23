/**
 * @file app-theme.ts
 * @project SlothVault
 * @module Application Theme Contract
 * @description Defines the supported color modes, cookie contract, and style-aware palettes used during SSR and hydration.
 * @logic Validate the persisted color mode once, expose a stable light fallback, and provide matching page and component palettes, with explicit neutral tokens for the Standard style.
 * @dependencies app-style
 * @index_tags theme,style,cookie,ssr,design-tokens
 * @author holic512
 */

import type { AppStyle } from '@/theme/app-style'

export const appThemes = ['light', 'dark'] as const
export type AppTheme = (typeof appThemes)[number]

export const DEFAULT_APP_THEME: AppTheme = 'light'
export const APP_THEME_COOKIE = 'sv_theme'
export const APP_THEME_COOKIE_MAX_AGE = 365 * 24 * 60 * 60

type AppThemePalette = {
  background: string
  container: string
  sider: string
  tableHeader: string
  primary: string
  info: string
  success: string
  warning: string
  error: string
  border: string
}

export const appThemePalette = {
  mono: {
    light: {
      background: '#f4f3ef',
      container: '#fbfaf7',
      sider: '#f8f7f3',
      tableHeader: '#efeee9',
      primary: '#151515',
      info: '#2a2a2a',
      success: '#2a2a2a',
      warning: '#575757',
      error: '#8f3030',
      border: 'rgba(20,20,20,.14)',
    },
    dark: {
      background: '#0d0d0d',
      container: '#151515',
      sider: '#101010',
      tableHeader: '#1a1a1a',
      primary: '#f1f0ec',
      info: '#d7d7d3',
      success: '#d7d7d3',
      warning: '#b8b8b2',
      error: '#d98b8b',
      border: 'rgba(255,255,255,.13)',
    },
  },
  // Legacy cookie key retained for users who already selected the Standard style.
  saas: {
    light: {
      background: '#ffffff',
      container: '#ffffff',
      sider: '#ffffff',
      tableHeader: '#f5f7fa',
      primary: '#409eff',
      info: '#909399',
      success: '#67c23a',
      warning: '#e6a23c',
      error: '#f56c6c',
      border: '#dcdfe6',
    },
    dark: {
      background: '#141414',
      container: '#1d1e1f',
      sider: '#141414',
      tableHeader: '#262727',
      primary: '#409eff',
      info: '#909399',
      success: '#67c23a',
      warning: '#e6a23c',
      error: '#f56c6c',
      border: '#4c4d4f',
    },
  },
} as const satisfies Record<AppStyle, Record<AppTheme, AppThemePalette>>

/** Element Plus light neutrals and a charcoal dark adaptation, explicitly mapped to component tokens. */
export const standardThemeTokens = {
  light: {
    colorTextBase: '#303133',
    colorText: '#303133',
    colorTextHeading: '#303133',
    colorTextLabel: '#606266',
    colorTextSecondary: '#606266',
    colorTextTertiary: '#909399',
    colorTextQuaternary: '#a8abb2',
    colorTextPlaceholder: '#a8abb2',
    colorTextDisabled: '#c0c4cc',
    colorBgElevated: '#ffffff',
    colorBgLayout: '#ffffff',
    colorBgContainerDisabled: '#f5f7fa',
    colorBorderSecondary: '#ebeef5',
    colorFill: '#e6e8eb',
    colorFillSecondary: '#f0f2f5',
    colorFillTertiary: '#f5f7fa',
    colorFillQuaternary: '#fafafa',
    colorPrimaryHover: '#79bbff',
    colorPrimaryActive: '#337ecc',
    colorPrimaryBg: '#ecf5ff',
    colorPrimaryBgHover: '#d9ecff',
    colorPrimaryBorder: '#a0cfff',
    colorPrimaryBorderHover: '#79bbff',
    colorLink: '#409eff',
    colorLinkHover: '#79bbff',
    colorLinkActive: '#337ecc',
  },
  dark: {
    colorTextBase: '#e5eaf3',
    colorText: '#e5eaf3',
    colorTextHeading: '#e5eaf3',
    colorTextLabel: '#cfd3dc',
    colorTextSecondary: '#cfd3dc',
    colorTextTertiary: '#a3a6ad',
    colorTextQuaternary: '#8d9095',
    colorTextPlaceholder: '#8d9095',
    colorTextDisabled: '#6c6e72',
    colorBgElevated: '#1d1e1f',
    colorBgLayout: '#141414',
    colorBgContainerDisabled: '#262727',
    colorBorderSecondary: '#363637',
    colorFill: '#424243',
    colorFillSecondary: '#303030',
    colorFillTertiary: '#262727',
    colorFillQuaternary: '#1d1d1d',
    colorPrimaryHover: '#3375b9',
    colorPrimaryActive: '#66b1ff',
    colorPrimaryBg: '#18222c',
    colorPrimaryBgHover: '#1d3043',
    colorPrimaryBorder: '#2a598a',
    colorPrimaryBorderHover: '#3375b9',
    colorLink: '#409eff',
    colorLinkHover: '#3375b9',
    colorLinkActive: '#66b1ff',
  },
} as const

export function isAppTheme(value: string | undefined): value is AppTheme {
  return Boolean(value && appThemes.includes(value as AppTheme))
}
