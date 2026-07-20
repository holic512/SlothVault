/**
 * @file client.ts
 * @project SlothVault
 * @module Database Runtime
 * @description Creates the provider-specific Prisma 7 client selected by the encrypted first-install configuration.
 * @logic Load configuration only on first database access, instantiate the matching generated query compiler and driver adapter, configure SQLite before exposing its connection, enforce its single-instance contract, and reuse one client during hot reloads.
 * @dependencies node:fs, generated Prisma clients, Prisma driver adapters, database/config-store, sqlite-instance-lock
 * @index_tags prisma,database,factory,postgresql,mysql,sqlite
 * @author holic512
 */
import 'server-only'

import { chmodSync } from 'node:fs'

import { PrismaBetterSqlite3 } from '@prisma/adapter-better-sqlite3'
import { PrismaMariaDb } from '@prisma/adapter-mariadb'
import { PrismaPg } from '@prisma/adapter-pg'
import { PrismaClient as MySqlPrismaClient } from '@generated/prisma-mysql/client'
import { PrismaClient as PostgreSqlPrismaClient } from '@generated/prisma-postgresql/client'
import { PrismaClient as SqlitePrismaClient } from '@generated/prisma-sqlite/client'

import { ensureAppDataDirectories } from '@/server/config/app-data'
import { readDatabaseConfiguration } from '@/server/database/config-store'
import {
  databaseConnectionUrl,
  sqliteDatabaseFilePath,
} from '@/server/database/connection-url'
import { acquireSqliteInstanceLock } from '@/server/database/sqlite-instance-lock'
import type {
  DatabaseConnectionInput,
  DatabaseProvider,
  ServerDatabaseConnection,
} from '@/server/database/types'
import { HttpError } from '@/server/http/errors'

export type AppPrismaClient = InstanceType<typeof PostgreSqlPrismaClient>

const prismaLog = process.env.NODE_ENV === 'development' ? ['error', 'warn'] as const : ['error'] as const

const globalForDatabase = globalThis as unknown as {
  slothVaultPrisma?: AppPrismaClient
  slothVaultPrismaProvider?: DatabaseProvider
}

function serverTls(connection: ServerDatabaseConnection) {
  return connection.tlsEnabled
    ? {
        rejectUnauthorized: true,
        ...(connection.caPem ? { ca: connection.caPem } : {}),
      }
    : undefined
}

function sqliteAdapter() {
  ensureAppDataDirectories()
  const base = new PrismaBetterSqlite3(
    { url: databaseConnectionUrl({ provider: 'sqlite', config: {} }), timeout: 5_000 },
    { timestampFormat: 'iso8601' },
  )
  const configure = async (adapter: Awaited<ReturnType<typeof base.connect>>) => {
    chmodSync(sqliteDatabaseFilePath(), 0o600)
    await adapter.executeScript(`
      PRAGMA journal_mode = WAL;
      PRAGMA foreign_keys = ON;
      PRAGMA busy_timeout = 5000;
    `)
    return adapter
  }
  return {
    provider: base.provider,
    adapterName: base.adapterName,
    connect: async () => configure(await base.connect()),
    connectToShadowDb: async () => configure(await base.connectToShadowDb()),
  } as unknown as InstanceType<typeof PrismaBetterSqlite3>
}

export class DatabaseClientFactory {
  create(
    connection: DatabaseConnectionInput,
    options: { active?: boolean } = {},
  ): AppPrismaClient {
    if (connection.provider === 'postgresql') {
      const adapter = new PrismaPg({
        host: connection.config.host,
        port: connection.config.port,
        database: connection.config.database,
        user: connection.config.username,
        password: connection.config.password,
        ssl: serverTls(connection.config),
        connectionTimeoutMillis: 5_000,
        idleTimeoutMillis: 30_000,
        max: 10,
      })
      return new PostgreSqlPrismaClient({ adapter, log: [...prismaLog] })
    }

    if (connection.provider === 'mysql') {
      const adapter = new PrismaMariaDb(
        {
          host: connection.config.host,
          port: connection.config.port,
          database: connection.config.database,
          user: connection.config.username,
          password: connection.config.password,
          ssl: serverTls(connection.config),
          connectTimeout: 5_000,
          acquireTimeout: 10_000,
          idleTimeout: 30,
          connectionLimit: 10,
          timezone: 'Z',
        },
        { database: connection.config.database },
      )
      return new MySqlPrismaClient({ adapter, log: [...prismaLog] }) as unknown as AppPrismaClient
    }

    if (options.active) acquireSqliteInstanceLock()
    return new SqlitePrismaClient({
      adapter: sqliteAdapter(),
      log: [...prismaLog],
    }) as unknown as AppPrismaClient
  }

  active() {
    if (globalForDatabase.slothVaultPrisma) return globalForDatabase.slothVaultPrisma

    const configuration = readDatabaseConfiguration()
    if (!configuration || configuration.status === 'CONFIGURING') {
      throw new HttpError('System database is not initialized', 503, 5031, {
        reason: 'SYSTEM_NOT_INSTALLED',
      })
    }

    const client = this.create(configuration.connection, { active: true })
    globalForDatabase.slothVaultPrisma = client
    globalForDatabase.slothVaultPrismaProvider = configuration.provider
    return client
  }
}

export const databaseClientFactory = new DatabaseClientFactory()

export function createDatabaseClient(
  connection: DatabaseConnectionInput,
  options: { active?: boolean } = {},
) {
  return databaseClientFactory.create(connection, options)
}

export function configuredDatabaseProvider() {
  const configuration = readDatabaseConfiguration()
  return configuration?.provider ?? null
}

export function databaseSnapshotIsolationLevel() {
  return configuredDatabaseProvider() === 'sqlite' ? 'Serializable' as const : 'RepeatableRead' as const
}

export function getDatabaseClient() {
  return databaseClientFactory.active()
}

export async function disconnectDatabaseClient(client: AppPrismaClient) {
  await client.$disconnect()
}

export async function resetActiveDatabaseClientForTests() {
  if (globalForDatabase.slothVaultPrisma) {
    await globalForDatabase.slothVaultPrisma.$disconnect()
  }
  globalForDatabase.slothVaultPrisma = undefined
  globalForDatabase.slothVaultPrismaProvider = undefined
}
