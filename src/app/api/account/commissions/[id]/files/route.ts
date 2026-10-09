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
import { apiOk } from '@/server/http/response'
import { commissionActor } from '@/server/commissions/http'
import { uploadCommissionFile } from '@/server/commissions/workflow-files'
export const runtime = 'nodejs'
export const POST = defineRoute<{ id: string }>(async (request, context) => {
 const query = request.nextUrl.searchParams
 return apiOk(await uploadCommissionFile(parseBigIntId((await context.params).id), await commissionActor(request, false), request, { name: query.get('name') || '', purpose: query.get('purpose') || '', shared: query.get('shared') === 'true', commandId: query.get('commandId') || '' }))
}, { lockMode: 'shared' })
