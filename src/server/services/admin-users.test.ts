import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest'
import { randomUUID } from 'node:crypto'
import { mkdtempSync, readdirSync, readFileSync, rmSync } from 'node:fs'
import { tmpdir } from 'node:os'
import { join } from 'node:path'
import Database from 'better-sqlite3'
import { PrismaBetterSqlite3 } from '@prisma/adapter-better-sqlite3'
import { PrismaClient } from '@generated/prisma-sqlite/client'
import type { AppPrismaClient } from '@/server/database/client'
import { Keypair } from '@solana/web3.js'
import nacl from 'tweetnacl'
import bs58 from 'bs58'
import { NextRequest } from 'next/server'

const fixture = vi.hoisted(() => ({ client: null as unknown as AppPrismaClient, root: '' }))
vi.mock('@/server/database/client', () => ({ getDatabaseClient: () => fixture.client, configuredDatabaseProvider: () => 'sqlite', databaseSnapshotIsolationLevel: () => 'Serializable' }))
vi.mock('@/server/prisma', () => ({ get prisma() { return fixture.client } }))
vi.mock('@/server/services/admin-files', async load => ({ ...await load<typeof import('@/server/services/admin-files')>(), get UPLOAD_ROOT() { return fixture.root + '/uploads' } }))
vi.mock('@/server/database/runtime-health', () => ({ readRuntimeInstallationPublicStatus: async () => ({ status: 'INSTALLED' }), isDatabaseConnectivityError: () => false }))
import { insertLegacyCard, legacyCardRows } from '@/test/legacy-cards'
import { snapshotUser } from '@/server/database/user-attribution'
import { withUserAttribution } from '@/server/database/user-attribution'
import { hashPassword } from '@/server/auth/password'
import { mutateAccountWallet } from './account-security'
import { createManagedUser, deleteManagedUser, disableManagedUser, listDeletedUsers, previewManagedUserDeletion, resetManagedUserPassword, updateManagedUser } from './admin-users'
import { contractBodyHash, contractRootHash } from './contract-evidence-protocol'
import { getUserContract } from './contracts'
import { issueSession, readSessionToken } from '@/server/auth/session'
import { createWalletLoginChallenge, verifyWalletLogin } from './wallet-auth'
import { createWorkflow, executeWorkflowCommand, getWorkflow } from '@/server/commissions/workflow'
import { uploadCommissionFile, downloadCommissionFile } from '@/server/commissions/workflow-files'
import { exportDatabaseBackup } from './admin-backup/database-export'
import { DATABASE_BACKUP_VERSION } from './admin-backup/constants'
import { importDatabaseBackup } from './admin-backup/database-import'
import { parseDatabaseImportPayload } from './admin-backup/database-validation'
import { GET as deletionPreviewRoute } from '@/app/api/admin/mm/users/[id]/deletion-preview/route'
import { DELETE as deleteRoute } from '@/app/api/admin/mm/users/[id]/route'
import { GET as historyRoute } from '@/app/api/admin/mm/users/deleted/route'

