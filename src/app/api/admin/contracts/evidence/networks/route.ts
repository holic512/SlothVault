/**
 * @file route.ts
 * @project SlothVault
 * @module Admin Contract Evidence Networks API
 * @description Lists Mainnet and Devnet availability for administrator-run contract evidence.
 * @logic Restrict infrastructure status to administrators and preserve the distinction between formal and test networks.
 * @dependencies admin session, HTTP helpers, contracts service
 * @index_tags api,admin,contracts,evidence,network,solana
 * @author holic512
 */
import { requireAdminSession } from '@/server/auth/session'
import { defineRoute } from '@/server/http/handler'
import { apiOk } from '@/server/http/response'
import { contractEvidenceNetworks } from '@/server/services/contracts'

export const dynamic = 'force-dynamic'

export const GET = defineRoute(async (request) => {
  await requireAdminSession(request)
  return apiOk({ networks: await contractEvidenceNetworks() })
})
