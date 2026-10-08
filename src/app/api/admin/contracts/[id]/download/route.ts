/**
 * @file route.ts
 * @project SlothVault
 * @module Authorized Contract Markdown Download
 * @description Exports a frozen body followed by separate account confirmation records.
 * @logic Authorize through the contract boundary and append confirmations without changing the body.
 * @dependencies contract service, session, HTTP helpers
 * @index_tags contracts,markdown,download,authorization
 * @author holic512
 */
import { requireAdminSession } from '@/server/auth/session'
import { commissionDocumentMarkdown } from '@/lib/commission-document-export'
import { defineRoute } from '@/server/http/handler'
import { parseBigIntId } from '@/server/http/request'
import { getAdminContract } from '@/server/services/contracts'
export const GET = defineRoute<{ id: string }>(async (request, context) => {
  await requireAdminSession(request)
  const id = parseBigIntId((await context.params).id), document = await getAdminContract(id)
  const body = commissionDocumentMarkdown(document)
  return new Response(body, { headers: { 'Content-Type': 'text/markdown; charset=utf-8', 'Content-Disposition': `attachment; filename*=UTF-8''${encodeURIComponent(document.title + '.md')}`, 'Cache-Control': 'private, no-store', 'X-Content-Type-Options': 'nosniff' } })
})
