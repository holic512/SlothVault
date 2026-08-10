/**
 * @file route.ts
 * @project SlothVault
 * @module Style Preference API
 * @description Persists the selected visual style in a first-party cookie for hydration-safe SSR.
 * @logic Validate the requested style, return the standard API envelope, and write a long-lived same-site cookie.
 * @dependencies next/server, zod, app-style, server HTTP helpers
 * @index_tags api,style,cookie,preferences
 * @author holic512
 */

import { NextResponse } from 'next/server'
import { z } from 'zod'

import {
  APP_STYLE_COOKIE,
  APP_STYLE_COOKIE_MAX_AGE,
  isAppStyle,
} from '@/theme/app-style'
import { defineRoute } from '@/server/http/handler'
import { readJson } from '@/server/http/request'

const styleSchema = z.object({ style: z.string() })

export const POST = defineRoute(async (request) => {
  const { style } = await readJson(request, styleSchema)
  if (!isAppStyle(style)) {
    return NextResponse.json(
      { code: 400, message: 'Unsupported style', data: null },
      { status: 400 },
    )
  }

  const response = NextResponse.json({ code: 0, message: 'ok', data: { style } })
  response.cookies.set(APP_STYLE_COOKIE, style, {
    sameSite: 'lax',
    secure: process.env.NODE_ENV === 'production',
    path: '/',
    maxAge: APP_STYLE_COOKIE_MAX_AGE,
  })
  return response
})
