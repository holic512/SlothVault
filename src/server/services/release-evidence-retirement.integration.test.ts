import { mkdtempSync, readFileSync, readdirSync, rmSync } from 'node:fs'
import { tmpdir } from 'node:os'
import { join } from 'node:path'
import { randomUUID } from 'node:crypto'
import Database from 'better-sqlite3'
import { PrismaBetterSqlite3 } from '@prisma/adapter-better-sqlite3'
import { PrismaClient as SQLiteClient } from '../../../generated/prisma-sqlite/client'
import type { PrismaClient } from '../../../generated/prisma-postgresql/client'
import { Keypair, SendTransactionError, Transaction } from '@solana/web3.js'
import { NextRequest } from 'next/server'
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest'

const mocks = vi.hoisted(() => ({ client: undefined as PrismaClient | undefined, rpc: vi.fn(), finalized: vi.fn() }))
vi.mock('@/server/services/public-project-cache', () => ({ invalidatePublicProjectCache: vi.fn() }))
vi.mock('@/server/prisma', () => ({ get prisma() { return mocks.client } }))
vi.mock('@/server/database/unit-of-work', () => {
  let tail = Promise.resolve()
  return { unitOfWork: { execute: async (operation: Parameters<PrismaClient['$transaction']>[0]) => {
    const result = tail.then(() => mocks.client!.$transaction(operation as never))
    tail = result.then(() => undefined, () => undefined)
    return result
  } } }

})
vi.mock('@/server/auth/session', () => ({ requireAdminSession: async () => ({ User: { id: 1 } }) }))
vi.mock('@/server/database/runtime-health', () => ({ readRuntimeInstallationPublicStatus: async () => ({ status: 'INSTALLED' }), isDatabaseConnectivityError: () => false }))
vi.mock('@/server/services/system-config', async (load) => ({
  ...await load<typeof import('@/server/services/system-config')>(),
  getDefaultSolanaNetwork: async () => 'devnet',
  getSolanaNetworkProfile: async (network: string) => ({ network, enabled: true, fallbackUrl: null, health: null }),
  requireEnabledSolanaNetwork: async () => undefined,
  saveNetworkHealth: vi.fn(),
}))
vi.mock('@/server/services/release-evidence-chain', () => ({
  withEvidenceRpc: mocks.rpc, finalizedEvidenceTransaction: mocks.finalized,
  evidenceRpcError: (error: unknown) => { throw error }, testEvidenceEndpoint: vi.fn(),
}))
import { cancelReleaseEvidenceAttempt, getAdminReleaseEvidence, getPublicReleaseEvidenceManifest, getPublicReleaseEvidence, listReleaseEvidence, prepareEvidence, reconcileReleaseEvidence, submitReleaseEvidence, verifyPublicReleaseEvidence } from './release-evidence'
import { publishProjectVersion } from './project-version-release'
import { getProjectVersionEvidenceSummary } from './release-evidence'
import { POST as preparePost } from '@/app/api/admin/evidence/prepare/route'
import { GET as publicGet } from '@/app/api/evidence/[transactionSignature]/route'
import { GET as listGet } from '@/app/api/admin/evidence/route'
import { adminReadToolDefinitions } from '@/server/mcp/tools/admin-read'
import { createMcpRequestContext } from '@/server/mcp/registry'

