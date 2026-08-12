/**
 * @file route.ts
 * @project SlothVault
 * @module Admin Evidence Network Test API
 * @description Tests primary and fallback RPC endpoints for fixed Solana evidence profiles.
 * @logic Authenticate, validate the optional target network, run bounded endpoint probes, and persist safe health summaries.
 * @dependencies admin session, zod, release-evidence service
 * @index_tags api,admin,evidence,network,health
 * @author holic512
 */
import { z } from 'zod'

import { requireAdminSession } from '@/server/auth/session'
import { defineRoute } from '@/server/http/handler'
import { readJson } from '@/server/http/request'
import { apiOk } from '@/server/http/response'
import { testReleaseEvidenceNetworks } from '@/server/services/release-evidence'

const schema = z.object({ network: z.enum(['mainnet', 'devnet']).optional() })

export const dynamic = 'force-dynamic'

export const POST = defineRoute(async (request) => {
  await requireAdminSession(request)
  const body = await readJson(request, schema)
  return apiOk(await testReleaseEvidenceNetworks(body.network))
})
