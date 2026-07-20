/**
 * @file connection-test.ts
 * @project SlothVault
 * @module Database Bootstrap
 * @description Verifies provider compatibility and strict empty-database preconditions without creating SlothVault tables.
 * @logic Connect through the selected Prisma driver adapter, validate supported server/version characteristics, inspect only provider metadata catalogs, and always dispose the candidate client.
 * @dependencies database/client, database/types, server/http/errors
 * @index_tags database,connection-test,empty-database,installer
 * @author holic512
 */
import 'server-only'

import {
  type AppPrismaClient,
  createDatabaseClient,
  disconnectDatabaseClient,
} from '@/server/database/client'
import type { DatabaseConnectionInput } from '@/server/database/types'
import { HttpError } from '@/server/http/errors'

type NamedValue = Record<string, unknown>

function firstString(row: NamedValue | undefined) {
  if (!row) return ''
  const value = Object.values(row)[0]
  return value === undefined || value === null ? '' : String(value)
}

async function databaseTableCount(
  client: AppPrismaClient,
  connection: DatabaseConnectionInput,
) {
  let rows: NamedValue[]
  if (connection.provider === 'postgresql') {
    rows = await client.$queryRawUnsafe<NamedValue[]>(`
      SELECT COUNT(*)::text AS table_count
      FROM information_schema.tables
      WHERE table_type = 'BASE TABLE'
        AND table_schema NOT IN ('pg_catalog', 'information_schema')
    `)
  } else if (connection.provider === 'mysql') {
    rows = await client.$queryRawUnsafe<NamedValue[]>(`
      SELECT CAST(COUNT(*) AS CHAR) AS table_count
      FROM information_schema.tables
      WHERE table_schema = DATABASE()
        AND table_type = 'BASE TABLE'
    `)
  } else {
    rows = await client.$queryRawUnsafe<NamedValue[]>(`
      SELECT CAST(COUNT(*) AS TEXT) AS table_count
      FROM sqlite_master
      WHERE type = 'table'
        AND name NOT LIKE 'sqlite_%'
    `)
  }
  return Number(firstString(rows[0]))
}

async function initialMigrationCompleted(
  client: AppPrismaClient,
  connection: DatabaseConnectionInput,
) {
  let migrationTables: NamedValue[]
  if (connection.provider === 'postgresql') {
    migrationTables = await client.$queryRawUnsafe<NamedValue[]>(`
      SELECT table_name
      FROM information_schema.tables
      WHERE table_type = 'BASE TABLE'
        AND table_schema = current_schema()
        AND table_name = '_prisma_migrations'
      LIMIT 1
    `)
  } else if (connection.provider === 'mysql') {
    migrationTables = await client.$queryRawUnsafe<NamedValue[]>(`
      SELECT table_name
      FROM information_schema.tables
      WHERE table_schema = DATABASE()
        AND table_type = 'BASE TABLE'
        AND table_name = '_prisma_migrations'
      LIMIT 1
    `)
  } else {
    migrationTables = await client.$queryRawUnsafe<NamedValue[]>(`
      SELECT name
      FROM sqlite_master
      WHERE type = 'table'
        AND name = '_prisma_migrations'
      LIMIT 1
    `)
  }
  if (migrationTables.length === 0) return false

  const completed = await client.$queryRawUnsafe<NamedValue[]>(`
    SELECT migration_name
    FROM _prisma_migrations
    WHERE migration_name = '20260719000000_initial'
      AND finished_at IS NOT NULL
      AND rolled_back_at IS NULL
    LIMIT 1
  `)
  return completed.length > 0
}

