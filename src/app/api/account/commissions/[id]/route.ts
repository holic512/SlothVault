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
import { parseBigIntId } from '@/server/http/request'
import { commissionRead, commissionCommand } from '@/server/commissions/http'
export const dynamic = 'force-dynamic'
export const GET = defineRoute<{ id: string }>(async (request, context) => commissionRead(request, false, parseBigIntId((await context.params).id)))
export const POST = defineRoute<{ id: string }>(async (request, context) => commissionCommand(request, false, parseBigIntId((await context.params).id)))
