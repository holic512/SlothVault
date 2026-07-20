/**
 * @file project-access.ts
 * @project SlothVault
 * @module Project Authorization
 * @description Resolves public versus cNFT-protected project access after cryptographic wallet ownership verification.
 * @logic Check the project flag, verify local ownership first, optionally query a DAS-capable RPC, and update cached ownership on a chain match.
 * @dependencies Prisma Project/CompressedNft models, system-config, Solana PublicKey
 * @index_tags project-auth,cnft,das,solana
 * @author holic512
 */
import 'server-only'

import { PublicKey } from '@solana/web3.js'

import { prisma } from '@/server/prisma'
import { getSolanaNetwork, getSolanaRpcUrl, type SolanaNetwork } from '@/server/services/system-config'

export type ProjectAccessResult = {
  hasAccess: boolean
  reason: string
  assetId?: string
  requireAuth: boolean
}

type DasAsset = {
  id: string
  ownership?: { owner?: string }
}

function isValidAddress(address: string) {
  try {
    return new PublicKey(address).toBase58() === address
  } catch {
    return false
  }
}

async function fetchAssetsByOwner(address: string, network: SolanaNetwork) {
  const rpcUrl = await getSolanaRpcUrl(network)
  const assets: DasAsset[] = []

  for (let page = 1; page <= 10; page += 1) {
    const response = await fetch(rpcUrl, {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({
        jsonrpc: '2.0',
        id: `slothvault-assets-${page}`,
        method: 'getAssetsByOwner',
        params: { ownerAddress: address, page, limit: 1000 },
      }),
      cache: 'no-store',
      signal: AbortSignal.timeout(12_000),
    })
    if (!response.ok) throw new Error(`DAS RPC returned ${response.status}`)

    const payload = (await response.json()) as {
      error?: { message?: string }
      result?: { items?: DasAsset[] }
    }
    if (payload.error) throw new Error(payload.error.message || 'DAS RPC error')

    const items = payload.result?.items || []
    assets.push(...items)
    if (items.length < 1000) break
  }

  return assets
}

export async function verifyProjectAccess(
  projectId: number,
  walletAddress?: string | null,
  options: { forceChainVerify?: boolean } = {},
): Promise<ProjectAccessResult> {
  const project = await prisma.project.findFirst({
    where: { id: projectId, isDeleted: false, status: 1 },
    select: { requireAuth: true },
  })
  if (!project) {
    return { hasAccess: false, reason: 'Project not found', requireAuth: false }
  }
  if (!project.requireAuth) {
    return { hasAccess: true, reason: 'Project is public', requireAuth: false }
  }
  if (!walletAddress) {
    return { hasAccess: false, reason: 'Connect and verify a wallet to continue', requireAuth: true }
  }
  if (!isValidAddress(walletAddress)) {
    return { hasAccess: false, reason: 'Invalid wallet address', requireAuth: true }
  }

  if (!options.forceChainVerify) {
    const local = await prisma.compressedNft.findFirst({
      where: { projectId, ownerAddress: walletAddress, status: 1 },
      select: { assetId: true },
    })
    if (local) {
      return {
        hasAccess: true,
        reason: 'Local credential verified',
        assetId: local.assetId,
        requireAuth: true,
      }
    }
  }

  try {
    const credentials = await prisma.compressedNft.findMany({
      where: { projectId, status: 1 },
      select: { id: true, assetId: true, ownerAddress: true },
    })
    if (credentials.length === 0) {
      return { hasAccess: false, reason: 'No access credential is available', requireAuth: true }
    }

    const credentialByAsset = new Map(credentials.map((item) => [item.assetId, item]))
    const network = await getSolanaNetwork()
    const assets = await fetchAssetsByOwner(walletAddress, network)
    const matchedAsset = assets.find((asset) => credentialByAsset.has(asset.id))
    if (!matchedAsset) {
      return { hasAccess: false, reason: 'Wallet does not hold a project credential', requireAuth: true }
    }

    const credential = credentialByAsset.get(matchedAsset.id)!
    if (credential.ownerAddress !== walletAddress) {
      await prisma.compressedNft.update({
        where: { id: credential.id },
        data: { ownerAddress: walletAddress, updatedAt: new Date() },
      })
    }

    return {
      hasAccess: true,
      reason: 'On-chain credential verified',
      assetId: matchedAsset.id,
      requireAuth: true,
    }
  } catch (error) {
    console.error('[project-access] Chain verification failed', error)
    return { hasAccess: false, reason: 'On-chain verification is unavailable', requireAuth: true }
  }
}