let directory: string, client: PrismaClient
const signature = '5'.repeat(88)
let legacyId: number, attemptId: number, contentId: number, versionId: number
beforeEach(async () => {
  vi.clearAllMocks()
  directory = mkdtempSync(join(tmpdir(), 'sv-evidence-retirement-'))
  const file = join(directory, 'test.sqlite'), db = new Database(file)
  for (const name of readdirSync('prisma/providers/sqlite/migrations').filter((name) => /^\d/.test(name)).sort()) db.exec(readFileSync(`prisma/providers/sqlite/migrations/${name}/migration.sql`, 'utf8'))
  db.close()
  client = new SQLiteClient({ adapter: new PrismaBetterSqlite3({ url: `file:${file}` }, { timestampFormat: 'iso8601' }) }) as unknown as PrismaClient
  mocks.client = client
  await client.user.create({ data: { id: 1, username: 'admin', password: 'test', role: 'ADMIN' } })
  await client.systemInstallation.create({ data: { id: 1, provider: 'sqlite', status: 'INSTALLED', schemaRevision: 14, installationId: randomUUID() } })
  const project = await client.project.create({ data: { projectName: 'Current project', weight: 0, status: 1 } })
  const version = await client.projectVersion.create({ data: { projectId: project.id, version: '1', weight: 0, status: 0 } })
  const category = await client.category.create({ data: { projectVersionId: version.id, categoryName: 'Guide', weight: 0, status: 1 } })
  const note = await client.noteInfo.create({ data: { categoryId: category.id, noteTitle: 'Current note', weight: 0, status: 1 } })
  const content = await client.noteContent.create({ data: { noteInfoId: note.id, content: '# Exact content', status: 1, evidenceId: randomUUID(), isPrimary: true } })
  contentId = content.id
  versionId = version.id
  await publishProjectVersion(version.id)
  const legacy = await client.releaseCredential.create({ data: { projectVersionId: version.id, issuerUserId: 1, subjectType: 'PROJECT_VERSION', subjectId: randomUUID(), subjectHash: 'a'.repeat(64), subjectManifestVersion: 2, network: 'devnet', signerAddress: '11111111111111111111111111111111', memo: '{}', transactionSignature: signature, status: 0 } })
  legacyId = legacy.id
  const attempt = await client.releaseCredentialAttempt.create({ data: { credentialId: legacy.id, issuerUserId: 1, signerAddress: legacy.signerAddress, memo: '{}', messageHash: 'a'.repeat(64), recentBlockhash: '11111111111111111111111111111111', lastValidBlockHeight: 100n, expiresAt: new Date(Date.now() - 1000), status: 0 } })
  attemptId = attempt.id
  await client.releaseCredential.create({ data: { projectVersionId: version.id, noteContentId: content.id, issuerUserId: 1, subjectType: 'NOTE_CONTENT', subjectId: content.evidenceId!, subjectHash: 'b'.repeat(64), subjectManifestVersion: 1, network: 'mainnet', signerAddress: legacy.signerAddress, memo: '{}', status: 2 } })
})
afterEach(async () => { await client.$disconnect(); rmSync(directory, { recursive: true, force: true }) })

