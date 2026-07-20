/**
 * @file route.ts
 * @project SlothVault
 * @module Admin Solana cNFT List API
 * @description Reconciles pending cNFT attempts and lists records with project and Merkle Tree presentation data.
 * @logic Authenticate, take the exclusive state lock because reconciliation may write, parse bounded filters/pagination, reconcile up to 25 pending signatures, and return the React console's stable list contract.
 * @dependencies admin session, admin-solana-cnfts service
 * @index_tags api,admin,solana,cnft,list,pagination
 * @author holic512
 */
import { requireAdminSession } from '@/server/auth/session'
import { HttpError } from '@/server/http/errors'
import { defineRoute } from '@/server/http/handler'
import { apiOk } from '@/server/http/response'
import { listCnfts } from '@/server/services/admin-solana-cnfts'
import type { SolanaNetwork } from '@/server/services/system-config'

function optionalId(value: string | null, label: string) {
  if (!value) return undefined
  if (!/^[1-9]\d*$/.test(value)) throw new HttpError(`Invalid ${label}`, 400, 400)
  const id = Number(value)
  if (!Number.isSafeInteger(id) || id > 2_147_483_647) {
    throw new HttpError(`Invalid ${label}`, 400, 400)
  }
  return id
}

function boundedInteger(value: string | null, fallback: number, min: number, max: number) {
  if (!value) return fallback
  if (!/^-?\d+$/.test(value)) throw new HttpError('Invalid numeric query value', 400, 400)
  const parsed = Number(value)
  if (!Number.isSafeInteger(parsed) || parsed < min || parsed > max) {
    throw new HttpError('Numeric query value is out of range', 400, 400)
  }
  return parsed
}

export const dynamic = 'force-dynamic'

export const GET = defineRoute(async (request) => {
  await requireAdminSession(request)
  const query = request.nextUrl.searchParams
  const rawNetwork = query.get('network')
  if (rawNetwork && rawNetwork !== 'mainnet' && rawNetwork !== 'devnet') {
    throw new HttpError('Invalid network', 400, 400)
  }
  const rawStatus = query.get('status')
  const status = rawStatus === null || rawStatus === ''
    ? undefined
    : boundedInteger(rawStatus, 0, -1, 1)
  if (status !== undefined && ![-1, 0, 1].includes(status)) {
    throw new HttpError('Invalid cNFT status', 400, 400)
  }
  const ownerAddress = query.get('ownerAddress')?.trim() || undefined
  if (
    ownerAddress &&
    (ownerAddress.length > 64 || !/^[1-9A-HJ-NP-Za-km-z]+$/.test(ownerAddress))
  ) {
    throw new HttpError('Invalid ownerAddress filter', 400, 400)
  }
  return apiOk(
    await listCnfts({
      projectId: optionalId(query.get('projectId'), 'projectId'),
      merkleTreeId: optionalId(query.get('merkleTreeId'), 'merkleTreeId'),
      ownerAddress,
      status,
      network: (rawNetwork || undefined) as SolanaNetwork | undefined,
      page: boundedInteger(query.get('page'), 1, 1, 1_000_000),
      pageSize: boundedInteger(query.get('pageSize'), 20, 1, 100),
    }),
  )
}, { lockMode: 'exclusive' })
