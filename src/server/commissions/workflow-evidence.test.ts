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
vi.mock('@/server/database/runtime-health', () => ({ readRuntimeInstallationPublicStatus: async () => ({ status: 'INSTALLED' }), isDatabaseConnectivityError: () => false }))
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
import { Keypair, SendTransactionError, Transaction } from '@solana/web3.js'
import bs58 from 'bs58'
const rpc = vi.hoisted(() => ({ latest: vi.fn(), fee: vi.fn(), balance: vi.fn(), send: vi.fn(), height: vi.fn(), finalized: vi.fn() }))
vi.mock('@/server/services/system-config', () => ({ requireEnabledSolanaNetwork: vi.fn() }))
vi.mock('@/server/services/release-evidence-chain', () => ({ withEvidenceRpc: (_network: unknown, fn: (connection: object) => unknown) => fn({ getLatestBlockhash: rpc.latest, getFeeForMessage: rpc.fee, getBalance: rpc.balance, sendRawTransaction: rpc.send, getBlockHeight: rpc.height }), finalizedEvidenceTransaction: rpc.finalized }))
import { issueSession } from '@/server/auth/session'
import { NextRequest } from 'next/server'
import unzipper from 'unzipper'
import { GET as adminReceiptGet } from '@/app/api/admin/evidence/receipts/[kind]/[signature]/route'
import { GET as publicReceiptGet } from '@/app/api/commission-evidence/[signature]/route'
import { getCommission } from './service'
import { commissionArchive as legacyArchive } from './files'
import { commissionArchive } from './workflow-files'
import { createWorkflow, getWorkflow } from './workflow'
import { prepareWorkflowEvidence, submitWorkflowEvidence, cancelWorkflowEvidence, reconcileWorkflowEvidence, publicWorkflowEvidence, verifyAdminWorkflowEvidence, getPublicWorkflowEvidenceReceipt } from './evidence'
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
  it.each([[[]], [['devnet']], [['mainnet']], [['mainnet', 'devnet']]])('filters user workflow details and ZIP proofs without rewriting snapshots for %j', async (networks) => {
    const event = await fixture.client.commissionSubmission.findFirstOrThrow()
    for (const network of networks) await fixture.client.commissionProofAttempt.create({ data: { submissionId: event.id, issuerUserId: 1, network, signerAddress: signer.publicKey.toBase58(), status: 'FINALIZED', memo: '{}', messageHash: 'a'.repeat(64), transactionBase64: '', lastValidBlockHeight: 100n, expiresAt: new Date(), transactionSignature: (network === 'mainnet' ? '6' : '7').repeat(88) } })
    for (const actor of [customer, admin]) {
      const expected = networks.filter(n => actor.isAdmin || n === 'mainnet')
      expect((await getWorkflow(Number(d.id), actor)).events[0].proofs.map(p => p.network).sort()).toEqual([...expected].sort())
      const response = await commissionArchive(Number(d.id), actor)
      const archive = await unzipper.Open.buffer(Buffer.from(await response.arrayBuffer()))
      const manifest = JSON.parse((await archive.files.find(f => f.path === 'manifest.json')!.buffer()).toString())
      expect(manifest.events[0].proofs.map((p: { network: string }) => p.network).sort()).toEqual([...expected].sort())
      expect((await archive.files.find(f => f.path === `snapshots/${event.publicId}.json`)!.buffer()).toString()).toBe(event.snapshotJson)
    }
    const contract = await fixture.client.contract.create({ data: { contractId: randomUUID(), commissionId: Number(d.id), issuerUserId: 1, subjectUserId: 2, title: 'Retained document', body: 'Body', bodyHash: 'a'.repeat(64), partyCommitment: 'b'.repeat(64), issuedAt: new Date(), status: 2 } })
    for (const network of networks) await fixture.client.contractCredential.create({ data: { contractId: contract.id, network, signerAddress: signer.publicKey.toBase58(), memo: '{}', status: 2 } })
    for (const actor of [customer, admin]) {
      const expected = networks.filter(n => actor.isAdmin || n === 'mainnet')
      expect((await getCommission(Number(d.id), actor)).documents[0].credentials.map(p => p.network).sort()).toEqual([...expected].sort())
      const response = await legacyArchive(Number(d.id), actor)
      const archive = await unzipper.Open.buffer(Buffer.from(await response.arrayBuffer()))
      const records = JSON.parse((await archive.files.find(f => f.path === 'project-records.json')!.buffer()).toString())
      expect(records.documents[0].credentials.map((p: { network: string }) => p.network).sort()).toEqual([...expected].sort())
    }
  })
  it('protects Devnet routes for every public identity while allowing only active administrators in the backend', async () => {
    const prepared = await prepare(), transaction = signed(prepared.transactionBase64)
    const sent = await submitWorkflowEvidence(Number(prepared.attemptId), 1, transaction.serialize().toString('base64'))
    const sig = sent.signature!, adminSession = await issueSession({ userId: 1 }), userSession = await issueSession({ userId: 2 })
    rpc.finalized.mockClear()
    await expect(publicWorkflowEvidence(sig)).rejects.toMatchObject({ status: 404 })
    await expect(getPublicWorkflowEvidenceReceipt(sig)).rejects.toMatchObject({ status: 404 })
    for (const token of [null, userSession.token, adminSession.token]) {
      const headers = token ? { cookie: `sv_session=${token}` } : undefined
      const publicResponse = await publicReceiptGet(new NextRequest(`http://localhost/api/commission-evidence/${sig}?live=1&audience=admin`, { headers }), { params: Promise.resolve({ signature: sig }) })
      expect(publicResponse.status).toBe(404)
      const adminResponse = await adminReceiptGet(new NextRequest(`http://localhost/api/admin/evidence/receipts/commission/${sig}`, { headers }), { params: Promise.resolve({ kind: 'commission', signature: sig }) })
      expect(adminResponse.status).toBe(token === adminSession.token ? 200 : 401)
      expect(adminResponse.headers.get('Cache-Control')).toBe('private, no-store')
    }
    expect(rpc.finalized).not.toHaveBeenCalled()
    rpc.finalized.mockResolvedValue({ transaction, failed: false, slot: 99n, blockTime: new Date(), feeLamports: 5000n })
    const verified = await adminReceiptGet(new NextRequest(`http://localhost/api/admin/evidence/receipts/commission/${sig}?live=1`, { headers: { cookie: `sv_session=${adminSession.token}` } }), { params: Promise.resolve({ kind: 'commission', signature: sig }) })
    expect((await verified.json()).data.verification.verified).toBe(true)
    const missing = await adminReceiptGet(new NextRequest('http://localhost/api/admin/evidence/receipts/invalid/invalid', { headers: { cookie: `sv_session=${adminSession.token}` } }), { params: Promise.resolve({ kind: 'invalid', signature: 'invalid' }) })
    expect(missing.status).toBe(404)
    await fixture.client.user.update({ where: { id: 1 }, data: { status: 0 } })
    expect((await adminReceiptGet(new NextRequest(`http://localhost/api/admin/evidence/receipts/commission/${sig}`, { headers: { cookie: `sv_session=${adminSession.token}` } }), { params: Promise.resolve({ kind: 'commission', signature: sig }) })).status).toBe(401)
  })
  it('retains public Mainnet verification', async () => {
    const prepared = await prepareWorkflowEvidence({ eventId: d.events[0].id, network: 'mainnet', signerAddress: signer.publicKey.toBase58(), issuerUserId: 1 })
    const transaction = signed(prepared.transactionBase64)
    const sent = await submitWorkflowEvidence(Number(prepared.attemptId), 1, transaction.serialize().toString('base64'))
    rpc.finalized.mockResolvedValue({ transaction, failed: false, slot: 99n, blockTime: new Date(), feeLamports: 5000n })
    expect(await publicWorkflowEvidence(sent.signature!)).toMatchObject({ verified: true, network: 'mainnet' })
  })
  it('stores only a private-content commitment on chain and independently verifies finalized receipts', async () => {
    const prepared = await prepare()
    expect(prepared.memo).not.toContain('private requirement'); expect(prepared.memo).not.toContain('secret title'); expect(prepared.memo).not.toContain('actor2')
    const transaction = signed(prepared.transactionBase64)
    const sent = await submitWorkflowEvidence(Number(prepared.attemptId), 1, transaction.serialize().toString('base64'))
    expect(sent.status).toBe('SUBMITTED')
    rpc.finalized.mockResolvedValue({ transaction, failed: false, slot: 99n, blockTime: new Date(), feeLamports: 5000n })
    expect(await reconcileWorkflowEvidence(Number(prepared.attemptId))).toMatchObject({ status: 'FINALIZED' })
    const publicResult = await verifyAdminWorkflowEvidence(sent.signature!)
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
    expect((await verifyAdminWorkflowEvidence(sent.signature!)).verified).toBe(true)
  })
  it('allows another administrator to continue site evidence while rejecting customer access', async () => {
    await fixture.client.user.create({ data: { id: 9, username: 'second_admin', password: 'test-only', role: 'ADMIN' } })
    const prepared = await prepare()
    await expect(cancelWorkflowEvidence(Number(prepared.attemptId), customer.userId)).rejects.toMatchObject({ status: 401 })
    await cancelWorkflowEvidence(Number(prepared.attemptId), 9)
    const next = await prepare()
    const before = await fixture.client.commissionSubmission.findFirstOrThrow()
    await fixture.client.user.delete({ where: { id: 1 } })
    const transaction = signed(next.transactionBase64)
    const result = await submitWorkflowEvidence(Number(next.attemptId), 9, transaction.serialize().toString('base64'))
    expect(result.status).toBe('SUBMITTED')
    rpc.finalized.mockResolvedValue({ transaction, failed: false, slot: 99n, blockTime: new Date(), feeLamports: 5000n })
    expect((await verifyAdminWorkflowEvidence(result.signature!)).verified).toBe(true)
    expect((await fixture.client.commissionSubmission.findFirstOrThrow()).snapshotJson).toBe(before.snapshotJson)
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
    transaction.instructions[2].data = Buffer.from('different memo'); transaction.sign(signer)
    await expect(submitWorkflowEvidence(Number(prepared.attemptId), 1, transaction.serialize().toString('base64'))).rejects.toThrow('does not match')
    expect(await fixture.client.commissionProofAttempt.findUniqueOrThrow({ where: { id: Number(prepared.attemptId) } })).toMatchObject({ status: 'FAILED', error: 'EVIDENCE_MESSAGE_MISMATCH', transactionSignature: null })
    expect(rpc.send).not.toHaveBeenCalled()
    const next = await prepare()
    await fixture.client.commissionProofAttempt.update({ where: { id: Number(next.attemptId) }, data: { expiresAt: new Date(0) } })
    await expect(submitWorkflowEvidence(Number(next.attemptId), 1, signed(next.transactionBase64).serialize().toString('base64'))).rejects.toMatchObject({ data: { reason: 'EVIDENCE_PREPARE_EXPIRED' } })
    expect((await fixture.client.commissionProofAttempt.findUniqueOrThrow({ where: { id: Number(next.attemptId) } })).status).toBe('FAILED')
  })
  it('ends deterministic compute failures with a specific reason and permits a new attempt', async () => {
    const prepared = await prepare(), transaction = signed(prepared.transactionBase64)
    rpc.send.mockRejectedValue(new SendTransactionError({ action: 'simulate', signature: '', transactionMessage: 'Transaction simulation failed: Error processing Instruction 2: Program failed to complete', logs: ['Program MemoSq4gqABAXKb96qnH8TysNcWxMyWCqXgDLGmfcHr failed: exceeded CUs meter at BPF instruction'] }))
    await expect(submitWorkflowEvidence(Number(prepared.attemptId), 1, transaction.serialize().toString('base64'))).rejects.toMatchObject({ data: { reason: 'CHAIN_COMPUTE_BUDGET_EXCEEDED' } })
    expect(await fixture.client.commissionProofAttempt.findUniqueOrThrow({ where: { id: Number(prepared.attemptId) } })).toMatchObject({ status: 'FAILED', error: 'CHAIN_COMPUTE_BUDGET_EXCEEDED', transactionSignature: bs58.encode(transaction.signature!) })
    expect((await prepare()).attemptId).not.toBe(prepared.attemptId)
    expect(await fixture.client.commissionSubmission.count()).toBe(1)
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
    transaction.instructions[2].data = Buffer.from('wrong'); transaction.sign(signer)
    rpc.finalized.mockResolvedValue({ transaction, failed: false, slot: 99n, blockTime: new Date(), feeLamports: 5000n })
    expect(await reconcileWorkflowEvidence(Number(prepared.attemptId))).toMatchObject({ status: 'FAILED' })
  })
  it('retries the persisted signature after a lost submit response without downgrading finalized evidence', async () => {
    const prepared = await prepare(), transaction = signed(prepared.transactionBase64)
    const payload = transaction.serialize().toString('base64')
    const first = await submitWorkflowEvidence(Number(prepared.attemptId), 1, payload)
    expect(await submitWorkflowEvidence(Number(prepared.attemptId), 1, payload)).toMatchObject({ signature: first.signature, status: 'SUBMITTED' })
    expect(await fixture.client.commissionProofAttempt.count()).toBe(1)
    expect(rpc.send.mock.calls.every(([bytes]) => Buffer.from(bytes).toString('base64') === payload)).toBe(true)
    rpc.finalized.mockResolvedValue({ transaction, failed: false, slot: 99n, blockTime: new Date(), feeLamports: 5000n })
    await reconcileWorkflowEvidence(Number(prepared.attemptId))
    await cancelWorkflowEvidence(Number(prepared.attemptId), 1)
    expect((await fixture.client.commissionProofAttempt.findUniqueOrThrow({ where: { id: Number(prepared.attemptId) } })).status).toBe('FINALIZED')
  })
  it('expires an unsigned request during reconciliation and allows another attempt', async () => {
    const prepared = await prepare()
    await fixture.client.commissionProofAttempt.update({ where: { id: Number(prepared.attemptId) }, data: { expiresAt: new Date(0) } })
    expect(await reconcileWorkflowEvidence(Number(prepared.attemptId))).toMatchObject({ status: 'FAILED', signature: null })
    const next = await prepare()
    expect(next.attemptId).not.toBe(prepared.attemptId)
    expect(rpc.send).not.toHaveBeenCalled()
  })

})
