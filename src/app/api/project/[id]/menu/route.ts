import { defineRoute } from '@/server/http/handler'
import { parseBigIntId } from '@/server/http/request'
import { apiOk } from '@/server/http/response'
import { getProjectMenu } from '@/server/services/public-projects'

export const dynamic = 'force-dynamic'

export const GET = defineRoute<{ id: string }>(async (_request, context) => {
  const { id } = await context.params
  return apiOk(await getProjectMenu(parseBigIntId(id, 'project id')))
})
