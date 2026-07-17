import { defineRoute } from '@/server/http/handler'
import { apiOk } from '@/server/http/response'
import { getHomepageContent } from '@/server/services/homepage'

export const dynamic = 'force-dynamic'

export const GET = defineRoute(async () => {
  const content = await getHomepageContent()
  return apiOk({ content })
})
