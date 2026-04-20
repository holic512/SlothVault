import type { ReadonlyRequestCookies } from 'next/dist/server/web/spec-extension/adapters/request-cookies'

import en from '../../i18n/locales/en.json'
import zh from '../../i18n/locales/zh.json'

export const DEFAULT_LOCALE = 'en'
export const SUPPORTED_LOCALES = ['en', 'zh'] as const

export type AppLocale = (typeof SUPPORTED_LOCALES)[number]

const messagesMap = {
  en,
  zh
} as const

export async function resolveLocale(cookieStore: ReadonlyRequestCookies): Promise<AppLocale> {
  const locale = cookieStore.get('sloth-locale')?.value
  if (locale && SUPPORTED_LOCALES.includes(locale as AppLocale)) {
    return locale as AppLocale
  }
  return DEFAULT_LOCALE
}

export async function getMessages(locale: AppLocale) {
  return messagesMap[locale]
}
