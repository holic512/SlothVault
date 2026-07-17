import { defineRoute } from '@/server/http/handler'
import { apiOk } from '@/server/http/response'
import { prisma } from '@/server/prisma'

export const dynamic = 'force-dynamic'

export const GET = defineRoute(async () => {
  const adminCount = await prisma.user.count()
  return apiOk({ exists: adminCount > 0 })
})
