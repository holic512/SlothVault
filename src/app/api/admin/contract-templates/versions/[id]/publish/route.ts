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
import { requireAdminSession } from '@/server/auth/session'
import { defineRoute } from '@/server/http/handler'
import { parseBigIntId } from '@/server/http/request'
import { apiOk } from '@/server/http/response'
import { publishTemplateVersion } from '@/server/commissions/templates'
export const POST = defineRoute<{ id: string }>(async (request, context) => { await requireAdminSession(request); return apiOk(await publishTemplateVersion(parseBigIntId((await context.params).id))) })
