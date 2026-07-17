/**
 * @file route.ts
 * @project SlothVault
 * @module Admin Solana Tree Delete API
 * @description Soft-deletes a creating or failed Merkle Tree record that has no related cNFT rows.
 * @logic Authenticate, parse the decimal identifier, enforce the service's immutable-chain deletion rules, and return a stable envelope.
 * @dependencies admin session, admin-solana-trees service
 * @index_tags api,admin,solana,merkle-tree,delete
 * @author holic512
 */
import { requireAdminSession } from '@/server/auth/session'
import { HttpError } from '@/server/http/errors'
import { defineRoute } from '@/server/http/handler'
import { parseBigIntId } from '@/server/http/request'
import { apiOk } from '@/server/http/response'
import { deleteMerkleTree } from '@/server/services/admin-solana-trees'

export const dynamic = 'force-dynamic'

export const DELETE = defineRoute<{ id: string }>(async (request, context) => {
  await requireAdminSession(request)
  const id = parseBigIntId((await context.params).id, 'tree id')
  if (id <= 0n) throw new HttpError('Invalid tree id', 400, 400)
  return apiOk(await deleteMerkleTree(id), 'Merkle Tree record deleted')
})

