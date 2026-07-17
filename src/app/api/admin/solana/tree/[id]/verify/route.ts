/**
 * @file route.ts
 * @project SlothVault
 * @module Admin Solana Tree Verify API
 * @description Verifies a stored Merkle Tree against its configured Solana network.
 * @logic Authenticate, validate the identifier, check program ownership and tree dimensions, then synchronize the local status.
 * @dependencies admin session, admin-solana-trees service
 * @index_tags api,admin,solana,merkle-tree,verify
 * @author holic512
 */
import { requireAdminSession } from '@/server/auth/session'
import { HttpError } from '@/server/http/errors'
import { defineRoute } from '@/server/http/handler'
import { parseBigIntId } from '@/server/http/request'
import { apiOk } from '@/server/http/response'
import { verifyMerkleTree } from '@/server/services/admin-solana-trees'

export const dynamic = 'force-dynamic'

export const POST = defineRoute<{ id: string }>(async (request, context) => {
  await requireAdminSession(request)
  const id = parseBigIntId((await context.params).id, 'tree id')
  if (id <= 0n) throw new HttpError('Invalid tree id', 400, 400)
  return apiOk(await verifyMerkleTree(id))
})

