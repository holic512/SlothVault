/**
 * @file installer.ts
 * @project SlothVault
 * @module Database Bootstrap
 * @description Owns the resumable empty-database initialization and first-administrator state machine.
 * @logic Validate an empty target before persisting pending encrypted configuration, deploy only the fixed provider migration set, record schema readiness, then create the sole first administrator and installation marker in one serializable transaction.
 * @dependencies database configuration/client/migrations/locks, auth/password, Prisma SystemInstallation/User models
 * @index_tags installer,database,administrator,state-machine,migrations
 * @author holic512
 */
import 'server-only'

import { randomUUID } from 'node:crypto'

import { hashPassword } from '@/server/auth/password'
import {
  createDatabaseClient,
  disconnectDatabaseClient,
  getDatabaseClient,
} from '@/server/database/client'
import {
  DatabaseConfigurationError,
  createPendingDatabaseConfiguration,
  readDatabaseConfiguration,
  removePendingDatabaseConfiguration,
  updateDatabaseConfigurationStatus,
  writeDatabaseConfiguration,
} from '@/server/database/config-store'
import {
  hasInitializedApplicationSchema,
  testEmptyDatabaseConnection,
} from '@/server/database/connection-test'
import { readInstallationPublicStatus } from '@/server/database/installation-state'
import { withInstallationLock } from '@/server/database/installation-lock'
import {
  DatabaseMigrationError,
  deployInitialDatabaseSchema,
} from '@/server/database/migrations'
import { readRuntimeInstallationPublicStatus } from '@/server/database/runtime-health'
import type { DatabaseConnectionInput } from '@/server/database/types'
import { unitOfWork } from '@/server/database/unit-of-work'
import { HttpError } from '@/server/http/errors'

const INSTALLATION_ROW_ID = 1
const SCHEMA_REVISION = 1

function hasPrismaCode(error: unknown, code: string) {
  return (
    typeof error === 'object' &&
    error !== null &&
    'code' in error &&
    (error as { code?: unknown }).code === code
  )
}

function installationStateConflict(): never {
  throw new HttpError(
    'Database installation state conflicts with the local configuration',
    503,
    5033,
    { reason: 'DATABASE_INSTALLATION_STATE_CONFLICT' },
  )
}

async function writeSchemaReadyMarker(connection: DatabaseConnectionInput) {
  const client = createDatabaseClient(connection)
  try {
    const inspectMarker = async () => {
      const marker = await client.systemInstallation.findUnique({
        where: { id: INSTALLATION_ROW_ID },
      })
      if (!marker) return null
      if (
        marker.provider !== connection.provider ||
        marker.schemaRevision !== SCHEMA_REVISION
      ) {
        installationStateConflict()
      }
      if (marker.status === 'SCHEMA_READY') return 'SCHEMA_READY' as const
      if (marker.status === 'INSTALLED') {
        if (await client.user.count() < 1) installationStateConflict()
        return 'INSTALLED' as const
      }
      installationStateConflict()
    }

    const existingStatus = await inspectMarker()
    if (existingStatus) return existingStatus

    try {
      await client.systemInstallation.create({
        data: {
          id: INSTALLATION_ROW_ID,
          installationId: randomUUID(),
          provider: connection.provider,
          status: 'SCHEMA_READY',
          schemaRevision: SCHEMA_REVISION,
        },
      })
      return 'SCHEMA_READY' as const
    } catch (error) {
      if (!hasPrismaCode(error, 'P2002')) throw error
      return (await inspectMarker()) ?? installationStateConflict()
    }
  } finally {
    await disconnectDatabaseClient(client).catch(() => undefined)
  }
}

export async function initializeEmptyDatabase(connection: DatabaseConnectionInput) {
  return withInstallationLock(async () => {
    const existing = readDatabaseConfiguration()
    if (existing?.status === 'INSTALLED') {
      throw new HttpError('System is already installed', 409, 409)
    }
    if (existing?.status === 'SCHEMA_READY') {
      return { status: 'SCHEMA_READY' as const, provider: existing.provider }
    }

    const selectedConnection = existing?.connection ?? connection
    if (!existing) {
      await testEmptyDatabaseConnection(selectedConnection)
      writeDatabaseConfiguration(createPendingDatabaseConfiguration(selectedConnection))
    }

    try {
      await deployInitialDatabaseSchema(selectedConnection)
    } catch (error) {
      if (error instanceof DatabaseMigrationError) {
        throw new HttpError(
          'Unable to initialize database tables',
          500,
          5004,
          { reason: 'DATABASE_INITIALIZATION_FAILED' },
        )
      }
      throw error
    }
    const markerStatus = await writeSchemaReadyMarker(selectedConnection)
    updateDatabaseConfigurationStatus(markerStatus)
    return { status: markerStatus, provider: selectedConnection.provider }
  })
}

