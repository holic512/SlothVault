/**
 * @file route.ts
 * @project SlothVault
 * @module Admin Solana Network API
 * @description Reads and updates the active Solana network for the administration console.
 * @logic Require an administrator session, validate the supported network enum, and persist the current value in PostgreSQL.
 * @dependencies admin session, admin-solana-trees service
 * @index_tags api,admin,solana,network
 * @author holic512
 */
import { z } from 'zod'

import { requireAdminSession } from '@/server/auth/session'
import { defineRoute } from '@/server/http/handler'
import { readJson } from '@/server/http/request'
import { apiOk } from '@/server/http/response'
import {
  readAdminSolanaNetwork,
  updateAdminSolanaNetwork,
} from '@/server/services/admin-solana-trees'

const updateNetworkSchema = z.object({ network: z.enum(['mainnet', 'devnet']) })

export const dynamic = 'force-dynamic'

export const GET = defineRoute(async (request) => {
  await requireAdminSession(request)
  return apiOk(await readAdminSolanaNetwork())
})

export const PUT = defineRoute(async (request) => {
  await requireAdminSession(request)
  const body = await readJson(request, updateNetworkSchema)
  const result = await updateAdminSolanaNetwork(body.network)
  return apiOk(result, `Switched to ${body.network}`)
})

