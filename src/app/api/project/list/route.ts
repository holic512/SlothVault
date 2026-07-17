import { defineRoute } from '@/server/http/handler'
import { apiOk } from '@/server/http/response'
import { listPublicProjects } from '@/server/services/public-projects'

export const dynamic = 'force-dynamic'

export const GET = defineRoute(async () => apiOk(await listPublicProjects()))
