import { defineRoute } from '@/server/http/handler'
import { resolvePublicProjectIds } from '@/server/services/public-content-ids'
import { apiOk } from '@/server/http/response'
import { getProjectSidebar } from '@/server/services/public-projects'

export const dynamic = 'force-dynamic'

export const GET = defineRoute<{ id: string; versionId: string }>(async (_request, context) => {
  const { projectId, versionId } = await resolvePublicProjectIds(await context.params)
  return apiOk(
    await getProjectSidebar(
      projectId,
      versionId!,
    ),
  )
})
