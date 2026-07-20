/**
 * @file migrations.ts
 * @project SlothVault
 * @module Database Bootstrap
 * @description Applies the committed provider migration set for installation and safe runtime upgrades.
 * @logic Map the validated provider to a fixed schema path, pass credentials only through a child environment, run migrate deploy, then advance the installation marker only after every committed migration succeeds.
 * @dependencies node:child_process, Prisma CLI, database/connection-url, database/client, schema-version
 * @index_tags prisma,migrate-deploy,installer,upgrade,subprocess,tls
 * @author holic512
 */
import 'server-only'

import { spawn, type ChildProcess } from 'node:child_process'
import { randomBytes } from 'node:crypto'
import { rmSync, writeFileSync } from 'node:fs'
import { resolve } from 'node:path'

import { appConfigPath } from '@/server/config/app-data'
import { createDatabaseClient, disconnectDatabaseClient } from '@/server/database/client'
import { databaseConnectionUrl } from '@/server/database/connection-url'
import type { DatabaseConnectionInput, DatabaseProvider } from '@/server/database/types'
import { CURRENT_SCHEMA_REVISION, INSTALLATION_ROW_ID } from '@/server/database/schema-version'

const MIGRATION_TIMEOUT_MS = 120_000
const MIGRATION_TERMINATION_GRACE_MS = 5_000
const MAX_OUTPUT_LENGTH = 64 * 1024

export class DatabaseMigrationError extends Error {
  constructor(message: string, options?: ErrorOptions) {
    super(message, options)
    this.name = 'DatabaseMigrationError'
  }
}

function providerSchemaPath(provider: DatabaseProvider) {
  return resolve(process.cwd(), 'prisma', 'providers', provider, 'schema.prisma')
}

function appendOutput(current: string, chunk: Buffer | string) {
  const next = current + chunk.toString()
  return next.length > MAX_OUTPUT_LENGTH ? next.slice(-MAX_OUTPUT_LENGTH) : next
}

export function waitForMigrationProcessExit(
  child: ChildProcess,
  options: {
    timeoutMs?: number
    terminationGraceMs?: number
  } = {},
) {
  const timeoutMs = options.timeoutMs ?? MIGRATION_TIMEOUT_MS
  const terminationGraceMs =
    options.terminationGraceMs ?? MIGRATION_TERMINATION_GRACE_MS

  return new Promise<number | null>((resolveExit, reject) => {
    let timedOut = false
    let settled = false
    let forceKill: NodeJS.Timeout | undefined
    const finish = (operation: () => void) => {
      if (settled) return
      settled = true
      clearTimeout(timeout)
      if (forceKill) clearTimeout(forceKill)
      operation()
    }
    const timeout = setTimeout(() => {
      timedOut = true
      child.kill('SIGTERM')
      forceKill = setTimeout(() => {
        child.kill('SIGKILL')
      }, terminationGraceMs)
      forceKill.unref()
    }, timeoutMs)
    timeout.unref()

    child.once('error', (error) => {
      finish(() => {
        reject(new DatabaseMigrationError('Unable to start database initialization', {
          cause: error,
        }))
      })
    })
    child.once('close', (code) => {
      finish(() => {
        if (timedOut) {
          reject(new DatabaseMigrationError('Database initialization timed out'))
        } else {
          resolveExit(code)
        }
      })
    })
  })
}

export async function deployInitialDatabaseSchema(connection: DatabaseConnectionInput) {
  const caPem = connection.provider === 'sqlite' ? undefined : connection.config.caPem
  const caPath = caPem
    ? resolve(
        appConfigPath(),
        `.database-ca.${process.pid}.${randomBytes(6).toString('hex')}.pem`,
      )
    : undefined
  if (caPath && caPem) writeFileSync(caPath, caPem, { encoding: 'utf8', mode: 0o600 })

  try {
    const cliPath = resolve(process.cwd(), 'node_modules', 'prisma', 'build', 'index.js')
    const databaseUrl = databaseConnectionUrl(connection, { caPath })
    const child = spawn(
      process.execPath,
      [
        cliPath,
        'migrate',
        'deploy',
        '--config',
        resolve(process.cwd(), 'prisma.config.ts'),
        '--schema',
        providerSchemaPath(connection.provider),
      ],
      {
        cwd: process.cwd(),
        env: {
          ...process.env,
          SLOTHVAULT_PRISMA_PROVIDER: connection.provider,
          SLOTHVAULT_PRISMA_DATABASE_URL: databaseUrl,
        },
        shell: false,
        stdio: ['ignore', 'pipe', 'pipe'],
      },
    )

    let stdout = ''
    let stderr = ''
    child.stdout.on('data', (chunk) => {
      stdout = appendOutput(stdout, chunk)
    })
    child.stderr.on('data', (chunk) => {
      stderr = appendOutput(stderr, chunk)
    })

    const exitCode = await waitForMigrationProcessExit(child)

    if (exitCode !== 0) {
      const password = connection.provider === 'sqlite' ? '' : connection.config.password
      const safeDetail = `${stdout}\n${stderr}`
        .replaceAll(databaseUrl, '[DATABASE_URL]')
        .replaceAll(password, password ? '[PASSWORD]' : '')
        .trim()
        .slice(-4_000)
      console.error('[database-install] Prisma migrate deploy failed', safeDetail)
      throw new DatabaseMigrationError('Unable to initialize database tables')
    }
  } finally {
    if (caPath) rmSync(caPath, { force: true })
  }
}

export async function upgradeConfiguredDatabaseSchema(connection: DatabaseConnectionInput) {
  await deployInitialDatabaseSchema(connection)

  const client = createDatabaseClient(connection)
  try {
    const marker = await client.systemInstallation.findUnique({
      where: { id: INSTALLATION_ROW_ID },
      select: { provider: true, status: true, schemaRevision: true },
    })
    if (!marker || marker.provider !== connection.provider) {
      throw new DatabaseMigrationError('Installed database marker is inconsistent')
    }
    if (marker.schemaRevision > CURRENT_SCHEMA_REVISION) {
      throw new DatabaseMigrationError('Installed database schema is newer than this application')
    }
    if (marker.schemaRevision < CURRENT_SCHEMA_REVISION) {
      await client.systemInstallation.update({
        where: { id: INSTALLATION_ROW_ID },
        data: { schemaRevision: CURRENT_SCHEMA_REVISION, updatedAt: new Date() },
      })
    }
  } finally {
    await disconnectDatabaseClient(client).catch(() => undefined)
  }
}
