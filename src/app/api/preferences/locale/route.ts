import { NextResponse } from 'next/server'
import { z } from 'zod'

import { isAppLocale, LOCALE_COOKIE } from '@/i18n/request'
import { defineRoute } from '@/server/http/handler'
import { readJson } from '@/server/http/request'

const localeSchema = z.object({ locale: z.string() })

export const POST = defineRoute(async (request) => {
  const { locale } = await readJson(request, localeSchema)
  if (!isAppLocale(locale)) {
    return NextResponse.json(
      { code: 400, message: 'Unsupported locale', data: null },
      { status: 400 },
    )
  }

  const response = NextResponse.json({ code: 0, message: 'ok', data: { locale } })
  response.cookies.set(LOCALE_COOKIE, locale, {
    sameSite: 'lax',
    secure: process.env.NODE_ENV === 'production',
    path: '/',
    maxAge: 365 * 24 * 60 * 60,
  })
  return response
})
