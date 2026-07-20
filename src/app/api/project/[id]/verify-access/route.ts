/**
 * @file route.ts
 * @project SlothVault
 * @module Legacy Public Access API
 * @description Preserves the former wallet-access endpoint while reporting that every published collection is publicly readable.
 * @logic Validate the project identifier and existence, ignore legacy wallet payloads, and return a stable unconditional public-access decision.
 * @dependencies HTTP route helpers, public-projects service
 * @index_tags api,compatibility,public-reading,no-wallet
 * @author holic512
 */
import { defineRoute } from '@/server/http/handler'
import { parseBigIntId } from '@/server/http/request'
import { apiOk } from '@/server/http/response'
import { getPublicProject } from '@/server/services/public-projects'

export const POST = defineRoute<{ id: string }>(async (_request, context) => {
  const { id } = await context.params
  const projectId = parseBigIntId(id, 'project id')
  await getPublicProject(projectId)
  return apiOk({
    hasAccess: true,
    reason: 'Published content is public',
    requireAuth: false,
  })
})