describe('project-version v3 evidence boundaries with SQLite', () => {
  it('persists a specific compute rejection and allows preparing a fresh attempt', async () => {
    const wallet = Keypair.generate()
    mocks.rpc.mockImplementation(async (_network: string, operation: (connection: unknown) => Promise<unknown>) => operation({
      getLatestBlockhash: async () => ({ blockhash: '11111111111111111111111111111111', lastValidBlockHeight: 100 }),
      getFeeForMessage: async () => ({ value: 5000 }), getBalance: async () => 100000,
    }))
    const input = { subject: { type: 'projectVersion' as const, projectVersionId: versionId }, network: 'devnet' as const, signerAddress: wallet.publicKey.toBase58(), issuerUserId: 1 }
    const prepared = await prepareEvidence(input)
    const transaction = Transaction.from(Buffer.from(prepared.transactionBase64, 'base64')); transaction.sign(wallet)
    mocks.rpc.mockImplementation(async (_network: string, operation: (connection: unknown) => Promise<unknown>) => operation({
      sendRawTransaction: async () => { throw new SendTransactionError({ action: 'simulate', signature: '', transactionMessage: 'Transaction simulation failed: Error processing Instruction 2: Program failed to complete', logs: ['Program MemoSq4gqABAXKb96qnH8TysNcWxMyWCqXgDLGmfcHr failed: exceeded CUs meter at BPF instruction'] }) },
    }))
    await expect(submitReleaseEvidence({ attemptId: Number(prepared.attemptId), issuerUserId: 1, signedTransactionBase64: transaction.serialize().toString('base64') })).rejects.toMatchObject({ data: { reason: 'CHAIN_COMPUTE_BUDGET_EXCEEDED' } })
    expect(await client.releaseCredentialAttempt.findUniqueOrThrow({ where: { id: Number(prepared.attemptId) } })).toMatchObject({ status: -1, failureCode: 'CHAIN_COMPUTE_BUDGET_EXCEEDED', transactionSignature: expect.any(String) })
    expect((await client.releaseCredential.findUniqueOrThrow({ where: { id: Number(prepared.credentialId) } })).status).toBe(-1)
    mocks.rpc.mockImplementation(async (_network: string, operation: (connection: unknown) => Promise<unknown>) => operation({
      getLatestBlockhash: async () => ({ blockhash: '11111111111111111111111111111111', lastValidBlockHeight: 100 }), getFeeForMessage: async () => ({ value: 5000 }), getBalance: async () => 100000,
    }))
    expect((await prepareEvidence(input)).attemptId).not.toBe(prepared.attemptId)
  })
  it.each(['Blockhash not found', 'Node is unhealthy'])('does not turn an uncertain preflight response into a terminal failure: %s', async transactionMessage => {
    const wallet = Keypair.generate()
    mocks.rpc.mockImplementation(async (_network: string, operation: (connection: unknown) => Promise<unknown>) => operation({
      getLatestBlockhash: async () => ({ blockhash: '11111111111111111111111111111111', lastValidBlockHeight: 100 }), getFeeForMessage: async () => ({ value: 5000 }), getBalance: async () => 100000,
    }))
    const prepared = await prepareEvidence({ subject: { type: 'projectVersion', projectVersionId: versionId }, network: 'devnet', signerAddress: wallet.publicKey.toBase58(), issuerUserId: 1 })
    const transaction = Transaction.from(Buffer.from(prepared.transactionBase64, 'base64')); transaction.sign(wallet)
    mocks.finalized.mockResolvedValue(null)
    mocks.rpc.mockImplementation(async (_network: string, operation: (connection: unknown) => Promise<unknown>) => operation({
      sendRawTransaction: async () => { throw new SendTransactionError({ action: 'simulate', signature: '', transactionMessage }) }, getBlockHeight: async () => 99,
    }))
    expect(await submitReleaseEvidence({ attemptId: Number(prepared.attemptId), issuerUserId: 1, signedTransactionBase64: transaction.serialize().toString('base64') })).toMatchObject({ status: 1 })
    expect(await client.releaseCredentialAttempt.findUniqueOrThrow({ where: { id: Number(prepared.attemptId) } })).toMatchObject({ status: 1, failureCode: null, transactionSignature: expect.any(String) })
  })
  it('rejects retired preparation at the API and service boundaries before RPC or writes', async () => {
    const response = await preparePost(new NextRequest('http://localhost/api/admin/evidence/prepare', { method: 'POST', body: JSON.stringify({ subject: { type: 'noteContent', noteContentId: contentId }, network: 'devnet', signerAddress: '11111111111111111111111111111111' }) }), { params: Promise.resolve({}) })
    expect(response.status).toBe(400)
    await expect(prepareEvidence({ subject: { type: 'noteContent', noteContentId: contentId } as unknown as Parameters<typeof prepareEvidence>[0]['subject'], network: 'devnet', signerAddress: '11111111111111111111111111111111', issuerUserId: 1 })).rejects.toMatchObject({ status: 400 })
    expect(await client.releaseCredential.count()).toBe(2)
    expect(mocks.rpc).not.toHaveBeenCalled()
  })

  it('returns 404 for old IDs, signatures and attempts without writes or RPC', async () => {
    const before = await client.releaseCredential.findUniqueOrThrow({ where: { id: legacyId }, include: { attempts: true } })
    await expect(getAdminReleaseEvidence(legacyId)).rejects.toMatchObject({ status: 404 })
    await expect(cancelReleaseEvidenceAttempt({ attemptId, issuerUserId: 1 })).rejects.toMatchObject({ status: 404 })
    await expect(submitReleaseEvidence({ attemptId, issuerUserId: 1, signedTransactionBase64: 'invalid' })).rejects.toMatchObject({ status: 404 })
    await expect(reconcileReleaseEvidence(legacyId)).rejects.toMatchObject({ status: 404 })
    expect(await getPublicReleaseEvidence(signature)).toBeNull()
    await expect(verifyPublicReleaseEvidence(signature)).rejects.toMatchObject({ status: 404 })
    await expect(getPublicReleaseEvidenceManifest(signature)).rejects.toMatchObject({ status: 404 })
    for (const suffix of ['', '?live=1']) {
      const response = await publicGet(new NextRequest(`http://localhost/api/evidence/${signature}${suffix}`), { params: Promise.resolve({ transactionSignature: signature }) })
      expect(response.status).toBe(404)
    }
    expect(await client.releaseCredential.findUniqueOrThrow({ where: { id: legacyId }, include: { attempts: true } })).toEqual(before)
    expect(mocks.rpc).not.toHaveBeenCalled()
    expect(mocks.finalized).not.toHaveBeenCalled()
  })

  it('excludes retired history from pagination, summaries and filtered lists', async () => {
    const result = await listReleaseEvidence({ page: 1, pageSize: 1 })
    expect(result.total).toBe(0)
    expect(result.list.map((item) => item.subjectType)).toEqual([])
    expect(result.summary).toEqual([])
    expect((await listReleaseEvidence({ page: 2, pageSize: 1 })).list).toEqual([])
    expect((await listReleaseEvidence({ page: 1, pageSize: 20, transactionSignature: signature })).total).toBe(0)
    const context = createMcpRequestContext({ authentication: 'mcp-api-key', apiKeyId: 1, userId: 1, username: 'admin' }, undefined)
    const listTool = adminReadToolDefinitions.find((tool) => tool.name === 'admin.evidence.list')!
    const listed = await listTool.handler({ page: 1, pageSize: 20 }, context)
    expect(listed.structuredContent).toMatchObject({ total: 0, list: [] })
    const getTool = adminReadToolDefinitions.find((tool) => tool.name === 'admin.evidence.get')!
    expect((await getTool.handler({ evidenceId: String(legacyId) }, context)).isError).toBe(true)
    const response = await listGet(new NextRequest('http://localhost/api/admin/evidence?subjectType=PROJECT_VERSION'), { params: Promise.resolve({}) })
    expect(response.status).toBe(200)
  })

  it('supports version signing, finality, public verification and manifest access rules', async () => {
    const wallet = Keypair.generate()
    mocks.rpc.mockImplementation(async (_network: string, operation: (connection: unknown) => Promise<unknown>) => operation({
      getLatestBlockhash: async () => ({ blockhash: '11111111111111111111111111111111', lastValidBlockHeight: 100 }),
      getFeeForMessage: async () => ({ value: 5000 }), getBalance: async () => 100000,
    }))
    const prepared = await prepareEvidence({ subject: { type: 'projectVersion', projectVersionId: versionId }, network: 'devnet', signerAddress: wallet.publicKey.toBase58(), issuerUserId: 1 })
    const transaction = Transaction.from(Buffer.from(prepared.transactionBase64, 'base64'))
    transaction.sign(wallet)
    const signed = transaction.serialize().toString('base64')
    const { default: bs58 } = await import('bs58')
    const noteSignature = bs58.encode(transaction.signature!)
    mocks.rpc.mockImplementation(async (_network: string, operation: (connection: unknown) => Promise<unknown>) => operation({ sendRawTransaction: async () => noteSignature }))
    mocks.finalized.mockResolvedValue({ failed: false, transaction, slot: 42n, blockTime: new Date(), feeLamports: 5000n })
    await expect(submitReleaseEvidence({ attemptId: Number(prepared.attemptId), issuerUserId: 1, signedTransactionBase64: signed })).resolves.toMatchObject({ status: 2, transactionSignature: noteSignature })
    expect(await verifyPublicReleaseEvidence(noteSignature)).toMatchObject({ verified: true, chainVerified: true, integrityVerified: true })
    await client.noteInfo.update({ where: { id: (await client.noteContent.findUniqueOrThrow({ where: { id: contentId } })).noteInfoId }, data: { noteTitle: 'Tampered' } })
    expect(await verifyPublicReleaseEvidence(noteSignature)).toMatchObject({ verified: false, chainVerified: true, integrityVerified: false })
    await client.noteInfo.update({ where: { id: (await client.noteContent.findUniqueOrThrow({ where: { id: contentId } })).noteInfoId }, data: { noteTitle: 'Current note' } })
    expect((await getPublicReleaseEvidenceManifest(noteSignature)).manifest).toMatchObject({ schema: 3, projectName: 'Current project', version: '1' })
    expect(prepared.memo).not.toMatch(/Exact content|Current note|Guide/)
    const stored = await client.releaseCredential.findUniqueOrThrow({ where: { id: Number(prepared.credentialId) }, include: { projectVersion: true } })
    await client.project.update({ where: { id: stored.projectVersion.projectId }, data: { downloadAccessMode: 'DISABLED' } })
    await expect(getPublicReleaseEvidenceManifest(noteSignature)).rejects.toMatchObject({ status: 403 })
    await client.noteContent.update({ where: { id: contentId }, data: { isPrimary: false } })
    expect(await getPublicReleaseEvidence(noteSignature)).toMatchObject({ subjectVisible: true })
    await expect(getPublicReleaseEvidenceManifest(noteSignature)).rejects.toMatchObject({ status: 403 })
  })

  it('prepares and cancels version evidence while keeping retired history untouched', async () => {
    const wallet = Keypair.generate()
    mocks.rpc.mockImplementation(async (_network: string, operation: (connection: unknown) => Promise<unknown>) => operation({
      getLatestBlockhash: async () => ({ blockhash: '11111111111111111111111111111111', lastValidBlockHeight: 100 }),
      getFeeForMessage: async () => ({ value: 5000 }), getBalance: async () => 100000,
    }))
    const prepared = await prepareEvidence({ subject: { type: 'projectVersion', projectVersionId: versionId }, network: 'devnet', signerAddress: wallet.publicKey.toBase58(), issuerUserId: 1 })
    expect(prepared).toMatchObject({ subjectType: 'PROJECT_VERSION', version: '1', network: 'devnet' })
    expect(JSON.parse(prepared.memo).protocol).toBe('slothvault.project-version')
    await expect(cancelReleaseEvidenceAttempt({ attemptId: Number(prepared.attemptId), issuerUserId: 1 })).resolves.toMatchObject({ status: -1 })
    expect((await client.releaseCredential.findUniqueOrThrow({ where: { id: legacyId } })).status).toBe(0)
  })
  it('reads two network statuses and request-local permissions without RPC or body fields', async () => {
    const summary = await getProjectVersionEvidenceSummary(versionId, { publicProjectId: 1 })
    expect(summary.networks.map(n => [n.network, n.status])).toEqual([['mainnet', null], ['devnet', null]])
    expect(summary.canDownload).toBe(true)
    expect(JSON.stringify(summary)).not.toMatch(/Exact content|issuerUserId|messageHash|rpcUrl|transactionBase64/)
    await client.project.update({ where: { id: 1 }, data: { downloadAccessMode: 'DISABLED' } })
    expect((await getProjectVersionEvidenceSummary(versionId, { publicProjectId: 1 })).canDownload).toBe(false)
    expect((await getProjectVersionEvidenceSummary(versionId, { viewer: { userId: 1, role: 'ADMIN' } })).canDownload).toBe(true)
    expect(mocks.rpc).not.toHaveBeenCalled()
    expect(mocks.finalized).not.toHaveBeenCalled()
  })

  it('serializes concurrent preparations and supports expired retries and cancellation', async () => {
    const wallet = Keypair.generate()
    mocks.rpc.mockImplementation(async (_network: string, operation: (connection: unknown) => Promise<unknown>) => operation({
      getLatestBlockhash: async () => ({ blockhash: '11111111111111111111111111111111', lastValidBlockHeight: 100 }),
      getFeeForMessage: async () => ({ value: 5000 }), getBalance: async () => 100000,
    }))
    const input = { subject: { type: 'projectVersion' as const, projectVersionId: versionId }, network: 'devnet' as const, signerAddress: wallet.publicKey.toBase58(), issuerUserId: 1 }
    const outcomes = await Promise.allSettled([prepareEvidence(input), prepareEvidence(input)])
    expect(outcomes.filter(o => o.status === 'fulfilled')).toHaveLength(1)
    const credential = await client.releaseCredential.findFirstOrThrow({ where: { subjectManifestVersion: 3 }, include: { attempts: true } })
    expect(credential.attempts).toHaveLength(1)
    await client.releaseCredentialAttempt.update({ where: { id: credential.attempts[0].id }, data: { expiresAt: new Date(0) } })
    const retry = await prepareEvidence(input)
    expect(Number(retry.credentialId)).toBe(credential.id)
    expect((await client.releaseCredentialAttempt.findUniqueOrThrow({ where: { id: credential.attempts[0].id } })).failureCode).toBe('PREPARE_EXPIRED')
    await cancelReleaseEvidenceAttempt({ attemptId: Number(retry.attemptId), issuerUserId: 1 })
    await expect(submitReleaseEvidence({ attemptId: Number(retry.attemptId), issuerUserId: 1, signedTransactionBase64: 'invalid' })).rejects.toMatchObject({ status: 409 })
    const next = await prepareEvidence(input)
    expect(next.credentialId).toBe(retry.credentialId)
    const mainnet = await prepareEvidence({ ...input, network: 'mainnet' })
    expect(mainnet.credentialId).not.toBe(next.credentialId)
    expect((await getProjectVersionEvidenceSummary(versionId)).networks.map(n => n.status)).toEqual([0, 0])
  })

  it('records invalid signed messages as failed, retains history, and allows a new attempt', async () => {
    const wallet = Keypair.generate()
    mocks.rpc.mockImplementation(async (_network: string, operation: (connection: unknown) => Promise<unknown>) => operation({
      getLatestBlockhash: async () => ({ blockhash: '11111111111111111111111111111111', lastValidBlockHeight: 100 }),
      getFeeForMessage: async () => ({ value: 5000 }), getBalance: async () => 100000,
    }))
    const input = { subject: { type: 'projectVersion' as const, projectVersionId: versionId }, network: 'devnet' as const, signerAddress: wallet.publicKey.toBase58(), issuerUserId: 1 }
    const prepared = await prepareEvidence(input)
    const tx = Transaction.from(Buffer.from(prepared.transactionBase64, 'base64'))
    tx.recentBlockhash = Keypair.generate().publicKey.toBase58()
    tx.sign(wallet)
    await expect(submitReleaseEvidence({ attemptId: Number(prepared.attemptId), issuerUserId: 1, signedTransactionBase64: tx.serialize().toString('base64') })).rejects.toMatchObject({ status: 409, data: { reason: 'EVIDENCE_MESSAGE_MISMATCH' } })
    expect(await client.releaseCredentialAttempt.findUniqueOrThrow({ where: { id: Number(prepared.attemptId) } })).toMatchObject({ status: -1, failureCode: 'EVIDENCE_MESSAGE_MISMATCH', transactionSignature: null })
    expect((await client.releaseCredential.findUniqueOrThrow({ where: { id: Number(prepared.credentialId) } })).status).toBe(-1)
    const next = await prepareEvidence(input)
    expect(next.credentialId).toBe(prepared.credentialId)
    expect(next.attemptId).not.toBe(prepared.attemptId)
    expect(await client.releaseCredentialAttempt.count({ where: { credentialId: Number(next.credentialId) } })).toBe(2)
    await expect(submitReleaseEvidence({ attemptId: Number(prepared.attemptId), issuerUserId: 1, signedTransactionBase64: tx.serialize().toString('base64') })).rejects.toMatchObject({ data: { reason: 'EVIDENCE_ATTEMPT_FAILED' } })
    expect((await client.releaseCredential.findUniqueOrThrow({ where: { id: Number(next.credentialId) } })).status).toBe(0)
  })
  it('ends expired unsigned attempts through reconciliation without changing the ledger on reads', async () => {
    const wallet = Keypair.generate()
    mocks.rpc.mockImplementation(async (_network: string, operation: (connection: unknown) => Promise<unknown>) => operation({
      getLatestBlockhash: async () => ({ blockhash: '11111111111111111111111111111111', lastValidBlockHeight: 100 }),
      getFeeForMessage: async () => ({ value: 5000 }), getBalance: async () => 100000,
    }))
    const prepared = await prepareEvidence({ subject: { type: 'projectVersion', projectVersionId: versionId }, network: 'devnet', signerAddress: wallet.publicKey.toBase58(), issuerUserId: 1 })
    await client.releaseCredentialAttempt.update({ where: { id: Number(prepared.attemptId) }, data: { expiresAt: new Date(0) } })
    const listed = await listReleaseEvidence({ page: 1, pageSize: 20 })
    expect(listed.list[0]).toMatchObject({ status: 0 })
    expect((await client.releaseCredentialAttempt.findUniqueOrThrow({ where: { id: Number(prepared.attemptId) } })).status).toBe(0)
    expect(await reconcileReleaseEvidence(Number(prepared.credentialId))).toMatchObject({ status: -1 })
    expect((await client.releaseCredentialAttempt.findUniqueOrThrow({ where: { id: Number(prepared.attemptId) } })).failureCode).toBe('PREPARE_EXPIRED')
    await expect(reconcileReleaseEvidence(Number(prepared.credentialId))).resolves.toMatchObject({ status: -1 })
  })

  it('reuses the exact signature after a lost submit response and protects persisted submissions from invalid retries', async () => {
    const wallet = Keypair.generate()
    mocks.rpc.mockImplementation(async (_network: string, operation: (connection: unknown) => Promise<unknown>) => operation({
      getLatestBlockhash: async () => ({ blockhash: '11111111111111111111111111111111', lastValidBlockHeight: 100 }),
      getFeeForMessage: async () => ({ value: 5000 }), getBalance: async () => 100000,
    }))
    const prepared = await prepareEvidence({ subject: { type: 'projectVersion', projectVersionId: versionId }, network: 'devnet', signerAddress: wallet.publicKey.toBase58(), issuerUserId: 1 })
    const tx = Transaction.from(Buffer.from(prepared.transactionBase64, 'base64')); tx.sign(wallet)
    const bytes = tx.serialize().toString('base64')
    const { default: bs58 } = await import('bs58')
    const signature = bs58.encode(tx.signature!)
    const broadcast = vi.fn<(raw: Buffer) => Promise<string>>(async () => signature)
    mocks.rpc.mockImplementation(async (_network: string, operation: (connection: unknown) => Promise<unknown>) => operation({ sendRawTransaction: broadcast, getBlockHeight: async () => 99 }))
    mocks.finalized.mockResolvedValue(null)
    const input = { attemptId: Number(prepared.attemptId), issuerUserId: 1, signedTransactionBase64: bytes }
    expect(await submitReleaseEvidence(input)).toMatchObject({ status: 1, transactionSignature: signature })
    expect(await submitReleaseEvidence(input)).toMatchObject({ status: 1, transactionSignature: signature })
    expect(broadcast).toHaveBeenCalledTimes(2)
    expect(broadcast.mock.calls.every(([raw]) => Buffer.from(raw).toString('base64') === bytes)).toBe(true)
    expect(await client.releaseCredentialAttempt.count({ where: { credentialId: Number(prepared.credentialId) } })).toBe(1)
    tx.recentBlockhash = Keypair.generate().publicKey.toBase58(); tx.sign(wallet)
    await expect(submitReleaseEvidence({ ...input, signedTransactionBase64: tx.serialize().toString('base64') })).rejects.toMatchObject({ data: { reason: 'EVIDENCE_MESSAGE_MISMATCH' } })
    expect((await client.releaseCredentialAttempt.findUniqueOrThrow({ where: { id: input.attemptId } })).status).toBe(1)
    expect((await client.releaseCredential.findUniqueOrThrow({ where: { id: Number(prepared.credentialId) } })).status).toBe(1)
    mocks.finalized.mockResolvedValue({ failed: false, transaction: Transaction.from(Buffer.from(bytes, 'base64')), slot: 42n, blockTime: new Date(), feeLamports: 5000n })
    await reconcileReleaseEvidence(Number(prepared.credentialId))
    await expect(cancelReleaseEvidenceAttempt({ attemptId: input.attemptId, issuerUserId: 1 })).rejects.toMatchObject({ status: 409 })
    expect((await client.releaseCredential.findUniqueOrThrow({ where: { id: Number(prepared.credentialId) } })).status).toBe(2)
  })

  it('retains a durable signature when the RPC response is unexpected, instead of treating payment as failed', async () => {
    const wallet = Keypair.generate()
    mocks.rpc.mockImplementation(async (_network: string, operation: (connection: unknown) => Promise<unknown>) => operation({
      getLatestBlockhash: async () => ({ blockhash: '11111111111111111111111111111111', lastValidBlockHeight: 100 }),
      getFeeForMessage: async () => ({ value: 5000 }), getBalance: async () => 100000,
    }))
    const prepared = await prepareEvidence({ subject: { type: 'projectVersion', projectVersionId: versionId }, network: 'devnet', signerAddress: wallet.publicKey.toBase58(), issuerUserId: 1 })
    const tx = Transaction.from(Buffer.from(prepared.transactionBase64, 'base64')); tx.sign(wallet)
    mocks.rpc.mockImplementation(async (_network: string, operation: (connection: unknown) => Promise<unknown>) => operation({ sendRawTransaction: async () => 'unexpected-rpc-signature', getBlockHeight: async () => 99 }))
    mocks.finalized.mockResolvedValue(null)
    expect(await submitReleaseEvidence({ attemptId: Number(prepared.attemptId), issuerUserId: 1, signedTransactionBase64: tx.serialize().toString('base64') })).toMatchObject({ status: 1 })
    expect(await client.releaseCredentialAttempt.findUniqueOrThrow({ where: { id: Number(prepared.attemptId) } })).toMatchObject({ status: 1, failureCode: null })
  })

  it('does not downgrade a submission committed while another request is validating an invalid message', async () => {
    const wallet = Keypair.generate()
    mocks.rpc.mockImplementation(async (_network: string, operation: (connection: unknown) => Promise<unknown>) => operation({
      getLatestBlockhash: async () => ({ blockhash: '11111111111111111111111111111111', lastValidBlockHeight: 100 }),
      getFeeForMessage: async () => ({ value: 5000 }), getBalance: async () => 100000,
    }))
    const prepared = await prepareEvidence({ subject: { type: 'projectVersion', projectVersionId: versionId }, network: 'devnet', signerAddress: wallet.publicKey.toBase58(), issuerUserId: 1 })
    const valid = Transaction.from(Buffer.from(prepared.transactionBase64, 'base64')); valid.sign(wallet)
    const { default: bs58 } = await import('bs58')
    const signature = bs58.encode(valid.signature!)
    const invalid = Transaction.from(valid.serialize()); invalid.recentBlockhash = Keypair.generate().publicKey.toBase58(); invalid.sign(wallet)
    const delegate = client.releaseCredentialAttempt.findUnique.bind(client.releaseCredentialAttempt)
    const spy = vi.spyOn(client.releaseCredentialAttempt, 'findUnique')
    spy.mockImplementationOnce((async (args: Parameters<typeof delegate>[0]) => {
      const snapshot = await delegate(args)
      // Another authenticated submit completes its signature persistence after this request's read.
      await client.releaseCredentialAttempt.update({ where: { id: Number(prepared.attemptId) }, data: { status: 1, transactionSignature: signature, submittedAt: new Date() } })
      await client.releaseCredential.update({ where: { id: Number(prepared.credentialId) }, data: { status: 1, transactionSignature: signature } })
      return snapshot
    }) as unknown as typeof delegate)
    try {
      await expect(submitReleaseEvidence({ attemptId: Number(prepared.attemptId), issuerUserId: 1, signedTransactionBase64: invalid.serialize().toString('base64') })).rejects.toMatchObject({ data: { reason: 'EVIDENCE_MESSAGE_MISMATCH' } })
      expect(await client.releaseCredentialAttempt.findUniqueOrThrow({ where: { id: Number(prepared.attemptId) } })).toMatchObject({ status: 1, transactionSignature: signature, failureCode: null })
      expect(await client.releaseCredential.findUniqueOrThrow({ where: { id: Number(prepared.credentialId) } })).toMatchObject({ status: 1, transactionSignature: signature })
    } finally { spy.mockRestore() }
  })

})
