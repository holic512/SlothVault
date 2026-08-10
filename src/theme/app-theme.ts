/**
 * @file app-theme.ts
 * @project SlothVault
 * @module Application Theme Contract
 * @description Defines the supported color modes, cookie contract, and style-aware palettes used during SSR and hydration.
 * @logic Validate the persisted color mode once, expose a stable light fallback, and provide matching palettes for every visual style and Ant Design adapter.
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
  saas: {
    light: {
      background: '#f4f7fb',
      container: '#ffffff',
      sider: '#ffffff',
      tableHeader: '#f7f9fc',
      primary: '#2563eb',
      info: '#2563eb',
      success: '#15803d',
      warning: '#b45309',
      error: '#dc2626',
      border: '#d9e1ee',
    },
    dark: {
      background: '#0b1220',
      container: '#111a2b',
      sider: '#0f1726',
      tableHeader: '#162136',
      primary: '#78a6ff',
      info: '#78a6ff',
      success: '#4ade80',
      warning: '#fbbf24',
      error: '#fb7185',
      border: '#263650',
    },
  },
} as const satisfies Record<AppStyle, Record<AppTheme, AppThemePalette>>

export function isAppTheme(value: string | undefined): value is AppTheme {
  return Boolean(value && appThemes.includes(value as AppTheme))
}