beforeEach(async () => {
  fixture.root = mkdtempSync(join(tmpdir(), 'sv-account-management-'))
  const path = join(fixture.root, 'test.db'), db = new Database(path)
  db.pragma('foreign_keys=ON')
  for (const name of readdirSync('prisma/providers/sqlite/migrations').filter(name => /^\d/.test(name)).sort()) db.exec(readFileSync(`prisma/providers/sqlite/migrations/${name}/migration.sql`, 'utf8'))
  expect(db.pragma('foreign_key_check')).toEqual([])
  db.close()
  fixture.client = withUserAttribution(new PrismaClient({ adapter: new PrismaBetterSqlite3({ url: `file:${path}` }, { timestampFormat: 'iso8601' }) })) as unknown as AppPrismaClient
  await fixture.client.systemInstallation.create({ data: { id: 1, installationId: randomUUID(), provider: 'sqlite', status: 'INSTALLED', schemaRevision: 16 } })
  for (const [id, username, role] of [[1, 'owner', 'ADMIN'], [2, 'temporary', 'ADMIN'], [3, 'customer', 'USER']] as const) await fixture.client.user.create({ data: { id, username, role, password: 'test-only', displayName: username } })
})
afterEach(async () => { await fixture.client.$disconnect(); rmSync(fixture.root, { recursive: true, force: true }) })
async function createLegacyBatch(data: { name: string; points: number; quantity: number; createdById: number }) {
  return insertLegacyCard(fixture.client, 'giftCardBatches', { ...data, attributionJson: JSON.stringify({ createdById: await snapshotUser(fixture.client, data.createdById) }), status: 1, expiresAt: null, createdAt: new Date(), updatedAt: new Date() })
}
async function readLegacyBatch(id?: number) {
  const rows = await legacyCardRows(fixture.client, 'giftCardBatches', id ? id - 1 : 0)
  return (id ? rows.find(row => row.id === id) : rows[0]) as { id: number; createdById: number | null; attributionJson: string }
}
const actor = { userId: 1, isAdmin: true }, otherAdmin = { userId: 2, isAdmin: true }
async function sessionAndKey(userId: number) {
  const session = await issueSession({ userId })
  await fixture.client.mcpApiKey.create({ data: { userId, publicId: randomUUID(), name: 'test', secretHash: 'test-only' } })
  return session
}
async function walletSignature(userId: number) {
  const wallet = Keypair.generate(), address = wallet.publicKey.toBase58()
  await fixture.client.user.update({ where: { id: userId }, data: { password: await hashPassword('fixture-password') } })
  const session = await issueSession({ userId }), context = { userId, sessionId: session.sessionId }
  const target = { action: 'bind' as const, address }
  const challenge = await createWalletLoginChallenge({ purpose: 'bind', address, target, context })
  const input = { target, ownership: { challengeId: challenge.challengeId, address, signature: bs58.encode(nacl.sign.detached(new TextEncoder().encode(challenge.message), wallet.secretKey)) }, reauth: { method: 'password' as const, password: 'fixture-password' } }
  return { wallet, input, context }
}
async function signInWithWallet(wallet: Keypair) {
  const address = wallet.publicKey.toBase58(), challenge = await createWalletLoginChallenge({ purpose: 'login', address })
  return verifyWalletLogin({ challengeId: challenge.challengeId, address, signature: bs58.encode(nacl.sign.detached(new TextEncoder().encode(challenge.message), wallet.secretKey)), ip: null, userAgent: null })
}

