/**
 * @file accounts.ts
 * @project SlothVault
 * @module Backup Account Policy
 * @description Preflights account uniqueness and preserves the restoring administrator's credentials.
 * @logic Verify source credentials, identify the administrator through database equality, and reset other authentication state inside the restore transaction.
 * @dependencies Prisma transaction client, database provider, portable backup schema, HTTP errors
 * @index_tags backup,restore,accounts,credentials,preflight
 * @author holic512
 */
import 'server-only'
import { randomUUID } from 'node:crypto'
import { backupSet } from './record-store'
import type { Prisma } from '@generated/prisma-postgresql/client'
import { configuredDatabaseProvider } from '@/server/database/client'
import { HttpError } from '@/server/http/errors'
import type { DatabaseImportPayload } from './database-schema'

export type DatabaseRestoreOptions = {
  actorUserId?: number
  preserveSessionId?: string
  replaceUsers?: boolean
}

function conflict() {
  throw new HttpError('Backup data conflicts with existing records', 409, 409, { reason: 'BACKUP_UNIQUE_CONFLICT' })
}

async function inspectSourceCredentials(tx: Prisma.TransactionClient, payload: DatabaseImportPayload) {
  if (configuredDatabaseProvider() !== 'mysql' || payload.data.users.length < 2) return
  const columns = await tx.$queryRawUnsafe<Array<{ name: string; charset: string; collation: string }>>(`
    SELECT COLUMN_NAME AS name, CHARACTER_SET_NAME AS charset, COLLATION_NAME AS collation
    FROM information_schema.COLUMNS
    WHERE TABLE_SCHEMA = DATABASE() AND TABLE_NAME = 'auth_user'
      AND COLUMN_NAME IN ('username', 'email', 'wallet_address')
  `)
  for (const [field, columnName] of [['username', 'username'], ['email', 'email'], ['walletAddress', 'wallet_address']] as const) {
    const values = payload.data.users.map((user) => user[field]).filter((value): value is string => value !== null)
    if (values.length < 2) continue
    const column = columns.find((column) => column.name === columnName)
    if (!column || !/^[a-zA-Z0-9_]+$/.test(column.charset) || !/^[a-zA-Z0-9_]+$/.test(column.collation)) {
      throw new HttpError('Account collation cannot be verified', 409, 409, { reason: 'BACKUP_INVALID' })
    }
    const table = `sv_backup_credentials_${randomUUID().replaceAll('-', '')}`
    // Identifiers come only from server metadata; all credential values are bound parameters.
    await tx.$executeRawUnsafe(`CREATE TEMPORARY TABLE ${table} (value VARCHAR(255) CHARACTER SET ${column.charset} COLLATE ${column.collation})`)
    try {
      let batch: string[] = []
      const write = async () => { if (batch.length) await tx.$executeRawUnsafe(`INSERT INTO ${table}(value) VALUES ${batch.map(() => '(?)').join(',')}`, ...batch); batch = [] }
      for (const value of values) { batch.push(value); if (batch.length === 100) await write() }
      await write()
      const duplicates = await tx.$queryRawUnsafe<Array<{ duplicateKey: number }>>(`SELECT 1 AS duplicateKey FROM ${table} GROUP BY value HAVING COUNT(*) > 1 LIMIT 1`)
      if (duplicates.length) conflict()
    } finally { await tx.$executeRawUnsafe(`DROP TEMPORARY TABLE ${table}`) }

  }
}

export async function inspectImportAccounts(tx: Prisma.TransactionClient, payload: DatabaseImportPayload, options: DatabaseRestoreOptions = {}) {
  const admin = options.actorUserId === undefined
    ? await tx.user.findFirst({ where: { role: 'ADMIN', status: 1 }, orderBy: { id: 'asc' } })
    : await tx.user.findUnique({ where: { id: options.actorUserId } })
  if (!admin || admin.role !== 'ADMIN' || admin.status !== 1) throw new HttpError('Active administrator not found', 409, 409)
  await inspectSourceCredentials(tx, payload)
  const retainedUserIds = backupSet(payload.data.users)
  let preservedSourceId: string | undefined
  for (const user of payload.data.users) {
    const existing = await tx.user.findUnique({ where: { username: user.username } })
    if (existing) retainedUserIds.add(String(existing.id))
    if (existing?.id === admin.id) {
      if (preservedSourceId !== undefined) conflict()
      preservedSourceId = user.id
    }
  }
  {
    for (const user of payload.data.users) {
      if (user.id === preservedSourceId) continue
      // Let the provider apply its own collation when comparing unique credentials.
      if (await tx.user.findFirst({ where: { id: admin.id, OR: [
        ...(user.email !== null ? [{ email: user.email }] : []),
        ...(user.walletAddress !== null ? [{ walletAddress: user.walletAddress }] : []),
      ] } })) conflict()
    }
  }
  return { admin, preservedSourceId, retainedUserIds }
}

export async function prepareRestoreAccounts(tx: Prisma.TransactionClient, payload: DatabaseImportPayload, policy: Awaited<ReturnType<typeof inspectImportAccounts>>, options: DatabaseRestoreOptions) {
  const { admin } = policy
  let after = 0
  while (true) {
    const users = await tx.user.findMany({ where: { id: { gt: after, not: admin.id } }, orderBy: { id: 'asc' }, take: 100, select: { id: true } })
    if (!users.length) break
    after = users[users.length - 1].id
    const retained = users.filter(user => policy.retainedUserIds.has(String(user.id))).map(user => user.id)
    const removed = users.filter(user => !policy.retainedUserIds.has(String(user.id))).map(user => user.id)
    if (options.replaceUsers && removed.length) await tx.user.deleteMany({ where: { id: { in: removed } } })
    if (retained.length) await tx.user.updateMany({ where: { id: { in: retained } }, data: { email: null, walletAddress: null } })
  }
  await tx.session.updateMany({
    where: options.preserveSessionId ? { id: { not: options.preserveSessionId }, revokedAt: null } : { userId: { not: admin.id }, revokedAt: null },
    data: { revokedAt: new Date() },
  })
  await tx.mcpApiKey.updateMany({ where: { userId: { not: admin.id } }, data: { status: 0 } })
  if (!policy.preservedSourceId) await tx.user.update({ where: { id: admin.id }, data: { pointsBalance: 0 } })
}
