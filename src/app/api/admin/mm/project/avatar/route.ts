/**
 * @file route.ts
 * @project SlothVault
 * @module Admin Project Avatar API
 * @description Uploads one verified project avatar for an authenticated administrator.
 * @logic Reject oversized requests, require exactly one decodable image no larger than 2 MiB, and preserve the legacy single-object response DTO.
 * @dependencies admin session, HTTP route helpers, sharp-backed admin file storage service
 * @index_tags api,admin,project,avatar,upload,image-validation
 * @author holic512
 */
import { requireAdminSession } from '@/server/auth/session'
import { defineRoute } from '@/server/http/handler'
import { apiOk } from '@/server/http/response'
import {
  avatarFileDto,
  uploadFiles,
} from '@/server/services/admin-files'

export const dynamic = 'force-dynamic'
export const runtime = 'nodejs'

export const POST = defineRoute(async (request) => {
  await requireAdminSession(request)
  const [file] = await uploadFiles(request, {
    businessType: 'ProjectAvatar',
    maxFiles: 1,
  })
  return apiOk(avatarFileDto(file))
})