export async function createFirstAdministrator(input: {
  username: string
  password: string
}) {
  return withInstallationLock(async () => {
    const configuration = readDatabaseConfiguration()
    if (!configuration || configuration.status === 'CONFIGURING') {
      throw new HttpError('Database schema is not initialized', 409, 409)
    }
    if (configuration.status === 'INSTALLED') {
      throw new HttpError('System is already installed', 409, 409)
    }

    const password = await hashPassword(input.password)
    const result = await unitOfWork.execute(
      async (tx) => {
        const locked = await tx.systemInstallation.updateMany({
          where: {
            id: INSTALLATION_ROW_ID,
            provider: configuration.provider,
            schemaRevision: SCHEMA_REVISION,
            status: { in: ['SCHEMA_READY', 'INSTALLED'] },
          },
          data: { updatedAt: new Date() },
        })
        if (locked.count !== 1) installationStateConflict()

        const marker = await tx.systemInstallation.findUnique({
          where: { id: INSTALLATION_ROW_ID },
        })
        if (marker?.status === 'INSTALLED') {
          const existingAdmin = await tx.user.findFirst({
            orderBy: { id: 'asc' },
            select: { id: true, username: true },
          })
          if (existingAdmin) return { user: existingAdmin, recovered: true }
          installationStateConflict()
        }

        if (marker?.status !== 'SCHEMA_READY') installationStateConflict()

        if ((await tx.user.count()) > 0) {
          installationStateConflict()
        }
        const user = await tx.user.create({
          data: { username: input.username, password },
          select: { id: true, username: true },
        })
        const now = new Date()
        await tx.systemInstallation.update({
          where: { id: INSTALLATION_ROW_ID },
          data: {
            provider: configuration.provider,
            status: 'INSTALLED',
            schemaRevision: SCHEMA_REVISION,
            installedAt: now,
            updatedAt: now,
          },
        })
        return { user, recovered: false }
      },
      { isolationLevel: 'Serializable' },
    )

    updateDatabaseConfigurationStatus('INSTALLED')
    return {
      status: 'INSTALLED' as const,
      provider: configuration.provider,
      user: result.user,
      recovered: result.recovered,
    }
  })
}

export async function resetPendingInstallation() {
  return withInstallationLock(async () => {
    const configuration = readDatabaseConfiguration()
    if (
      configuration?.status === 'CONFIGURING' &&
      await hasInitializedApplicationSchema(configuration.connection)
    ) {
      throw new HttpError(
        'Initialized database configuration cannot be reset',
        409,
        409,
      )
    }
    try {
      removePendingDatabaseConfiguration()
    } catch (error) {
      if (error instanceof DatabaseConfigurationError) {
        throw new HttpError(error.message, 409, 409)
      }
      throw error
    }
    return { status: 'UNCONFIGURED' as const }
  })
}

export async function resolveInstallerStatus() {
  const local = readInstallationPublicStatus()
  if (local.status === 'INSTALLED') {
    return readRuntimeInstallationPublicStatus()
  }
  if (local.status !== 'SCHEMA_READY') return local

  try {
    const client = getDatabaseClient()
    const [marker, adminCount] = await Promise.all([
      client.systemInstallation.findUnique({ where: { id: INSTALLATION_ROW_ID } }),
      client.user.count(),
    ])
    if (marker?.status === 'INSTALLED' && adminCount > 0) {
      updateDatabaseConfigurationStatus('INSTALLED')
      return { ...local, status: 'INSTALLED' as const }
    }
    return local
  } catch {
    return {
      status: 'MAINTENANCE' as const,
      provider: local.provider,
      error: 'Initialized database is unavailable',
    }
  }
}
