import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest'
import { randomUUID } from 'node:crypto'
import { mkdirSync, readdirSync, readFileSync } from 'node:fs'
import { rm } from 'node:fs/promises'
import Database from 'better-sqlite3'
import { PrismaBetterSqlite3 } from '@prisma/adapter-better-sqlite3'
import { PrismaClient } from '@generated/prisma-sqlite/client'
import type { AppPrismaClient } from '@/server/database/client'
import type { CommissionActor } from './input'
const fixture = vi.hoisted(() => ({ client: null as unknown as AppPrismaClient, root: `/tmp/slothvault-workflow-evidence-tests-${process.pid}-${Date.now()}`, queue: Promise.resolve() }))
vi.mock('next/cache', async (load) => ({ ...await load<typeof import('next/cache')>(), revalidateTag: vi.fn() }))
vi.mock('@/server/database/client', () => ({ configuredDatabaseProvider: () => 'sqlite', databaseSnapshotIsolationLevel: () => undefined }))
vi.mock('@/server/prisma', () => ({ prisma: new Proxy({}, { get: (_target, key) => { const v = Reflect.get(fixture.client, key, fixture.client); return typeof v === 'function' ? v.bind(fixture.client) : v } }) }))
vi.mock('@/server/database/unit-of-work', () => ({ unitOfWork: { execute: async (fn: Parameters<AppPrismaClient['$transaction']>[0]) => {
  const previous = fixture.queue
  let release!: () => void
  fixture.queue = new Promise<void>((resolve) => { release = resolve })
  await previous
  try { return await fixture.client.$transaction(fn as never, { timeout: 30000 }) } finally { release() }
} } }))
vi.mock('@/server/services/admin-files', async (load) => ({ ...await load<typeof import('@/server/services/admin-files')>(), UPLOAD_ROOT: fixture.root + '/uploads' }))
import { Keypair, Transaction } from '@solana/web3.js'
import bs58 from 'bs58'
const rpc = vi.hoisted(() => ({ latest: vi.fn(), fee: vi.fn(), balance: vi.fn(), send: vi.fn(), height: vi.fn(), finalized: vi.fn() }))
vi.mock('@/server/services/system-config', () => ({ requireEnabledSolanaNetwork: vi.fn() }))
vi.mock('@/server/services/release-evidence-chain', () => ({ withEvidenceRpc: (_network: unknown, fn: (connection: object) => unknown) => fn({ getLatestBlockhash: rpc.latest, getFeeForMessage: rpc.fee, getBalance: rpc.balance, sendRawTransaction: rpc.send, getBlockHeight: rpc.height }), finalizedEvidenceTransaction: rpc.finalized }))
import { createWorkflow } from './workflow'
import { prepareWorkflowEvidence, submitWorkflowEvidence, cancelWorkflowEvidence, reconcileWorkflowEvidence, publicWorkflowEvidence } from './evidence'
import { exportCommissionCollections, importCommissionCollections } from './backup'
import { validateWorkflowBackup } from './workflow-backup'
import type { WorkflowDetail } from '@/lib/commission-workflow'
let d: WorkflowDetail, signer: Keypair
const admin: CommissionActor = { userId: 1, isAdmin: true }, customer: CommissionActor = { userId: 2, isAdmin: false }
beforeEach(async () => {
  mkdirSync(fixture.root, { recursive: true })
  const path = fixture.root + '/test.sqlite', db = new Database(path)
  for (const dir of readdirSync('prisma/providers/sqlite/migrations').filter((v) => /^\d/.test(v)).sort()) db.exec(readFileSync(`prisma/providers/sqlite/migrations/${dir}/migration.sql`, 'utf8'))
  db.close()
  fixture.client = new PrismaClient({ adapter: new PrismaBetterSqlite3({ url: 'file:' + path }, { timestampFormat: 'iso8601' }) }) as unknown as AppPrismaClient
  for (const [id, role] of [[1, 'ADMIN'], [2, 'USER']] as const) await fixture.client.user.create({ data: { id, username: `actor${id}`, password: 'test', role } })
  d = await createWorkflow(customer, { commandId: randomUUID(), title: 'secret title', requirements: 'private requirement text', draft: false })
  signer = Keypair.generate()
  rpc.latest.mockResolvedValue({ blockhash: Keypair.generate().publicKey.toBase58(), lastValidBlockHeight: 100 })
  rpc.fee.mockResolvedValue({ value: 5000 }); rpc.balance.mockResolvedValue(100000); rpc.height.mockResolvedValue(99)
  rpc.finalized.mockResolvedValue(null)
  rpc.send.mockImplementation(async (bytes: Buffer) => bs58.encode(Transaction.from(bytes).signature!))
})
afterEach(async () => { vi.useRealTimers(); vi.clearAllMocks(); await fixture.client.$disconnect(); await rm(fixture.root, { recursive: true, force: true }) })
async function prepare() { return prepareWorkflowEvidence({ eventId: d.events[0].id, network: 'devnet', signerAddress: signer.publicKey.toBase58(), issuerUserId: admin.userId }) }
function signed(base64: string) { const transaction = Transaction.from(Buffer.from(base64, 'base64')); transaction.sign(signer); return transaction }
describe('commission wallet evidence', () => {
  it('stores only a private-content commitment on chain and independently verifies finalized receipts', async () => {
    const prepared = await prepare()
    expect(prepared.memo).not.toContain('private requirement'); expect(prepared.memo).not.toContain('secret title'); expect(prepared.memo).not.toContain('actor2')
    const transaction = signed(prepared.transactionBase64)
    const sent = await submitWorkflowEvidence(Number(prepared.attemptId), 1, transaction.serialize().toString('base64'))
    expect(sent.status).toBe('SUBMITTED')
    rpc.finalized.mockResolvedValue({ transaction, failed: false, slot: 99n, blockTime: new Date(), feeLamports: 5000n })
    expect(await reconcileWorkflowEvidence(Number(prepared.attemptId))).toMatchObject({ status: 'FINALIZED' })
    const publicResult = await publicWorkflowEvidence(sent.signature!)
    expect(publicResult.verified).toBe(true)
    expect(JSON.stringify(publicResult)).not.toContain('private requirement')
    await expect(prepare()).rejects.toThrow('已有')
    const backup = await exportCommissionCollections(fixture.client as never)
    validateWorkflowBackup(backup)
    const forged = structuredClone(backup)
    forged.commissionProofAttempts[0].memo = '{}'
    expect(() => validateWorkflowBackup(forged)).toThrow('differs')
    const before = await fixture.client.commissionSubmission.findFirstOrThrow()
    await fixture.client.commissionProofAttempt.deleteMany()
    await fixture.client.commissionSubmission.deleteMany()
    await fixture.client.commissionEvent.deleteMany()
    await fixture.client.commission.deleteMany()
    const maps = { users: new Map([['1', 1], ['2', 2]]), fileManagements: new Map<string, number>() }
    await importCommissionCollections(fixture.client as never, backup, maps, true)
    await importCommissionCollections(fixture.client as never, backup, maps, false)
    expect((await fixture.client.commissionSubmission.findFirstOrThrow()).snapshotJson).toBe(before.snapshotJson)
    expect((await publicWorkflowEvidence(sent.signature!)).verified).toBe(true)
  })
  it('keeps frozen content when signing is cancelled and permits a new attempt', async () => {
    const first = await prepare()
    await cancelWorkflowEvidence(Number(first.attemptId), 1)
    const next = await prepare()
    expect(next.attemptId).not.toBe(first.attemptId)
    expect(next.memo).toBe(first.memo)
    expect((await fixture.client.commissionSubmission.findFirst())?.snapshotHash).toBe(d.events[0].hash)
    await expect(submitWorkflowEvidence(Number(first.attemptId), 1, signed(first.transactionBase64).serialize().toString('base64'))).rejects.toThrow('失效')
  })
  it('rejects altered signed payloads and expired wallet windows', async () => {
    const prepared = await prepare(), transaction = signed(prepared.transactionBase64)
    transaction.instructions[0].data = Buffer.from('different memo'); transaction.sign(signer)
    await expect(submitWorkflowEvidence(Number(prepared.attemptId), 1, transaction.serialize().toString('base64'))).rejects.toThrow('does not match')
    await fixture.client.commissionProofAttempt.update({ where: { id: Number(prepared.attemptId) }, data: { expiresAt: new Date(0) } })
    await expect(submitWorkflowEvidence(Number(prepared.attemptId), 1, signed(prepared.transactionBase64).serialize().toString('base64'))).rejects.toThrow('失效')
  })
  it('preserves the signed bytes after RPC failure and reconciles blockhash expiry without duplicate snapshots', async () => {
    const prepared = await prepare(), transaction = signed(prepared.transactionBase64)
    rpc.send.mockRejectedValue(new Error('network disconnected'))
    await submitWorkflowEvidence(Number(prepared.attemptId), 1, transaction.serialize().toString('base64'))
    const row = await fixture.client.commissionProofAttempt.findUniqueOrThrow({ where: { id: Number(prepared.attemptId) } })
    expect(row.status).toBe('SUBMITTED'); expect(row.transactionSignature).toBe(bs58.encode(transaction.signature!))
    rpc.height.mockResolvedValue(101)
    expect(await reconcileWorkflowEvidence(row.id)).toMatchObject({ status: 'FAILED' })
    await prepare()
    expect(await fixture.client.commissionSubmission.count()).toBe(1)
  })
  it('does not finalize an incorrect chain transaction', async () => {
    const prepared = await prepare(), transaction = signed(prepared.transactionBase64)
    await submitWorkflowEvidence(Number(prepared.attemptId), 1, transaction.serialize().toString('base64'))
    transaction.instructions[0].data = Buffer.from('wrong'); transaction.sign(signer)
    rpc.finalized.mockResolvedValue({ transaction, failed: false, slot: 99n, blockTime: new Date(), feeLamports: 5000n })
    expect(await reconcileWorkflowEvidence(Number(prepared.attemptId))).toMatchObject({ status: 'FAILED' })
  })
})
