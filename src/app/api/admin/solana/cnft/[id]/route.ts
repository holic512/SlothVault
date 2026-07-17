/**
 * @file route.ts
 * @project SlothVault
 * @module Admin Solana cNFT Delete API
 * @description Deletes only terminally failed local cNFT attempts.
 * @logic Authenticate, validate the identifier, reconcile pending chain state, reject prepared/submitted/successful attempts, and delete only a confirmed failed local row without touching chain state.
 * @dependencies admin session, admin-solana-cnfts service
 * @index_tags api,admin,solana,cnft,delete,reconciliation,terminal-state
 * @author holic512
 */
import { requireAdminSession } from '@/server/auth/session'
import { HttpError } from '@/server/http/errors'
import { defineRoute } from '@/server/http/handler'
import { parseBigIntId } from '@/server/http/request'
import { apiOk } from '@/server/http/response'
import { deleteCnft } from '@/server/services/admin-solana-cnfts'

export const dynamic = 'force-dynamic'

export const DELETE = defineRoute<{ id: string }>(async (request, context) => {
  await requireAdminSession(request)
  const id = parseBigIntId((await context.params).id, 'cNFT id')
  if (id <= 0n) throw new HttpError('Invalid cNFT id', 400, 400)
  return apiOk(await deleteCnft(id), 'cNFT record deleted')
})
