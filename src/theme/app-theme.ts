/**
 * @file app-theme.ts
 * @project SlothVault
 * @module Application Theme Contract
 * @description Defines the supported color modes, cookie contract, and style-aware palettes used during SSR and hydration.
 * @logic Validate persisted color modes and provide explicit reading, control, and action colors for both visual styles without importing a component runtime into SSR consumers.
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
  soft: string
  sider: string
  tableHeader: string
  text: string
  muted: string
  subtle: string
  disabled: string
  controlBorder: string
  primary: string
  primaryHover: string
  primaryActive: string
  primaryContrast: string
  link: string
  linkHover: string
  linkActive: string
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
      soft: '#ebeae5',
      sider: '#f8f7f3',
      tableHeader: '#efeee9',
      text: '#151515',
      muted: '#57554f',
      subtle: '#68655e',
      disabled: '#a29f97',
      controlBorder: '#89867f',
      primary: '#151515',
      primaryHover: '#2e2e2e',
      primaryActive: '#000000',
      primaryContrast: '#fbfaf7',
      link: '#151515',
      linkHover: '#000000',
      linkActive: '#2e2e2e',
      info: '#2a2a2a',
      success: '#2a2a2a',
      warning: '#575757',
      error: '#8f3030',
      border: 'rgba(20,20,20,.14)',
    },
    dark: {
      background: '#0d0d0d',
      container: '#191919',
      soft: '#252525',
      sider: '#101010',
      tableHeader: '#252525',
      text: '#f1f0ec',
      muted: '#b9b7b0',
      subtle: '#a5a299',
      disabled: '#706e68',
      controlBorder: '#76736c',
      primary: '#f1f0ec',
      primaryHover: '#ffffff',
      primaryActive: '#d9d8d3',
      primaryContrast: '#151515',
      link: '#f1f0ec',
      linkHover: '#ffffff',
      linkActive: '#d9d8d3',
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
      background: '#f4f6f8',
      container: '#ffffff',
      soft: '#eef1f5',
      sider: '#ffffff',
      tableHeader: '#eef1f5',
      text: '#303133',
      muted: '#55585f',
      subtle: '#656971',
      disabled: '#a8abb2',
      controlBorder: '#858b96',
      primary: '#1765b5',
      primaryHover: '#13579e',
      primaryActive: '#104b88',
      primaryContrast: '#ffffff',
      link: '#1765b5',
      linkHover: '#13579e',
      linkActive: '#104b88',
      info: '#55585f',
      success: '#166534',
      warning: '#8a5700',
      error: '#b42318',
      border: '#dcdfe6',
    },
    dark: {
      background: '#141414',
      container: '#1d1e1f',
      soft: '#292b2e',
      sider: '#141414',
      tableHeader: '#292b2e',
      text: '#e5eaf3',
      muted: '#c2c8d2',
      subtle: '#a5adba',
      disabled: '#727985',
      controlBorder: '#7b8391',
      primary: '#409eff',
      primaryHover: '#66b1ff',
      primaryActive: '#398fdf',
      primaryContrast: '#102034',
      link: '#70b5ff',
      linkHover: '#9bccff',
      linkActive: '#66b1ff',
      info: '#c2c8d2',
      success: '#72d98b',
      warning: '#f3c367',
      error: '#ff9b95',
      border: '#4c4d4f',
    },
  },
} as const satisfies Record<AppStyle, Record<AppTheme, AppThemePalette>>

export function isAppTheme(value: string | undefined): value is AppTheme {
  return Boolean(value && appThemes.includes(value as AppTheme))
}
