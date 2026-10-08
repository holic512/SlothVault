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
import { readJson } from '@/server/http/request'
import { apiOk } from '@/server/http/response'
import { getCommissionSettings, saveCommissionSettings } from '@/server/commissions/service'
import { settingsInput } from '@/server/commissions/input'
export const GET = defineRoute(async (request) => { await requireAdminSession(request); return apiOk(await getCommissionSettings()) })
export const PUT = defineRoute(async (request) => { await requireAdminSession(request); return apiOk(await saveCommissionSettings(await readJson(request, settingsInput, { maxBytes: 50000 }))) })
