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
import { downloadCommissionFile } from '@/server/commissions/files'
export const runtime = 'nodejs'
export const GET = defineRoute<{ id: string; fileId: string }>(async (request, context) => { const p = await context.params; return downloadCommissionFile(parseBigIntId(p.id), parseBigIntId(p.fileId), await commissionActor(request, false)) }, { holdLockUntilBodyClosed: true })