describe('account roles, real deletion and independent history', () => {
  it('creates administrators, defaults to users, and revokes access on promotion and demotion', async () => {
    expect(await createManagedUser({ username: 'new_admin', password: 'safe-password', role: 'ADMIN' }, 1)).toMatchObject({ role: 'ADMIN', status: 1 })
    expect(await createManagedUser({ username: 'new_user', password: 'safe-password' }, 1)).toMatchObject({ role: 'USER' })
    const session = await sessionAndKey(3)
    await updateManagedUser({ actorUserId: 1, userId: 3, values: { role: 'ADMIN' } })
    expect(await readSessionToken(session.token)).toBeNull()
    expect((await fixture.client.mcpApiKey.findFirstOrThrow({ where: { userId: 3 } })).status).toBe(0)
    await updateManagedUser({ actorUserId: 1, userId: 3, values: { role: 'USER' } })
    expect((await fixture.client.user.findUniqueOrThrow({ where: { id: 3 } })).role).toBe('USER')
  })
  it('keeps disabled accounts and wallet bindings and does not restore MCP keys when enabled', async () => {
    const address = Keypair.generate().publicKey.toBase58()
    await fixture.client.user.update({ where: { id: 2 }, data: { walletAddress: address, wallets: { create: { address } } } })
    const session = await sessionAndKey(2)
    await disableManagedUser({ actorUserId: 1, userId: 2 })
    expect(await readSessionToken(session.token)).toBeNull()
    await updateManagedUser({ actorUserId: 1, userId: 2, values: { status: 1 } })
    expect((await fixture.client.user.findUniqueOrThrow({ where: { id: 2 } })).walletAddress).toBe(address)
    expect((await fixture.client.mcpApiKey.findFirstOrThrow()).status).toBe(0)
  })
  it('protects the current administrator and serializes competing administrator removals', async () => {
    for (const values of [{ role: 'USER' as const }, { status: 0 }]) await expect(updateManagedUser({ actorUserId: 1, userId: 1, values })).rejects.toMatchObject({ data: { reason: 'CURRENT_ADMIN' } })
    await expect(deleteManagedUser({ actorUserId: 1, userId: 1 })).rejects.toMatchObject({ data: { reason: 'USER_DELETE_BLOCKED' } })
    const results = await Promise.allSettled([deleteManagedUser({ actorUserId: 1, userId: 2 }), deleteManagedUser({ actorUserId: 2, userId: 1 })])
    expect(results.filter(result => result.status === 'fulfilled')).toHaveLength(1)
    expect(await fixture.client.user.count({ where: { role: 'ADMIN', status: 1 } })).toBe(1)
    const last = await previewManagedUserDeletion({ actorUserId: 1, userId: 1 })
    expect(last.blockers.map(item => item.reason)).toContain('LAST_ADMIN')
  })
  it('deletes points, memberships and credentials but never makes redeemed gift cards reusable', async () => {
    const level = await fixture.client.membershipLevel.create({ data: { name: 'Member', rank: 1, pricePoints: 10 } })
    await fixture.client.membershipGrant.create({ data: { userId: 3, membershipLevelId: level.id, source: 'ADMIN_GRANT', grantedByUserId: 2 } })
    const batch = await createLegacyBatch({ name: 'Gift', points: 10, quantity: 1, createdById: 2 })
    await insertLegacyCard(fixture.client, 'giftCards', { batchId: batch.id, codeHash: 'a'.repeat(64), codeHint: 'card', status: 2, redeemedById: 3, redeemedAt: new Date(), createdAt: new Date() })
    await fixture.client.pointTransaction.create({ data: { userId: 3, type: 'ADMIN_ADJUSTMENT', referenceId: '2', amount: 10, balanceAfter: 10 } })
    await fixture.client.pluginPointReceipt.create({ data: { pluginId: 'slothvault.gift-cards', sourceKey: 'historical-redeem', userId: 3, amount: 10, balanceAfter: 10 } })
    const session = await sessionAndKey(3)
    const preview = await previewManagedUserDeletion({ actorUserId: 1, userId: 3 })
    expect(preview).toMatchObject({ allowed: true, cleanup: { pointTransactions: 1, membershipGrants: 1 } })
    await deleteManagedUser({ actorUserId: 1, userId: 3 })
    expect(await fixture.client.user.findUnique({ where: { id: 3 } })).toBeNull()
    expect((await fixture.client.pluginPointReceipt.findFirstOrThrow()).userId).toBeNull()
    expect(await fixture.client.pointTransaction.count()).toBe(0)
    expect(await fixture.client.membershipGrant.count()).toBe(0)
    expect(await fixture.client.session.count({ where: { userId: 3 } })).toBe(0)
    expect(await readSessionToken(session.token)).toBeNull()
    expect((await legacyCardRows(fixture.client, 'giftCards', 0))[0]).toMatchObject({ status: 2, redeemedById: null })
    expect(JSON.stringify(await listDeletedUsers({ page: 1, pageSize: 20 }))).not.toMatch(/password|secretHash|tokenHash|walletAddress/)
  })
  it('merges later revocation attribution without changing the original grant operator', async () => {
    const level = await fixture.client.membershipLevel.create({ data: { name: 'Member', rank: 1, pricePoints: 10 } })
    const grant = await fixture.client.membershipGrant.create({ data: { userId: 3, membershipLevelId: level.id, source: 'ADMIN_GRANT', grantedByUserId: 2 } })
    await updateManagedUser({ actorUserId: 1, userId: 2, values: { username: 'renamed' } })
    await fixture.client.membershipGrant.updateMany({ where: { id: grant.id }, data: { revokedAt: new Date(), revokedByUserId: 1 } })
    await deleteManagedUser({ actorUserId: 1, userId: 2 })
    const stored = await fixture.client.membershipGrant.findUniqueOrThrow({ where: { id: grant.id } })
    expect(stored.grantedByUserId).toBeNull()
    expect(JSON.parse(stored.attributionJson)).toMatchObject({ grantedByUserId: { username: 'temporary' }, revokedByUserId: { username: 'owner' } })
  })
  it('rolls back cleanup, detached references and audit records when final deletion fails', async () => {
    const batch = await createLegacyBatch({ name: 'Rollback', points: 1, quantity: 1, createdById: 2 })
    const session = await sessionAndKey(2)
    await fixture.client.$executeRawUnsafe("CREATE TRIGGER reject_account_deletion BEFORE DELETE ON auth_user WHEN OLD.id = 2 BEGIN SELECT RAISE(ABORT, 'injected deletion failure'); END")
    await expect(deleteManagedUser({ actorUserId: 1, userId: 2 })).rejects.toThrow()
    expect((await readLegacyBatch(batch.id)).createdById).toBe(2)
    expect(await fixture.client.userDeletionRecord.count()).toBe(0)
    expect(await readSessionToken(session.token)).not.toBeNull()
    expect((await fixture.client.mcpApiKey.findFirstOrThrow()).status).toBe(1)
  })
  it('releases a wallet for fresh login and binding and rejects stale binding challenges', async () => {
    const wallet = Keypair.generate(), address = wallet.publicKey.toBase58()
    await fixture.client.user.update({ where: { id: 3 }, data: { walletAddress: address, pointsBalance: 100, wallets: { create: { address } } } })
    const stale = await walletSignature(3)
    await deleteManagedUser({ actorUserId: 1, userId: 3 })
    await expect(mutateAccountWallet(stale.context, stale.input)).rejects.toMatchObject({ status: 401 })
    const fresh = await signInWithWallet(wallet)
    expect(fresh.user).toMatchObject({ role: 'USER', pointsBalance: 0, walletAddress: address })
    expect(fresh.user.id).not.toBe('3')
    await deleteManagedUser({ actorUserId: 1, userId: Number(fresh.user.id) })
    const signing = await walletSignature(2)
    const bound = await mutateAccountWallet(signing.context, signing.input)
    expect(bound.user).toMatchObject({ id: '2', walletAddress: signing.wallet.publicKey.toBase58() })
  })
  it('rejects binding to a disabled account after challenge issuance', async () => {
    const signed = await walletSignature(3)
    await disableManagedUser({ actorUserId: 1, userId: 3 })
    await expect(mutateAccountWallet(signed.context, signed.input)).rejects.toMatchObject({ status: 401 })
    expect((await fixture.client.user.findUniqueOrThrow({ where: { id: 3 } })).walletAddress).toBeNull()
  })
  it('blocks customer records even after promotion and never partially clears an account', async () => {
    await fixture.client.contract.create({ data: { contractId: randomUUID(), issuerUserId: 2, subjectUserId: 3, title: 'Draft', body: 'Retained', bodyHash: 'a'.repeat(64), partyCommitment: 'b'.repeat(64) } })
    await updateManagedUser({ actorUserId: 1, userId: 3, values: { role: 'ADMIN' } })
    const preview = await previewManagedUserDeletion({ actorUserId: 1, userId: 3 })
    expect(preview.blockers).toContainEqual({ reason: 'CUSTOMER_CONTRACTS', count: 1 })
    await expect(deleteManagedUser({ actorUserId: 1, userId: 3 })).rejects.toMatchObject({ status: 409 })
    expect(await fixture.client.user.count({ where: { id: 3 } })).toBe(1)
    expect(await fixture.client.userDeletionRecord.count()).toBe(0)
    expect(await fixture.client.contract.count()).toBe(1)
  })
  it('retains site-owned contracts and unpublished attachments after deleting their operator', async () => {
    const installationId = (await fixture.client.systemInstallation.findUniqueOrThrow({ where: { id: 1 } })).installationId
    const contractId = randomUUID(), body = 'Frozen\n', bodyHash = contractBodyHash(body), issuedAt = new Date(), signedAt = new Date()
    const hashInput = { installationId, contractId, title: 'Contract', bodyHash, attachmentHash: null, partyCommitment: 'b'.repeat(64), issuedAt, signedAt }
    const contractHash = contractRootHash(hashInput)
    const contract = await fixture.client.contract.create({ data: { ...hashInput, issuerUserId: 2, subjectUserId: 3, body, contractHash, status: 2, adminAudits: { create: { actorUserId: 2, action: 'ISSUED' } } } })
    let workflow = await createWorkflow(otherAdmin, { commandId: randomUUID(), title: 'Site work', requirements: '', draft: true })
    workflow = await uploadCommissionFile(Number(workflow.id), otherAdmin, new Request('http://localhost/upload', { method: 'POST', body: 'private draft' }), { name: 'source.txt', purpose: 'DELIVERY', shared: false, commandId: randomUUID() })
    const key = workflow.files[0].key
    expect((await getWorkflow(Number(workflow.id), actor)).files.map(file => file.key)).toContain(key)
    await deleteManagedUser({ actorUserId: 1, userId: 2 })
    const after = await fixture.client.contract.findUniqueOrThrow({ where: { id: contract.id } })
    expect(after).toMatchObject({ issuerUserId: null, body: contract.body, bodyHash: contract.bodyHash, partyCommitment: contract.partyCommitment })
    expect(JSON.parse(after.attributionJson).issuerUserId.username).toBe('temporary')
    expect(contractRootHash({ ...hashInput, bodyHash: after.bodyHash, partyCommitment: after.partyCommitment })).toBe(after.contractHash)
    expect(await getUserContract(3, contract.id)).toMatchObject({ providerAccount: 'temporary', issuer: { id: null, username: 'temporary' } })
    expect(await fixture.client.contractAdminAudit.findFirstOrThrow()).toMatchObject({ actorUserId: null })
    const file = await fixture.client.commissionFile.findFirstOrThrow()
    expect(file.uploaderUserId).toBeNull()
    expect(await (await downloadCommissionFile(Number(workflow.id), file.id, actor)).text()).toBe('private draft')
    workflow = await executeWorkflowCommand(Number(workflow.id), actor, { action: 'submission.create', kind: 'COMMENT', commandId: randomUUID(), revision: workflow.revision, note: 'Continued', fileKeys: [key] })
    expect(workflow.events.at(-1)?.snapshot.actor.name).toBe('owner')
  })
  it('preserves deleted operators through renames, demotion and later deletion of the deleting administrator', async () => {
    const batch = await createLegacyBatch({ name: 'Site', points: 1, quantity: 1, createdById: 2 })
    await updateManagedUser({ actorUserId: 1, userId: 2, values: { username: 'renamed', role: 'USER' } })
    await deleteManagedUser({ actorUserId: 1, userId: 2 })
    const historical = await readLegacyBatch(batch.id)
    expect(JSON.parse(historical.attributionJson).createdById.username).toBe('temporary')
    await updateManagedUser({ actorUserId: 1, userId: 3, values: { role: 'ADMIN' } })
    await deleteManagedUser({ actorUserId: 3, userId: 1 })
    const history = await listDeletedUsers({ page: 1, pageSize: 20 })
    expect(history.list.find(row => row.user.userId === '2')?.actor.username).toBe('owner')
  })
  it('resets credentials and rechecks the administrator inside the transaction', async () => {
    const session = await sessionAndKey(3)
    await resetManagedUserPassword({ actorUserId: 1, userId: 3, password: 'new-safe-password' })
    expect(await readSessionToken(session.token)).toBeNull()
    await expect(createManagedUser({ username: 'forbidden', password: 'safe-password', role: 'ADMIN' }, 3)).rejects.toMatchObject({ status: 401 })
  })
  it('round-trips attribution, merges deletion logs by UUID and imports multiple administrators', async () => {
    await createLegacyBatch({ name: 'Site', points: 1, quantity: 1, createdById: 2 })
    const before = await exportDatabaseBackup()
    await deleteManagedUser({ actorUserId: 1, userId: 2 })
    await importDatabaseBackup(parseDatabaseImportPayload({ version: before.version, data: before.data, mode: 'overwrite' }))
    expect(await fixture.client.user.count({ where: { role: 'ADMIN' } })).toBe(2)
    expect(await fixture.client.userDeletionRecord.count()).toBe(1)
    const restored = await fixture.client.user.findUniqueOrThrow({ where: { username: 'temporary' } })
    await deleteManagedUser({ actorUserId: 1, userId: restored.id })
    const after = await exportDatabaseBackup()
    expect(after.data).not.toHaveProperty('giftCardBatches')
    await importDatabaseBackup(parseDatabaseImportPayload({ version: after.version, data: after.data, mode: 'overwrite' }))
    await importDatabaseBackup(parseDatabaseImportPayload({ version: after.version, data: after.data, mode: 'overwrite' }))
    expect(await fixture.client.userDeletionRecord.count()).toBe(2)
    expect(await readLegacyBatch()).toBeUndefined()
  })
  it('converts explicitly validated 2.13.0 backups and rejects detached legacy operator references', async () => {
    await createLegacyBatch({ name: 'Legacy', points: 1, quantity: 1, createdById: 2 })
    const backup = await exportDatabaseBackup()
    const legacy = JSON.parse(JSON.stringify(backup.data)) as Record<string, Array<Record<string, unknown>>>
    delete legacy.userDeletionRecords
    delete legacy.userWallets
    for (const key of Object.keys(legacy)) if (key.startsWith('plugin')) delete legacy[key]
    for (const user of legacy.users) {
      delete user.usernameChangeMonth
      delete user.usernameChangeCount
      delete user.credentialsRevision
    }
    for (const rows of Object.values(legacy)) for (const row of rows) delete row.attributionJson
    const converted = parseDatabaseImportPayload({ version: '2.13.0', mode: 'overwrite', data: legacy })
    expect(converted.version).toBe(DATABASE_BACKUP_VERSION)
    expect(converted.data.userDeletionRecords).toEqual([])
    expect(converted.data.giftCardBatches).toEqual([])
    expect(converted.data.giftCards).toEqual([])
    await importDatabaseBackup(converted)
    legacy.giftCardBatches = [{ id: '1', name: 'Retired', points: 1, quantity: 1, expiresAt: null, status: 1, createdById: null, createdAt: new Date().toISOString(), updatedAt: new Date().toISOString() }]
    expect(() => parseDatabaseImportPayload({ version: '2.13.0', mode: 'overwrite', data: legacy })).toThrow()
  })
  it('authenticates deletion routes and exposes preview and history without credentials', async () => {
    const session = await issueSession({ userId: 1 })
    const request = (path: string, token = session.token, method = 'GET') => new NextRequest(`http://localhost/api/admin/mm/users/${path}`, { method, headers: { cookie: `sv_session=${token}` } })
    const context = { params: Promise.resolve({ id: '2' }) }
    expect((await deletionPreviewRoute(request('2/deletion-preview', ''), context)).status).toBe(401)
    const marker = await fixture.client.systemInstallation.findUniqueOrThrow({ where: { id: 1 } })
    expect((await deletionPreviewRoute(request('2/deletion-preview'), context)).status).toBe(200)
    expect((await fixture.client.systemInstallation.findUniqueOrThrow({ where: { id: 1 } })).updatedAt).toEqual(marker.updatedAt)
    expect((await deleteRoute(request('2', session.token, 'DELETE'), context)).status).toBe(200)
    const response = await historyRoute(request('deleted'), { params: Promise.resolve({}) })
    expect(response.status).toBe(200)
    expect((await response.json()).data.list[0].user.username).toBe('temporary')
  })
})
