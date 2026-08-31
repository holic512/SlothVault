/**
 * @file route.ts
 * @project SlothVault
 * @module Admin System Branding API
 * @description Uploads a managed system logo and can atomically create a derived favicon ICO beside it.
 * @logic Authenticate the administrator, require an explicit sync choice, and delegate bounded multipart persistence to the branding file service.
 * @dependencies admin session, server/http helpers, admin file storage service
 * @index_tags api,admin,branding,logo,favicon,ico,multipart
 * @author holic512
 */
import { requireAdminSession } from '@/server/auth/session'
import { HttpError } from '@/server/http/errors'
import { defineRoute } from '@/server/http/handler'
import { apiOk } from '@/server/http/response'
import { uploadSystemLogo } from '@/server/services/admin-files'

export const dynamic = 'force-dynamic'
export const runtime = 'nodejs'

export const POST = defineRoute(async (request) => {
  await requireAdminSession(request)
  const syncFavicon = request.nextUrl.searchParams.get('syncFavicon')
  if (syncFavicon !== 'true' && syncFavicon !== 'false') {
    throw new HttpError('syncFavicon must be true or false', 400, 400)
  }
  return apiOk(
    await uploadSystemLogo(request, syncFavicon === 'true'),
    'uploaded',
    201,
  )
})
