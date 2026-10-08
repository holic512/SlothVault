/**
 * @file route.ts
 * @project SlothVault
 * @module Private Commission API
 * @description Provides authenticated commission lifecycle or protected artifact access.
 * @logic Bind the session actor, validate the owned commission, and delegate to transactional domain services.
 * @dependencies commission services, authentication, HTTP adapters
 * @index_tags api,commissions,privacy,lifecycle
 * @author holic512
 */
import { defineRoute } from '@/server/http/handler'
import { commissionsList, commissionsCreate } from '@/server/commissions/http'
export const dynamic = 'force-dynamic'
export const GET = defineRoute(async (request) => commissionsList(request, false))
export const POST = defineRoute(async (request) => commissionsCreate(request, false))
