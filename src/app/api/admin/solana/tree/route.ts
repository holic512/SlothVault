/**
 * @file route.ts
 * @project SlothVault
 * @module Admin Solana Tree List API
 * @description Lists non-deleted Merkle Tree records for the optional requested network.
 * @logic Authenticate the administrator, validate the query enum, and return client-safe decimal identifiers without encrypted keys.
 * @dependencies admin session, admin-solana-trees service
 * @index_tags api,admin,solana,merkle-tree,list
 * @author holic512
 */
import { HttpError } from '@/server/http/errors'
import { requireAdminSession } from '@/server/auth/session'
import { defineRoute } from '@/server/http/handler'
import { apiOk } from '@/server/http/response'
import { listMerkleTrees } from '@/server/services/admin-solana-trees'
import type { SolanaNetwork } from '@/server/services/system-config'

export const dynamic = 'force-dynamic'

export const GET = defineRoute(async (request) => {
  await requireAdminSession(request)
  const rawNetwork = request.nextUrl.searchParams.get('network')
  if (rawNetwork && rawNetwork !== 'mainnet' && rawNetwork !== 'devnet') {
    throw new HttpError('Invalid network', 400, 400)
  }
  return apiOk(await listMerkleTrees((rawNetwork || undefined) as SolanaNetwork | undefined))
})

