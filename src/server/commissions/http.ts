/**
 * @file http.ts
 * @project SlothVault
 * @module Commission HTTP Adapters
 * @description Binds the authenticated administrator or customer to bounded commission APIs.
 * @logic Derive actor identity from the session and share identical domain commands across both workspace route families.
 * @dependencies auth sessions, HTTP request helpers, commission services
 * @index_tags commissions,api,authentication,adapters
 * @author holic512
 */
import 'server-only'
import type { NextRequest } from 'next/server'
import { requireAdminSession, requireUserSession } from '@/server/auth/session'
import { readJson, requestClientIp } from '@/server/http/request'
import { apiOk } from '@/server/http/response'
import { commissionCommandInput, createCommissionInput, documentDraftInput } from './input'
import { createCommission, executeCommissionCommand, getCommission, listCommissions } from './service'
import { createCommissionDocument } from './documents'
export async function commissionActor(request: NextRequest, admin: boolean) {
  const session = await (admin ? requireAdminSession(request) : requireUserSession(request))
  return { userId: session.User.id, isAdmin: admin, sessionId: session.id, ip: requestClientIp(request), userAgent: request.headers.get('user-agent') }
}
export async function commissionsList(request: NextRequest, admin: boolean) {
  const actor = await commissionActor(request, admin), query = request.nextUrl.searchParams
  const integer = (value: string | null, fallback: number, max: number) => { const parsed = Number(value); return Number.isSafeInteger(parsed) && parsed > 0 ? Math.min(parsed, max) : fallback }
  return apiOk(await listCommissions(actor, { page: integer(query.get('page'), 1, 100000), pageSize: integer(query.get('pageSize'), 20, 50), keyword: query.get('keyword')?.trim().slice(0, 255), stage: query.get('stage') || undefined }))
}
export async function commissionsCreate(request: NextRequest, admin: boolean) {
  const actor = await commissionActor(request, admin)
  return apiOk(await createCommission(actor, await readJson(request, createCommissionInput, { maxBytes: 100000 })), 'created', 201)
}
export async function commissionRead(request: NextRequest, admin: boolean, id: number) { return apiOk(await getCommission(id, await commissionActor(request, admin))) }
export async function commissionCommand(request: NextRequest, admin: boolean, id: number) {
  return apiOk(await executeCommissionCommand(id, await commissionActor(request, admin), await readJson(request, commissionCommandInput, { maxBytes: 200000 })))
}
export async function commissionDocumentDraft(request: NextRequest, id: number) { return apiOk(await createCommissionDocument(id, await commissionActor(request, true), await readJson(request, documentDraftInput, { maxBytes: 500000 })), 'created', 201) }
