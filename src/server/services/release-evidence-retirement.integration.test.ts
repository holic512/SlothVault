import { mkdtempSync, readFileSync, readdirSync, rmSync } from 'node:fs'
import { tmpdir } from 'node:os'
import { join } from 'node:path'
import { randomUUID } from 'node:crypto'
import Database from 'better-sqlite3'
import { PrismaBetterSqlite3 } from '@prisma/adapter-better-sqlite3'
import { PrismaClient as SQLiteClient } from '../../../generated/prisma-sqlite/client'
import type { PrismaClient } from '../../../generated/prisma-postgresql/client'
import { Keypair, Transaction } from '@solana/web3.js'
import { NextRequest } from 'next/server'
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest'

const mocks = vi.hoisted(() => ({ client: undefined as PrismaClient | undefined, rpc: vi.fn(), finalized: vi.fn() }))
vi.mock('@/server/prisma', () => ({ get prisma() { return mocks.client } }))
vi.mock('@/server/database/unit-of-work', () => ({ unitOfWork: { execute: async (operation: Parameters<PrismaClient['$transaction']>[0]) => mocks.client!.$transaction(operation as never) } }))
vi.mock('@/server/auth/session', () => ({ requireAdminSession: async () => ({ User: { id: 1 } }) }))
vi.mock('@/server/database/runtime-health', () => ({ readRuntimeInstallationPublicStatus: async () => ({ status: 'INSTALLED' }), isDatabaseConnectivityError: () => false }))
vi.mock('@/server/services/project-version-release', () => ({ getProjectVersionIntegrity: async () => ({ valid: true, computedHash: 'a'.repeat(64) }) }))
vi.mock('@/server/services/system-config', async (load) => ({
  ...await load<typeof import('@/server/services/system-config')>(),
  getDefaultSolanaNetwork: async () => 'devnet',
  getSolanaNetworkProfile: async (network: string) => ({ network, enabled: true, fallbackUrl: null, health: null }),
  requireEnabledSolanaNetwork: async () => undefined,
  saveNetworkHealth: vi.fn(),
}))
vi.mock('@/server/services/release-evidence-chain', () => ({
  withEvidenceRpc: mocks.rpc, finalizedEvidenceTransaction: mocks.finalized,
  evidenceRpcError: (error: unknown) => { throw error }, isEvidenceRpcConnectionFailure: () => false, testEvidenceEndpoint: vi.fn(),
}))
import { cancelReleaseEvidenceAttempt, getAdminReleaseEvidence, getPublicNoteContentEvidenceManifest, getPublicReleaseEvidence, listReleaseEvidence, prepareEvidence, reconcileReleaseEvidence, submitReleaseEvidence, verifyPublicReleaseEvidence } from './release-evidence'
import { POST as preparePost } from '@/app/api/admin/evidence/prepare/route'
import { GET as publicGet } from '@/app/api/evidence/[transactionSignature]/route'
import { GET as listGet } from '@/app/api/admin/evidence/route'
import { adminReadToolDefinitions } from '@/server/mcp/tools/admin-read'
import { createMcpRequestContext } from '@/server/mcp/registry'

