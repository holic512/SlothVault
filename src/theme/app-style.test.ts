import { describe, expect, it } from 'vitest'

import {
  APP_STYLE_COOKIE,
  DEFAULT_APP_STYLE,
  appStyles,
  isAppStyle,
} from '@/theme/app-style'

describe('application style contract', () => {
  it('keeps monochrome editorial styling as the default', () => {
    expect(DEFAULT_APP_STYLE).toBe('mono')
    expect(APP_STYLE_COOKIE).toBe('sv_style')
    expect(appStyles).toEqual(['mono', 'saas'])
  })

  it('accepts only supported visual styles', () => {
    expect(isAppStyle('mono')).toBe(true)
    expect(isAppStyle('saas')).toBe(true)
    expect(isAppStyle('dark')).toBe(false)
    expect(isAppStyle(undefined)).toBe(false)
  })
})
