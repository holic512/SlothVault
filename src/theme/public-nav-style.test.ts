import { describe, expect, it } from 'vitest'

import {
  DEFAULT_PUBLIC_NAV_STYLE,
  isPublicNavStyle,
  publicNavStyles,
  PUBLIC_NAV_STYLE_COOKIE,
} from '@/theme/public-nav-style'

describe('public navigation appearance contract', () => {
  it('keeps the existing navigation surface as the default', () => {
    expect(DEFAULT_PUBLIC_NAV_STYLE).toBe('standard')
    expect(PUBLIC_NAV_STYLE_COOKIE).toBe('sv_public_nav_style')
    expect(publicNavStyles).toEqual(['standard', 'liquid-glass'])
  })

  it('accepts only supported navigation appearances', () => {
    expect(isPublicNavStyle('standard')).toBe(true)
    expect(isPublicNavStyle('liquid-glass')).toBe(true)
    expect(isPublicNavStyle('liquid')).toBe(false)
    expect(isPublicNavStyle(undefined)).toBe(false)
  })
})
