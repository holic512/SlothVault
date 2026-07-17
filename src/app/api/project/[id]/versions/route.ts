import { defineRoute } from '@/server/http/handler'
import { parseBigIntId } from '@/server/http/request'
import { apiOk } from '@/server/http/response'
import { getProjectVersions } from '@/server/services/public-projects'

export const dynamic = 'force-dynamic'

export const GET = defineRoute<{ id: string }>(async (request, context) => {
  const { id } = await context.params
  return apiOk(await getProjectVersions(request, parseBigIntId(id, 'project id')))
})
