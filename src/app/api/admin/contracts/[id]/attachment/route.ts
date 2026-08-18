/**
 * @file route.ts
 * @project SlothVault
 * @module Admin Contract Attachment Download API
 * @description Streams a private contract PDF only to an authenticated administrator.
 * @logic Resolve the contract through the authorization service and return its managed bytes without exposing a reusable public path.
 * @dependencies admin session, HTTP helpers, contracts service
 * @index_tags api,admin,contracts,attachment,download,authorization
 * @author holic512
 */
import { requireAdminSession } from '@/server/auth/session'
import { defineRoute } from '@/server/http/handler'
import { parseBigIntId } from '@/server/http/request'
import { readAuthorizedContractAttachment } from '@/server/services/contracts'

export const dynamic = 'force-dynamic'
export const runtime = 'nodejs'

export const GET = defineRoute<{ id: string }>(async (request, context) => {
  const session = await requireAdminSession(request)
  const { id } = await context.params
  const attachment = await readAuthorizedContractAttachment({
    id: parseBigIntId(id, 'contract id'),
    userId: session.User.id,
    isAdmin: true,
  })
  return new Response(attachment.buffer, {
    headers: {
      'content-type': 'application/pdf',
      'content-disposition': `inline; filename*=UTF-8''${encodeURIComponent(attachment.originalName)}`,
      'cache-control': 'private, no-store',
    },
  })
}, { holdLockUntilBodyClosed: true })
