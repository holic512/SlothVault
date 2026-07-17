/**
 * @file request.ts
 * @project SlothVault
 * @module Internationalization
 * @description Resolves the request locale from a first-party cookie without changing public URLs.
 * @logic Validate the locale cookie, load the matching message catalog, and fall back to English.
 * @dependencies next-intl, next/headers, messages/*.json
 * @index_tags i18n,locale,cookie,next-intl
 * @author holic512
 */
import { cookies } from 'next/headers'
import { getRequestConfig } from 'next-intl/server'

export const locales = ['en', 'zh'] as const
export type AppLocale = (typeof locales)[number]
export const DEFAULT_LOCALE: AppLocale = 'en'
export const LOCALE_COOKIE = 'sv_locale'

export function isAppLocale(value: string | undefined): value is AppLocale {
  return Boolean(value && locales.includes(value as AppLocale))
}

export default getRequestConfig(async () => {
  const cookieStore = await cookies()
  const cookieLocale = cookieStore.get(LOCALE_COOKIE)?.value
  const locale = isAppLocale(cookieLocale) ? cookieLocale : DEFAULT_LOCALE
  const messages = (await import(`../../messages/${locale}.json`)).default

  return {
    locale,
    messages,
  }
})
