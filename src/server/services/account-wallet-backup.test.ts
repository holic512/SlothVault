import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest'
import { randomUUID } from 'node:crypto'
import { Keypair } from '@solana/web3.js'
import type { AppPrismaClient } from '@/server/database/client'
import { personalSecurityDatabase } from '@/test/personal-security-database'
const fixture = vi.hoisted(() => ({ client: null as unknown as AppPrismaClient }))
vi.mock('@/server/database/client', () => ({ getDatabaseClient: () => fixture.client, configuredDatabaseProvider: () => 'sqlite', databaseSnapshotIsolationLevel: () => 'Serializable' }))
vi.mock('@/server/prisma', () => ({ get prisma() { return fixture.client } }))
import { exportDatabaseBackup } from './admin-backup/database-export'
import { importDatabaseBackup } from './admin-backup/database-import'
import { parseDatabaseImportPayload } from './admin-backup/database-validation'
import { issueSession, readSessionToken } from '@/server/auth/session'
let database: ReturnType<typeof personalSecurityDatabase>
beforeEach(async () => {
  database = personalSecurityDatabase(); fixture.client = database.client
  await fixture.client.systemInstallation.create({ data: { id: 1, installationId: randomUUID(), provider: 'sqlite', status: 'INSTALLED', schemaRevision: 16 } })
})
afterEach(async () => { await database.close() })
const address = () => Keypair.generate().publicKey.toBase58()
async function seed() {
  const adminAddress = address(), memberAddress = address(), memberSecond = address()
  const admin = await fixture.client.user.create({ data: { username: 'backup_admin', role: 'ADMIN', password: 'admin-original', walletAddress: adminAddress, wallets: { create: { address: adminAddress } } } })
  const member = await fixture.client.user.create({ data: { username: 'backup_member', password: 'member-original', usernameChangeMonth: '2026-10', usernameChangeCount: 2, credentialsRevision: 4, walletAddress: memberAddress, wallets: { create: [{ address: memberAddress, createdAt: new Date('2026-10-01T00:00:00Z') }, { address: memberSecond, createdAt: new Date('2026-10-02T00:00:00Z') }] } } })
  return { admin, member, adminAddress, memberAddress, memberSecond }
}
describe('portable multi-wallet backups', () => {
  it('restores every member wallet and quota while retaining the current administrator credentials and session', async () => {
    const seeded = await seed(), snapshot = await exportDatabaseBackup(), adminExtra = address()
    expect(snapshot.version).toBe('2.18.0')
    const session = await issueSession({ userId: seeded.admin.id })
    await fixture.client.userWallet.create({ data: { userId: seeded.admin.id, address: adminExtra } })
    await fixture.client.user.update({ where: { id: seeded.admin.id }, data: { password: 'admin-current', usernameChangeMonth: '2026-10', usernameChangeCount: 3, credentialsRevision: 8 } })
    await fixture.client.userWallet.deleteMany({ where: { userId: seeded.member.id } })
    await fixture.client.user.update({ where: { id: seeded.member.id }, data: { walletAddress: null, usernameChangeCount: 0, credentialsRevision: 20 } })
    await importDatabaseBackup(parseDatabaseImportPayload({ version: snapshot.version, mode: 'overwrite', data: snapshot.data }), { actorUserId: seeded.admin.id, preserveSessionId: session.sessionId, replaceUsers: true })
    const member = await fixture.client.user.findUniqueOrThrow({ where: { username: 'backup_member' }, include: { wallets: true } })
    expect(member.wallets.map(wallet => wallet.address).sort()).toEqual([seeded.memberAddress, seeded.memberSecond].sort())
    expect(member).toMatchObject({ usernameChangeMonth: '2026-10', usernameChangeCount: 2, credentialsRevision: 4, walletAddress: seeded.memberAddress })
    const admin = await fixture.client.user.findUniqueOrThrow({ where: { id: seeded.admin.id }, include: { wallets: true } })
    expect(admin).toMatchObject({ password: 'admin-current', usernameChangeCount: 3, credentialsRevision: 8 })
    expect(admin.wallets.map(wallet => wallet.address).sort()).toEqual([seeded.adminAddress, adminExtra].sort())
    expect(await readSessionToken(session.token)).not.toBeNull()
  })
  it('rejects a conflict with the preserved administrator secondary wallet before changing any data', async () => {
    const seeded = await seed(), snapshot = await exportDatabaseBackup(), extra = address()
    await fixture.client.userWallet.create({ data: { userId: seeded.admin.id, address: extra } })
    const second = snapshot.data.userWallets.find(wallet => wallet.address === seeded.memberSecond)!
    second.address = extra
    const payload = parseDatabaseImportPayload({ version: snapshot.version, mode: 'overwrite', data: snapshot.data })
    await expect(importDatabaseBackup(payload, { actorUserId: seeded.admin.id, replaceUsers: true })).rejects.toMatchObject({ data: { reason: 'BACKUP_UNIQUE_CONFLICT' } })
    expect(await fixture.client.userWallet.count()).toBe(4)
    expect((await fixture.client.user.findUniqueOrThrow({ where: { id: seeded.member.id } })).credentialsRevision).toBe(4)
  })
  it.each(['2.13.0', '2.14.0'])('converts the explicit %s source contract into one binding per old address', async version => {
    const seeded = await seed(), snapshot = await exportDatabaseBackup()
    const data = JSON.parse(JSON.stringify(snapshot.data)) as Record<string, Array<Record<string, unknown>>>
    for (const key of ['pluginInstallations','pluginTables','pluginMigrations','pluginPointReceipts','pluginRows']) delete data[key]
    delete data.userWallets
    for (const user of data.users) { delete user.usernameChangeMonth; delete user.usernameChangeCount; delete user.credentialsRevision }
    if (version === '2.13.0') delete data.userDeletionRecords
    const converted = parseDatabaseImportPayload({ version, mode: 'overwrite', data })
    expect(converted.version).toBe('2.18.0')
    expect(converted.data.userWallets.map(wallet => wallet.address).sort()).toEqual([seeded.adminAddress, seeded.memberAddress].sort())
    expect(converted.data.users.every(user => user.usernameChangeCount === 0 && user.credentialsRevision === 0)).toBe(true)
  })
  it('rejects duplicate or orphaned wallet records and a mismatched legacy projection', async () => {
    await seed(); const snapshot = await exportDatabaseBackup()
    const payload = () => ({ version: snapshot.version, mode: 'overwrite', data: structuredClone(snapshot.data) })
    const duplicate = payload(); duplicate.data.userWallets.push({ ...duplicate.data.userWallets[0], id: '999' })
    expect(() => parseDatabaseImportPayload(duplicate)).toThrow(/wallet binding address/)
    const orphan = payload(); orphan.data.userWallets[0].userId = '999'
    expect(() => parseDatabaseImportPayload(orphan)).toThrow(/wallet binding userId/)
    const mismatched = payload(); mismatched.data.users[0].walletAddress = null
    expect(() => parseDatabaseImportPayload(mismatched)).toThrow(/wallet projection mismatch/)
  })
})
