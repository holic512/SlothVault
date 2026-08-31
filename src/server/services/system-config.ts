/**
 * @file system-config.ts
 * @project SlothVault
 * @module Runtime System Configuration
 * @description Defines persisted system setting keys and resolves system branding, fixed Mainnet and Devnet evidence profiles, protected RPC endpoints, defaults, and persisted health observations.
 * @logic Keep shared setting keys stable, read profile settings from the installed database, fall back to environment or public cluster endpoints, keep disabled networks readable, and expose only masked endpoint summaries to administrators.
 * @dependencies Prisma SystemConfig model, @solana/web3.js
 * @index_tags config,branding,logo,favicon,solana,evidence,rpc,failover,network-profile
 * @author holic512
 */
import 'server-only'

import { clusterApiUrl } from '@solana/web3.js'

import { HttpError } from '@/server/http/errors'
import { prisma } from '@/server/prisma'

export type SolanaNetwork = 'mainnet' | 'devnet'

export const CONFIG_KEYS = {
  SYSTEM_LOGO_FILE_PATH: 'SYSTEM_LOGO_FILE_PATH',
  SYSTEM_FAVICON_FILE_PATH: 'SYSTEM_FAVICON_FILE_PATH',
  DEFAULT_NETWORK: 'SOLANA_DEFAULT_NETWORK',
  MAINNET_ENABLED: 'SOLANA_MAINNET_ENABLED',
  MAINNET_RPC_PRIMARY: 'SOLANA_MAINNET_RPC_PRIMARY',
  MAINNET_RPC_FALLBACK: 'SOLANA_MAINNET_RPC_FALLBACK',
  DEVNET_ENABLED: 'SOLANA_DEVNET_ENABLED',
  DEVNET_RPC_PRIMARY: 'SOLANA_DEVNET_RPC_PRIMARY',
  DEVNET_RPC_FALLBACK: 'SOLANA_DEVNET_RPC_FALLBACK',
  MAINNET_HEALTH: 'SOLANA_MAINNET_HEALTH',
  DEVNET_HEALTH: 'SOLANA_DEVNET_HEALTH',
} as const

export async function getConfigValue(key: string) {
  const config = await prisma.systemConfig.findUnique({
    where: { configKey: key },
    select: { configValue: true },
  })
  return config?.configValue || ''
}

function enabledValue(value: string, defaultValue: boolean) {
  if (!value) return defaultValue
  return value === '1' || value.toLowerCase() === 'true'
}

function environmentRpc(network: SolanaNetwork, fallback: boolean) {
  if (network === 'mainnet') {
    return fallback
      ? process.env.SOLANA_MAINNET_RPC_FALLBACK || ''
      : process.env.SOLANA_RPC_URL || ''
  }
  return fallback
    ? process.env.SOLANA_DEVNET_RPC_FALLBACK || ''
    : process.env.SOLANA_DEVNET_RPC_URL || ''
}

export type NetworkHealthSnapshot = {
  testedAt: string
  primary: { ok: boolean; latencyMs: number | null; error: string | null }
  fallback: { configured: boolean; ok: boolean; latencyMs: number | null; error: string | null }
}

function parseHealth(value: string): NetworkHealthSnapshot | null {
  if (!value) return null
  try {
    const parsed = JSON.parse(value) as NetworkHealthSnapshot
    return parsed && typeof parsed.testedAt === 'string' ? parsed : null
  } catch {
    return null
  }
}

export async function getSolanaNetworkProfile(network: SolanaNetwork) {
  const prefix = network === 'mainnet' ? 'MAINNET' : 'DEVNET'
  const [enabled, primary, fallback, health] = await Promise.all([
    getConfigValue(CONFIG_KEYS[`${prefix}_ENABLED`]),
    getConfigValue(CONFIG_KEYS[`${prefix}_RPC_PRIMARY`]),
    getConfigValue(CONFIG_KEYS[`${prefix}_RPC_FALLBACK`]),
    getConfigValue(CONFIG_KEYS[`${prefix}_HEALTH`]),
  ])
  return {
    network,
    enabled: enabledValue(enabled, network === 'devnet'),
    primaryUrl:
      primary ||
      environmentRpc(network, false) ||
      clusterApiUrl(network === 'mainnet' ? 'mainnet-beta' : 'devnet'),
    fallbackUrl: fallback || environmentRpc(network, true) || '',
    health: parseHealth(health),
  }
}

export async function getDefaultSolanaNetwork(): Promise<SolanaNetwork> {
  const configured = (await getConfigValue(CONFIG_KEYS.DEFAULT_NETWORK)).toLowerCase()
  const requested: SolanaNetwork = configured === 'mainnet' ? 'mainnet' : 'devnet'
  const profile = await getSolanaNetworkProfile(requested)
  if (profile.enabled) return requested
  const alternative: SolanaNetwork = requested === 'mainnet' ? 'devnet' : 'mainnet'
  return (await getSolanaNetworkProfile(alternative)).enabled ? alternative : requested
}

export async function requireEnabledSolanaNetwork(network: SolanaNetwork) {
  const profile = await getSolanaNetworkProfile(network)
  if (!profile.enabled) {
    throw new HttpError(`${network} evidence issuance is disabled`, 409, 409, {
      reason: 'EVIDENCE_NETWORK_DISABLED',
    })
  }
  return profile
}

export async function saveNetworkHealth(
  network: SolanaNetwork,
  health: NetworkHealthSnapshot,
) {
  const key = network === 'mainnet' ? CONFIG_KEYS.MAINNET_HEALTH : CONFIG_KEYS.DEVNET_HEALTH
  await prisma.systemConfig.upsert({
    where: { configKey: key },
    update: { configValue: JSON.stringify(health), updatedAt: new Date() },
    create: {
      configKey: key,
      configValue: JSON.stringify(health),
      description: `${network} RPC health snapshot`,
    },
  })
}
