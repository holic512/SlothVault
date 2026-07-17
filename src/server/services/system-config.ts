/**
 * @file system-config.ts
 * @project SlothVault
 * @module System Configuration
 * @description Reads runtime configuration directly from PostgreSQL so behavior remains correct across Next.js processes.
 * @logic Resolve known keys from the database, use environment fallbacks where appropriate, and normalize Solana network/RPC values.
 * @dependencies Prisma SystemConfig model, @solana/web3.js
 * @index_tags config,solana,rpc,multi-process
 * @author holic512
 */
import 'server-only'

import { clusterApiUrl } from '@solana/web3.js'

import { prisma } from '@/server/prisma'

export const CONFIG_KEYS = {
  SOLANA_NETWORK: 'solana_network',
  SOLANA_RPC_URL: 'SOLANA_RPC_URL',
  SOLANA_DEVNET_RPC_URL: 'SOLANA_DEVNET_RPC_URL',
  FILEBASE_ACCESS_KEY: 'FILEBASE_ACCESS_KEY',
  FILEBASE_SECRET_KEY: 'FILEBASE_SECRET_KEY',
  FILEBASE_BUCKET: 'FILEBASE_BUCKET',
  FILEBASE_ENDPOINT: 'FILEBASE_ENDPOINT',
} as const

export type SolanaNetwork = 'mainnet' | 'devnet'

export async function getConfigValue(key: string) {
  const config = await prisma.systemConfig.findUnique({
    where: { configKey: key },
    select: { configValue: true },
  })
  return config?.configValue || ''
}

export async function getSolanaNetwork(): Promise<SolanaNetwork> {
  const value = (await getConfigValue(CONFIG_KEYS.SOLANA_NETWORK)).toLowerCase()
  return value === 'mainnet' || value === 'mainnet-beta' ? 'mainnet' : 'devnet'
}

export async function getSolanaRpcUrl(network: SolanaNetwork) {
  const key = network === 'mainnet' ? CONFIG_KEYS.SOLANA_RPC_URL : CONFIG_KEYS.SOLANA_DEVNET_RPC_URL
  const configured = await getConfigValue(key)
  if (configured) return configured

  const environmentValue =
    network === 'mainnet' ? process.env.SOLANA_RPC_URL : process.env.SOLANA_DEVNET_RPC_URL
  return environmentValue || clusterApiUrl(network === 'mainnet' ? 'mainnet-beta' : 'devnet')
}
