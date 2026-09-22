/**
 * @file route.ts
 * @project SlothVault
 * @module Public Navigation Appearance Preference API
 * @description Persists the selected public top-navigation appearance in a first-party cookie for hydration-safe SSR.
 * @logic Validate the requested appearance, return the standard API envelope, and write a long-lived same-site cookie.
 * @dependencies next/server, zod, public-nav-style, server HTTP helpers
 * @index_tags api,public-nav,appearance,cookie,preferences,liquid-glass
 * @author holic512
 */

import { NextResponse } from 'next/server'
import { z } from 'zod'

import {
  isPublicNavStyle,
  PUBLIC_NAV_STYLE_COOKIE,
  PUBLIC_NAV_STYLE_COOKIE_MAX_AGE,
} from '@/theme/public-nav-style'
import { defineRoute } from '@/server/http/handler'
import { readJson } from '@/server/http/request'

const publicNavStyleSchema = z.object({ publicNavStyle: z.string() })

export const POST = defineRoute(async (request) => {
  const { publicNavStyle } = await readJson(request, publicNavStyleSchema)
  if (!isPublicNavStyle(publicNavStyle)) {
    return NextResponse.json(
      { code: 400, message: 'Unsupported public navigation appearance', data: null },
      { status: 400 },
    )
  }

  const response = NextResponse.json({ code: 0, message: 'ok', data: { publicNavStyle } })
  response.cookies.set(PUBLIC_NAV_STYLE_COOKIE, publicNavStyle, {
    sameSite: 'lax',
    secure: process.env.NODE_ENV === 'production',
    path: '/',
    maxAge: PUBLIC_NAV_STYLE_COOKIE_MAX_AGE,
  })
  return response
})