let directory: string, client: PrismaClient
const signature = '5'.repeat(88)
let legacyId: number, attemptId: number, contentId: number
beforeEach(async () => {
  vi.clearAllMocks()
  directory = mkdtempSync(join(tmpdir(), 'sv-evidence-retirement-'))
  const file = join(directory, 'test.sqlite'), db = new Database(file)
  for (const name of readdirSync('prisma/providers/sqlite/migrations').filter((name) => /^\d/.test(name)).sort()) db.exec(readFileSync(`prisma/providers/sqlite/migrations/${name}/migration.sql`, 'utf8'))
  db.close()
  client = new SQLiteClient({ adapter: new PrismaBetterSqlite3({ url: `file:${file}` }, { timestampFormat: 'iso8601' }) }) as unknown as PrismaClient
  mocks.client = client
  await client.user.create({ data: { id: 1, username: 'admin', password: 'test', role: 'ADMIN' } })
  await client.systemInstallation.create({ data: { id: 1, provider: 'sqlite', status: 'INSTALLED', schemaRevision: 12, installationId: randomUUID() } })
  const project = await client.project.create({ data: { projectName: 'Current project', weight: 0, status: 1 } })
  const version = await client.projectVersion.create({ data: { projectId: project.id, version: '1', weight: 0, releaseId: randomUUID(), releaseHash: 'a'.repeat(64), manifestVersion: 2, publishedAt: new Date(), status: 1 } })
  const category = await client.category.create({ data: { projectVersionId: version.id, categoryName: 'Guide', weight: 0, status: 1 } })
  const note = await client.noteInfo.create({ data: { categoryId: category.id, noteTitle: 'Current note', weight: 0, status: 1 } })
  const content = await client.noteContent.create({ data: { noteInfoId: note.id, content: '# Exact content', status: 1, evidenceId: randomUUID(), isPrimary: true } })
  contentId = content.id
  const legacy = await client.releaseCredential.create({ data: { projectVersionId: version.id, issuerUserId: 1, subjectType: 'PROJECT_VERSION', subjectId: version.releaseId!, subjectHash: version.releaseHash!, subjectManifestVersion: 2, network: 'devnet', signerAddress: '11111111111111111111111111111111', memo: '{}', transactionSignature: signature, status: 0 } })
  legacyId = legacy.id
  const attempt = await client.releaseCredentialAttempt.create({ data: { credentialId: legacy.id, issuerUserId: 1, signerAddress: legacy.signerAddress, memo: '{}', messageHash: 'a'.repeat(64), recentBlockhash: '11111111111111111111111111111111', lastValidBlockHeight: 100n, expiresAt: new Date(Date.now() - 1000), status: 0 } })
  attemptId = attempt.id
  await client.releaseCredential.create({ data: { projectVersionId: version.id, noteContentId: content.id, issuerUserId: 1, subjectType: 'NOTE_CONTENT', subjectId: content.evidenceId!, subjectHash: 'b'.repeat(64), subjectManifestVersion: 1, network: 'mainnet', signerAddress: legacy.signerAddress, memo: '{}', status: 2 } })
})
afterEach(async () => { await client.$disconnect(); rmSync(directory, { recursive: true, force: true }) })

