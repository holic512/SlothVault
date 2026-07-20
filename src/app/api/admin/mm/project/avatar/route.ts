/**
 * @file route.ts
 * @project SlothVault
 * @module Admin Project Avatar API
 * @description Uploads one verified project avatar for an authenticated administrator.
 * @logic Authenticate the multipart request and delegate bounded image validation, persistence, and legacy DTO mapping to the file service.
 * @dependencies admin session, HTTP route helpers, sharp-backed admin file storage service
 * @index_tags api,admin,project,avatar,upload,image-validation
 * @author holic512
 */
import { requireAdminSession } from '@/server/auth/session'
import { defineRoute } from '@/server/http/handler'
import { apiOk } from '@/server/http/response'
import { uploadAdminProjectAvatar } from '@/server/services/admin-files'

export const dynamic = 'force-dynamic'
export const runtime = 'nodejs'

export const POST = defineRoute(async (request) => {
  await requireAdminSession(request)
  return apiOk(await uploadAdminProjectAvatar(request))
})
