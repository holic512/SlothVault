/**
 * @file route.ts
 * @project SlothVault
 * @module Admin Contract Attachment API
 * @description Uploads one private PDF that may later be frozen as a contract attachment.
 * @logic Require an administrator, apply the shared managed-file validation, and never expose a public upload URL.
 * @dependencies admin session, HTTP helpers, admin-files service
 * @index_tags api,admin,contracts,attachment,upload,pdf
 * @author holic512
 */
import { requireAdminSession } from '@/server/auth/session'
import { defineRoute } from '@/server/http/handler'
import { apiOk } from '@/server/http/response'
import { uploadAdminFiles } from '@/server/services/admin-files'

export const dynamic = 'force-dynamic'
export const runtime = 'nodejs'

export const POST = defineRoute(async (request) => {
  await requireAdminSession(request)
  const [file] = await uploadAdminFiles(request, { businessType: 'ContractAttachment', maxFiles: 1 })
  return apiOk(file, 'uploaded', 201)
})
