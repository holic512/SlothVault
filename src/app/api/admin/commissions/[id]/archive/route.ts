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
import { commissionActor } from '@/server/commissions/http'
import { commissionArchive } from '@/server/commissions/files'
export const runtime = 'nodejs'
export const GET = defineRoute<{ id: string }>(async (request, context) => commissionArchive(parseBigIntId((await context.params).id), await commissionActor(request, true), request.nextUrl.searchParams.has('deliveryId') ? parseBigIntId(request.nextUrl.searchParams.get('deliveryId') || undefined) : undefined), { holdLockUntilBodyClosed: true })