export async function testEmptyDatabaseConnection(connection: DatabaseConnectionInput) {
  const client = createDatabaseClient(connection)
  try {
    await client.$connect()

    if (connection.provider === 'postgresql') {
      const versionRows = await client.$queryRawUnsafe<NamedValue[]>('SHOW server_version_num')
      const version = Number(firstString(versionRows[0]))
      if (!Number.isInteger(version) || version < 140_000) {
        throw new HttpError('PostgreSQL 14 or newer is required', 400, 400)
      }
      const tables = await client.$queryRawUnsafe<NamedValue[]>(`
        SELECT table_schema, table_name
        FROM information_schema.tables
        WHERE table_type = 'BASE TABLE'
          AND table_schema NOT IN ('pg_catalog', 'information_schema')
        LIMIT 1
      `)
      if (tables.length > 0) {
        throw new HttpError('The selected PostgreSQL database is not empty', 409, 409)
      }
    } else if (connection.provider === 'mysql') {
      const versionRows = await client.$queryRawUnsafe<NamedValue[]>(
        'SELECT VERSION() AS version, @@version_comment AS version_comment',
      )
      const versionText = `${versionRows[0]?.version ?? ''} ${versionRows[0]?.version_comment ?? ''}`
      const major = Number.parseInt(String(versionRows[0]?.version ?? ''), 10)
      if (/mariadb/i.test(versionText) || !Number.isInteger(major) || major < 8) {
        throw new HttpError('MySQL 8.0 or newer with InnoDB is required', 400, 400)
      }
      const engineRows = await client.$queryRawUnsafe<NamedValue[]>(
        'SELECT @@default_storage_engine AS storage_engine',
      )
      if (String(engineRows[0]?.storage_engine ?? '').toLowerCase() !== 'innodb') {
        throw new HttpError('MySQL default storage engine must be InnoDB', 400, 400)
      }
      const tables = await client.$queryRawUnsafe<NamedValue[]>(`
        SELECT table_name
        FROM information_schema.tables
        WHERE table_schema = DATABASE()
          AND table_type = 'BASE TABLE'
        LIMIT 1
      `)
      if (tables.length > 0) {
        throw new HttpError('The selected MySQL database is not empty', 409, 409)
      }
    } else {
      const tables = await client.$queryRawUnsafe<NamedValue[]>(`
        SELECT name
        FROM sqlite_master
        WHERE type = 'table'
          AND name NOT LIKE 'sqlite_%'
        LIMIT 1
      `)
      if (tables.length > 0) {
        throw new HttpError('The managed SQLite database is not empty', 409, 409)
      }
    }

    return { provider: connection.provider, reachable: true, empty: true }
  } catch (error) {
    if (error instanceof HttpError) throw error
    throw new HttpError('Unable to connect to the selected database', 400, 400)
  } finally {
    await disconnectDatabaseClient(client).catch(() => undefined)
  }
}

export async function hasInitializedApplicationSchema(
  connection: DatabaseConnectionInput,
) {
  const client = createDatabaseClient(connection)
  try {
    await client.$connect()
    return initialMigrationCompleted(client, connection)
  } catch {
    throw new HttpError(
      'Unable to verify the pending database schema',
      503,
      5033,
      { reason: 'DATABASE_SCHEMA_STATE_UNAVAILABLE' },
    )
  } finally {
    await disconnectDatabaseClient(client).catch(() => undefined)
  }
}

export async function inspectPendingDatabaseConnection(
  connection: DatabaseConnectionInput,
) {
  const client = createDatabaseClient(connection)
  try {
    await client.$connect()
    const tableCount = await databaseTableCount(client, connection)
    if (!Number.isSafeInteger(tableCount) || tableCount < 0) {
      throw new Error('Invalid database metadata result')
    }
    return {
      provider: connection.provider,
      reachable: true,
      empty: tableCount === 0,
      schemaReady: tableCount > 0
        ? await initialMigrationCompleted(client, connection)
        : false,
    }
  } catch (error) {
    if (error instanceof HttpError) throw error
    throw new HttpError('Unable to connect to the selected database', 400, 400)
  } finally {
    await disconnectDatabaseClient(client).catch(() => undefined)
  }
}
