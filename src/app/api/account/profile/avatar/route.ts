/**
 * @file route.ts
 * @project SlothVault
 * @module Account Avatar API
 * @description Uploads or removes the current user's managed profile avatar without accepting external image URLs.
 * @logic Require the user's session, store one validated UserAvatar file through the shared upload service, update only that user's avatar reference, and preserve prior files for audit and recovery.
 * @dependencies session service, HTTP route helpers, user-auth, admin-files upload service
 * @index_tags api,account,profile,avatar,upload,user-files
 * @author holic512
 */
import { requireUserSession } from '@/server/auth/session'
import { defineRoute } from '@/server/http/handler'
import { apiOk } from '@/server/http/response'
import { uploadUserAvatar } from '@/server/services/admin-files'
import { updateUserAvatar } from '@/server/services/user-auth'

export const dynamic = 'force-dynamic'
export const runtime = 'nodejs'

export const POST = defineRoute(async (request) => {
  const session = await requireUserSession(request)
  const avatar = await uploadUserAvatar(request)
  return apiOk(await updateUserAvatar(session.userId, avatar.url), 'avatar uploaded', 201)
})

export const DELETE = defineRoute(async (request) => {
  const session = await requireUserSession(request)
  return apiOk(await updateUserAvatar(session.userId, null), 'avatar removed')
})
