/**
 * @file route.ts
 * @project SlothVault
 * @module Theme Preference API
 * @description Persists the selected light or dark theme in a first-party cookie for hydration-safe SSR.
 * @logic Validate the requested theme, return the standard API envelope, and write a long-lived same-site cookie.
 * @dependencies next/server, zod, app-theme, server HTTP helpers
 * @index_tags api,theme,cookie,preferences
 * @author holic512
 */

import { NextResponse } from 'next/server'
import { z } from 'zod'

import {
  APP_THEME_COOKIE,
  APP_THEME_COOKIE_MAX_AGE,
  isAppTheme,
} from '@/theme/app-theme'
import { defineRoute } from '@/server/http/handler'
import { readJson } from '@/server/http/request'

const themeSchema = z.object({ theme: z.string() })

export const POST = defineRoute(async (request) => {
  const { theme } = await readJson(request, themeSchema)
  if (!isAppTheme(theme)) {
    return NextResponse.json(
      { code: 400, message: 'Unsupported theme', data: null },
      { status: 400 },
    )
  }

  const response = NextResponse.json({ code: 0, message: 'ok', data: { theme } })
  response.cookies.set(APP_THEME_COOKIE, theme, {
    sameSite: 'lax',
    secure: process.env.NODE_ENV === 'production',
    path: '/',
    maxAge: APP_THEME_COOKIE_MAX_AGE,
  })
  return response
})
