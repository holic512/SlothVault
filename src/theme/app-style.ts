/**
 * @file app-style.ts
 * @project SlothVault
 * @module Application Style Contract
 * @description Defines the supported visual style families and their cookie-backed persistence contract.
 * @logic Validate a style family once so SSR, client controls, and preference APIs share the same safe default.
 * @dependencies none
 * @index_tags style,cookie,ssr,design-tokens
 * @author holic512
 */

export const appStyles = ['mono', 'saas'] as const
export type AppStyle = (typeof appStyles)[number]

export const DEFAULT_APP_STYLE: AppStyle = 'mono'
export const APP_STYLE_COOKIE = 'sv_style'
export const APP_STYLE_COOKIE_MAX_AGE = 365 * 24 * 60 * 60

export function isAppStyle(value: string | undefined): value is AppStyle {
  return Boolean(value && appStyles.includes(value as AppStyle))
}
