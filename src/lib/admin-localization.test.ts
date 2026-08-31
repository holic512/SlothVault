import type { useTranslations } from 'next-intl'
import { describe, expect, it } from 'vitest'

import {
  formatAdminBytes,
  formatAdminDate,
  formatAdminError,
  formatAdminNumber,
} from '@/lib/admin-localization'
import { ApiClientError } from '@/lib/api-client'

const translate = ((key: string) => `translated:${key}`) as unknown as ReturnType<typeof useTranslations<'AdminMM.errors'>>

describe('administration localization utilities', () => {
  it('formats numeric, byte, and date values through the active locale', () => {
    const value = new Date('2026-08-10T12:30:00.000Z')

    expect(formatAdminNumber('zh', 1234567)).toBe(new Intl.NumberFormat('zh-CN').format(1234567))
    expect(formatAdminNumber('en', 1234567)).toBe(new Intl.NumberFormat('en-US').format(1234567))
    expect(formatAdminBytes('zh', 1536)).toBe('1.5 KB')
    expect(formatAdminBytes('en', 1536)).toBe('1.5 KB')
    expect(formatAdminDate('zh', value)).toBe(new Intl.DateTimeFormat('zh-CN', { dateStyle: 'medium', timeStyle: 'short' }).format(value))
    expect(formatAdminDate('en', value)).toBe(new Intl.DateTimeFormat('en-US', { dateStyle: 'medium', timeStyle: 'short' }).format(value))
  })

  it('maps known API failures and keeps unknown failures safe', () => {
    expect(formatAdminError(new ApiClientError('Unauthorized', 401, 401, null), translate)).toBe('translated:unauthorized')
    expect(formatAdminError(new ApiClientError('Unmapped service detail', 400, 400, null), translate)).toBe('translated:generic')
    expect(formatAdminError(new Error('sensitive upstream detail'), translate)).toBe('translated:generic')
  })
})
