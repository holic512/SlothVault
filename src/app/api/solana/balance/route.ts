import { Connection, LAMPORTS_PER_SOL, PublicKey } from '@solana/web3.js'

import { HttpError } from '@/server/http/errors'
import { defineRoute } from '@/server/http/handler'
import { apiOk } from '@/server/http/response'
import { getSolanaNetwork, getSolanaRpcUrl } from '@/server/services/system-config'

export const dynamic = 'force-dynamic'

export const GET = defineRoute(async (request) => {
  const address = request.nextUrl.searchParams.get('address')
  if (!address) throw new HttpError('Missing wallet address', 400, 400)

  let publicKey: PublicKey
  try {
    publicKey = new PublicKey(address)
  } catch {
    throw new HttpError('Invalid wallet address', 400, 400)
  }

  const network = await getSolanaNetwork()
  const rpcUrl = await getSolanaRpcUrl(network)
  try {
    const connection = new Connection(rpcUrl, 'confirmed')
    const balance = await connection.getBalance(publicKey)
    return apiOk({ address: publicKey.toBase58(), balance, sol: balance / LAMPORTS_PER_SOL })
  } catch (error) {
    console.error('[solana-balance] RPC failed', error)
    throw new HttpError('Failed to fetch wallet balance', 503, 503)
  }
})
