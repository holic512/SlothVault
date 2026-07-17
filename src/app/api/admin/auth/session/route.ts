import { requireAdminSession } from '@/server/auth/session'
import { defineRoute } from '@/server/http/handler'
import { apiOk } from '@/server/http/response'

export const dynamic = 'force-dynamic'

export const GET = defineRoute(async (request) => {
  const session = await requireAdminSession(request)
  return apiOk({
    id: session.User.id,
    username: session.User.username,
    email: session.User.email,
    expiresAt: session.expiresAt,
  })
})
