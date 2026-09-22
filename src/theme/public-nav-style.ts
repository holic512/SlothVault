/**
 * @file public-nav-style.ts
 * @project SlothVault
 * @module Public Navigation Appearance Contract
 * @description Defines the persisted appearance choices for the public top navigation only.
 * @logic Validate the navigation appearance once so SSR, client controls, and the first-party preference API share one safe default.
 * @dependencies none
 * @index_tags public-nav,appearance,cookie,ssr,liquid-glass
 * @author holic512
 */

export const publicNavStyles = ['standard', 'liquid-glass'] as const
export type PublicNavStyle = (typeof publicNavStyles)[number]

export const DEFAULT_PUBLIC_NAV_STYLE: PublicNavStyle = 'standard'
export const PUBLIC_NAV_STYLE_COOKIE = 'sv_public_nav_style'
export const PUBLIC_NAV_STYLE_COOKIE_MAX_AGE = 365 * 24 * 60 * 60

export function isPublicNavStyle(value: string | undefined): value is PublicNavStyle {
  return Boolean(value && publicNavStyles.includes(value as PublicNavStyle))
}
