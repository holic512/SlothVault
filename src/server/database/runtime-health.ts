/**
 * @file runtime-health.ts
 * @project SlothVault
 * @module Database Runtime
 * @description Probes the installed database behind a short process-wide cache and exposes a credential-free maintenance state.
 * @logic Trust local encrypted configuration for install gating, verify the singleton installation marker for installed systems, collapse concurrent probes, and classify connection failures without reopening the installer.
 * @dependencies database/client, database/installation-state, database/types
 * @index_tags database,health-check,maintenance,installation,cache
 * @author holic512
 */
import 'server-only'

import { getDatabaseClient } from '@/server/database/client'
import { readInstallationPublicStatus } from '@/server/database/installation-state'
import type { InstallationPublicStatus } from '@/server/database/types'

const INSTALLATION_ROW_ID = 1
const SCHEMA_REVISION = 1
const HEALTHY_TTL_MS = 5_000
const UNAVAILABLE_TTL_MS = 2_000

type CachedRuntimeHealth = {
  expiresAt: number
  value: InstallationPublicStatus
}

const globalForRuntimeHealth = globalThis as unknown as {
  slothVaultRuntimeHealth?: CachedRuntimeHealth
  slothVaultRuntimeHealthProbe?: Promise<InstallationPublicStatus>
}

function maintenanceStatus(
  installed: InstallationPublicStatus,
  error = 'Installed database is unavailable',
): InstallationPublicStatus {
  return {
    status: 'MAINTENANCE',
    provider: installed.provider,
    ...(installed.database ? { database: installed.database } : {}),
    ...(installed.host ? { host: installed.host } : {}),
    error,
  }
}

function cacheRuntimeHealth(value: InstallationPublicStatus) {
  const ttl = value.status === 'INSTALLED' ? HEALTHY_TTL_MS : UNAVAILABLE_TTL_MS
  globalForRuntimeHealth.slothVaultRuntimeHealth = {
    expiresAt: Date.now() + ttl,
    value,
  }
  return value
}

async function probeInstalledDatabase(
  installed: InstallationPublicStatus,
): Promise<InstallationPublicStatus> {
  try {
    const marker = await getDatabaseClient().systemInstallation.findUnique({
      where: { id: INSTALLATION_ROW_ID },
      select: {
        provider: true,
        status: true,
        schemaRevision: true,
      },
    })
    if (
      !marker ||
      marker.provider !== installed.provider ||
      marker.status !== 'INSTALLED' ||
      marker.schemaRevision !== SCHEMA_REVISION
    ) {
      return maintenanceStatus(installed, 'Installed database marker is inconsistent')
    }
    return installed
  } catch {
    return maintenanceStatus(installed)
  }
}

export async function readRuntimeInstallationPublicStatus() {
  const local = readInstallationPublicStatus()
  if (local.status !== 'INSTALLED') {
    globalForRuntimeHealth.slothVaultRuntimeHealth = undefined
    globalForRuntimeHealth.slothVaultRuntimeHealthProbe = undefined
    return local
  }

  const cached = globalForRuntimeHealth.slothVaultRuntimeHealth
  if (cached && cached.expiresAt > Date.now()) return cached.value

  if (globalForRuntimeHealth.slothVaultRuntimeHealthProbe) {
    return globalForRuntimeHealth.slothVaultRuntimeHealthProbe
  }

  const probe = probeInstalledDatabase(local)
    .then(cacheRuntimeHealth)
    .finally(() => {
      if (globalForRuntimeHealth.slothVaultRuntimeHealthProbe === probe) {
        globalForRuntimeHealth.slothVaultRuntimeHealthProbe = undefined
      }
    })
  globalForRuntimeHealth.slothVaultRuntimeHealthProbe = probe
  return probe
}

const DATABASE_CONNECTIVITY_CODES = new Set([
  'P1000',
  'P1001',
  'P1002',
  'P1008',
  'P1010',
  'P1011',
  'P1017',
  'P2024',
  'ECONNREFUSED',
  'ECONNRESET',
  'EHOSTUNREACH',
  'ENETUNREACH',
  'ENOTFOUND',
  'EPIPE',
  'ETIMEDOUT',
  'PROTOCOL_CONNECTION_LOST',
])

export function isDatabaseConnectivityError(error: unknown): boolean {
  const visited = new Set<unknown>()
  let current: unknown = error
  for (let depth = 0; depth < 6 && current && !visited.has(current); depth += 1) {
    visited.add(current)
    if (typeof current !== 'object') return false
    const candidate = current as { code?: unknown; cause?: unknown }
    const code = typeof candidate.code === 'string' ? candidate.code : ''
    if (
      DATABASE_CONNECTIVITY_CODES.has(code) ||
      /^08[A-Z0-9]{3}$/.test(code) ||
      code === '57P01'
    ) {
      return true
    }
    current = candidate.cause
  }
  return false
}

export function markInstalledDatabaseUnavailable() {
  const local = readInstallationPublicStatus()
  if (local.status === 'INSTALLED') {
    cacheRuntimeHealth(maintenanceStatus(local))
  }
}

export function resetRuntimeHealthCacheForTests() {
  globalForRuntimeHealth.slothVaultRuntimeHealth = undefined
  globalForRuntimeHealth.slothVaultRuntimeHealthProbe = undefined
}
