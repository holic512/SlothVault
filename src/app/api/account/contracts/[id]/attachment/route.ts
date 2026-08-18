/**
 * @file route.ts
 * @project SlothVault
 * @module Account Contract Attachment API
 * @description Streams one private contract PDF to its assigned user.
 * @logic Authenticate the Web2 session and delegate party plus draft-visibility checks to the contract service.
 * @dependencies user session, HTTP request helpers, contracts service
 * @index_tags api,account,contracts,attachment,authorization,privacy
 * @author holic512
 */
import { requireUserSession } from '@/server/auth/session'
import { defineRoute } from '@/server/http/handler'
import { parseBigIntId } from '@/server/http/request'
import { readAuthorizedContractAttachment } from '@/server/services/contracts'

export const dynamic = 'force-dynamic'
export const runtime = 'nodejs'

export const GET = defineRoute<{ id: string }>(async (request, context) => {
  const session = await requireUserSession(request)
  const { id } = await context.params
  const attachment = await readAuthorizedContractAttachment({
    id: parseBigIntId(id, 'contract id'),
    userId: session.User.id,
    isAdmin: false,
  })
  return new Response(attachment.buffer, {
    headers: {
      'content-type': 'application/pdf',
      'content-disposition': `inline; filename*=UTF-8''${encodeURIComponent(attachment.originalName)}`,
      'cache-control': 'private, no-store',
    },
  })
}, { holdLockUntilBodyClosed: true })
