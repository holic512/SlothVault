import { defineRoute } from '@/server/http/handler'
import { parseBigIntId } from '@/server/http/request'
import { apiOk } from '@/server/http/response'
import { getProjectSidebar } from '@/server/services/public-projects'

export const dynamic = 'force-dynamic'

export const GET = defineRoute<{ id: string; versionId: string }>(async (_request, context) => {
  const { id, versionId } = await context.params
  return apiOk(
    await getProjectSidebar(
      parseBigIntId(id, 'project id'),
      parseBigIntId(versionId, 'version id'),
    ),
  )
})