describe('retired project-version evidence boundaries with SQLite', () => {
  it('rejects retired preparation at the API and service boundaries before RPC or writes', async () => {
    const response = await preparePost(new NextRequest('http://localhost/api/admin/evidence/prepare', { method: 'POST', body: JSON.stringify({ subject: { type: 'projectVersion', projectVersionId: 1 }, network: 'devnet', signerAddress: '11111111111111111111111111111111' }) }), { params: Promise.resolve({}) })
    expect(response.status).toBe(400)
    await expect(prepareEvidence({ subject: { type: 'projectVersion', projectVersionId: 1 } as unknown as Parameters<typeof prepareEvidence>[0]['subject'], network: 'devnet', signerAddress: '11111111111111111111111111111111', issuerUserId: 1 })).rejects.toMatchObject({ status: 400 })
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
    await expect(getPublicNoteContentEvidenceManifest(signature)).rejects.toMatchObject({ status: 404 })
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
    expect(result.total).toBe(1)
    expect(result.list.map((item) => item.subjectType)).toEqual(['NOTE_CONTENT'])
    expect(result.summary).toEqual([{ network: 'mainnet', status: 2, count: 1 }])
    expect((await listReleaseEvidence({ page: 2, pageSize: 1 })).list).toEqual([])
    expect((await listReleaseEvidence({ page: 1, pageSize: 20, transactionSignature: signature })).total).toBe(0)
    const context = createMcpRequestContext({ authentication: 'mcp-api-key', apiKeyId: 1, userId: 1, username: 'admin' }, undefined)
    const listTool = adminReadToolDefinitions.find((tool) => tool.name === 'admin.evidence.list')!
    const listed = await listTool.handler({ page: 1, pageSize: 20 }, context)
    expect(listed.structuredContent).toMatchObject({ total: 1, list: [{ subjectType: 'NOTE_CONTENT' }] })
    const getTool = adminReadToolDefinitions.find((tool) => tool.name === 'admin.evidence.get')!
    expect((await getTool.handler({ evidenceId: String(legacyId) }, context)).isError).toBe(true)
    const response = await listGet(new NextRequest('http://localhost/api/admin/evidence?subjectType=PROJECT_VERSION'), { params: Promise.resolve({}) })
    expect(response.status).toBe(400)
  })

  it('preserves note signing, finality, public verification and manifest access rules', async () => {
    const wallet = Keypair.generate()
    mocks.rpc.mockImplementation(async (_network: string, operation: (connection: unknown) => Promise<unknown>) => operation({
      getLatestBlockhash: async () => ({ blockhash: '11111111111111111111111111111111', lastValidBlockHeight: 100 }),
      getFeeForMessage: async () => ({ value: 5000 }), getBalance: async () => 100000,
    }))
    const prepared = await prepareEvidence({ subject: { type: 'noteContent', noteContentId: contentId }, network: 'devnet', signerAddress: wallet.publicKey.toBase58(), issuerUserId: 1 })
    const transaction = Transaction.from(Buffer.from(prepared.transactionBase64, 'base64'))
    transaction.sign(wallet)
    const signed = transaction.serialize().toString('base64')
    const { default: bs58 } = await import('bs58')
    const noteSignature = bs58.encode(transaction.signature!)
    mocks.rpc.mockImplementation(async (_network: string, operation: (connection: unknown) => Promise<unknown>) => operation({ sendRawTransaction: async () => noteSignature }))
    mocks.finalized.mockResolvedValue({ failed: false, transaction, slot: 42n, blockTime: new Date(), feeLamports: 5000n })
    await expect(submitReleaseEvidence({ attemptId: Number(prepared.attemptId), issuerUserId: 1, signedTransactionBase64: signed })).resolves.toMatchObject({ status: 2, transactionSignature: noteSignature })
    expect((await verifyPublicReleaseEvidence(noteSignature)).verified).toBe(true)
    expect((await getPublicNoteContentEvidenceManifest(noteSignature)).manifest.markdown).toBe('# Exact content')
    const stored = await client.releaseCredential.findUniqueOrThrow({ where: { id: Number(prepared.credentialId) }, include: { projectVersion: true } })
    await client.project.update({ where: { id: stored.projectVersion.projectId }, data: { downloadAccessMode: 'DISABLED' } })
    await expect(getPublicNoteContentEvidenceManifest(noteSignature)).rejects.toMatchObject({ status: 403 })
    await client.noteContent.update({ where: { id: contentId }, data: { isPrimary: false } })
    expect(await getPublicReleaseEvidence(noteSignature)).toMatchObject({ subjectVisible: false, projectId: null, noteId: null, noteTitle: null })
    await expect(getPublicNoteContentEvidenceManifest(noteSignature)).rejects.toMatchObject({ status: 404 })
  })

  it('still prepares and cancels note content evidence while keeping retired history untouched', async () => {
    const wallet = Keypair.generate()
    mocks.rpc.mockImplementation(async (_network: string, operation: (connection: unknown) => Promise<unknown>) => operation({
      getLatestBlockhash: async () => ({ blockhash: '11111111111111111111111111111111', lastValidBlockHeight: 100 }),
      getFeeForMessage: async () => ({ value: 5000 }), getBalance: async () => 100000,
    }))
    const prepared = await prepareEvidence({ subject: { type: 'noteContent', noteContentId: contentId }, network: 'devnet', signerAddress: wallet.publicKey.toBase58(), issuerUserId: 1 })
    expect(prepared).toMatchObject({ subjectType: 'NOTE_CONTENT', note: 'Current note', network: 'devnet' })
    expect(JSON.parse(prepared.memo).protocol).toBe('slothvault.note-content')
    await expect(cancelReleaseEvidenceAttempt({ attemptId: Number(prepared.attemptId), issuerUserId: 1 })).resolves.toMatchObject({ status: -1 })
    expect((await client.releaseCredential.findUniqueOrThrow({ where: { id: legacyId } })).status).toBe(0)
  })
})
