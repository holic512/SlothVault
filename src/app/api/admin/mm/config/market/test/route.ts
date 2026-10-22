/**
 * @file route.ts
 * @project SlothVault
 * @module Market Source Probe API
 * @description Tests one saved system price source for administrators.
 * @logic Authenticate and bound each independent read-only probe.
 * @dependencies session, market-data, HTTP handlers
 * @index_tags admin,market,probe
 * @author holic512
 */
import { z } from 'zod'
import { requireAdminSession } from '@/server/auth/session'
import { defineRoute } from '@/server/http/handler'
import { readJson } from '@/server/http/request'
import { apiOk } from '@/server/http/response'
import { probeMarketSource } from '@/server/services/market-data'
export const POST = defineRoute(async request => {
  await requireAdminSession(request)
  const { source } = await readJson(request, z.object({ source: z.enum(['primary', 'fallback']) }).strict())
  return apiOk(await probeMarketSource(source, request.signal))
}, { lockMode: 'shared', cacheControl: 'no-store' })
