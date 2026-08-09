/**
 * @file app-theme.ts
 * @project SlothVault
 * @module Application Theme Contract
 * @description Defines the supported visual themes, cookie contract, and shared neutral palette used during SSR and hydration.
 * @logic Validate the persisted theme once, expose a stable light fallback, and provide matching palette values to the application and Ant Design adapters.
 * @dependencies none
 * @index_tags theme,cookie,ssr,design-tokens
 * @author holic512
 */

export const appThemes = ['light', 'dark'] as const
export type AppTheme = (typeof appThemes)[number]

export const DEFAULT_APP_THEME: AppTheme = 'light'
export const APP_THEME_COOKIE = 'sv_theme'
export const APP_THEME_COOKIE_MAX_AGE = 365 * 24 * 60 * 60

export const appThemePalette = {
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
} as const satisfies Record<AppTheme, Record<string, string>>

export function isAppTheme(value: string | undefined): value is AppTheme {
  return Boolean(value && appThemes.includes(value as AppTheme))
}
