/**
 * @file route.ts
 * @project SlothVault
 * @module Admin Authentication API
 * @description Reports whether an administrator account already exists.
 * @logic Delegate the public existence check to the authentication service and wrap the stable API response.
 * @dependencies server/http/handler, admin authentication service
 * @index_tags api,admin,authentication,existence-check
 * @author holic512
 */
import { defineRoute } from '@/server/http/handler'
import { apiOk } from '@/server/http/response'
import { hasAdminAccount } from '@/server/services/admin-auth'

export const dynamic = 'force-dynamic'

export const GET = defineRoute(async () => {
  return apiOk({ exists: await hasAdminAccount() })
})
