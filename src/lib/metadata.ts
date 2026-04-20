import en from '../../i18n/locales/en.json'
import zh from '../../i18n/locales/zh.json'

type LocaleMessages = typeof en

const catalogs: Record<string, LocaleMessages> = { en, zh }

function getValue(source: Record<string, unknown>, path: string): string {
  return path.split('.').reduce<unknown>((current, key) => {
    if (current && typeof current === 'object' && key in current) {
      return (current as Record<string, unknown>)[key]
    }
    return ''
  }, source) as string
}

export function buildPageTitle(
  locale: string,
  key: string,
  params?: Record<string, string>,
  withSuffix = true
) {
  const catalog = catalogs[locale] || catalogs.en
  const siteName = getValue(catalog as unknown as Record<string, unknown>, 'PageTitles.siteName')
  let title = getValue(catalog as unknown as Record<string, unknown>, `PageTitles.${key}`) || siteName

  if (params) {
    for (const [paramKey, paramValue] of Object.entries(params)) {
      title = title.replaceAll(`{${paramKey}}`, paramValue)
    }
  }

  return withSuffix ? `${title} - ${siteName}` : title
}
