import { beforeEach, describe, expect, it, vi } from 'vitest'

import { Keypair } from '@solana/web3.js'
import bs58 from 'bs58'

const events: string[] = []
const mocks = vi.hoisted(() => ({
  execute: vi.fn(),
  withEvidenceRpc: vi.fn(),
  finalizedEvidenceTransaction: vi.fn(),
  prisma: {
    releaseCredentialAttempt: { findUnique: vi.fn(), findFirst: vi.fn() },
    releaseCredential: { findUnique: vi.fn(), findUniqueOrThrow: vi.fn() },
    systemInstallation: { findFirst: vi.fn() },
  },
}))

vi.mock('@/server/database/unit-of-work', () => ({
  unitOfWork: { execute: mocks.execute },
}))
vi.mock('@/server/prisma', () => ({ prisma: mocks.prisma }))
vi.mock('@/server/services/project-version-release', () => ({
  getProjectVersionIntegrity: vi.fn(),
}))
vi.mock('@/server/services/system-config', () => ({
  getDefaultSolanaNetwork: vi.fn(),
  getSolanaNetworkProfile: vi.fn(),
  requireEnabledSolanaNetwork: vi.fn(),
  saveNetworkHealth: vi.fn(),
}))
vi.mock('@/server/services/release-evidence-chain', () => ({
  withEvidenceRpc: mocks.withEvidenceRpc,
  finalizedEvidenceTransaction: mocks.finalizedEvidenceTransaction,
  testEvidenceEndpoint: vi.fn(),
  isEvidenceRpcConnectionFailure: (error: unknown) => error instanceof Error && error.message.includes('fetch failed'),
  evidenceRpcError: (error: unknown) => { throw error },
}))

import {
  CREDENTIAL_STATUS,
  reconcileReleaseEvidence,
  submitReleaseEvidence,
} from '@/server/services/release-evidence'
import {
  buildEvidenceTransaction,
  evidenceMessageHash,
} from '@/server/services/release-evidence-protocol'

describe('release evidence durable submission', () => {
  beforeEach(() => {
    vi.clearAllMocks()
    events.length = 0
  })

  it('commits the transaction signature before the first RPC broadcast', async () => {
    const wallet = Keypair.generate()
    const memo = '{"protocol":"slothvault.release"}'
    const transaction = buildEvidenceTransaction({
      memo,
      signer: wallet.publicKey,
      blockhash: '11111111111111111111111111111111',
      lastValidBlockHeight: 123,
    })
    const messageHash = evidenceMessageHash(transaction)
    transaction.sign(wallet)
    const signedTransactionBase64 = transaction.serialize().toString('base64')

    mocks.prisma.releaseCredentialAttempt.findUnique.mockResolvedValue({
      id: 7,
      credentialId: 9,
      issuerUserId: 3,
      signerAddress: wallet.publicKey.toBase58(),
      memo,
      messageHash,
      expiresAt: new Date(Date.now() + 60_000),
      status: 0,
      credential: { id: 9, network: 'devnet', status: 0, transactionSignature: null },
    })
    mocks.prisma.releaseCredentialAttempt.findFirst.mockResolvedValue({ id: 7 })
    mocks.execute.mockImplementation(async (operation: unknown) => {
      const tx = {
        releaseCredentialAttempt: {
          update: vi.fn(async () => { events.push('attempt-signature-committed') }),
        },
        releaseCredential: {
          update: vi.fn(async () => { events.push('credential-signature-committed') }),
        },
      }
      return (operation as (client: typeof tx) => Promise<unknown>)(tx)
    })
    mocks.withEvidenceRpc.mockImplementation(async (_network: string, operation: (connection: { sendRawTransaction: (raw: Buffer) => Promise<string> }) => Promise<unknown>) =>
      operation({
        sendRawTransaction: async () => {
          events.push('rpc-broadcast')
          return bs58.encode(transaction.signature!)
        },
      }),
    )
    mocks.prisma.releaseCredential.findUnique.mockResolvedValue({
      id: 9,
      network: 'devnet',
      status: CREDENTIAL_STATUS.FINALIZED,
      transactionSignature: bs58.encode(transaction.signature!),
      attempts: [{ id: 8, messageHash, lastValidBlockHeight: 123n }],
    })
    mocks.finalizedEvidenceTransaction.mockResolvedValue(null)

    await submitReleaseEvidence({ attemptId: 7, signedTransactionBase64, issuerUserId: 3 })

    expect(events.slice(0, 3)).toEqual([
      'attempt-signature-committed',
      'credential-signature-committed',
      'rpc-broadcast',
    ])
  })

  it('never downgrades an already finalized credential when historical RPC data is unavailable', async () => {
    const finalized = {
      id: 9,
      network: 'mainnet',
      status: CREDENTIAL_STATUS.FINALIZED,
      transactionSignature: 'finalized-signature',
      attempts: [{
        id: 10,
        messageHash: 'a'.repeat(64),
        lastValidBlockHeight: 123n,
      }],
    }
    mocks.prisma.releaseCredential.findUnique.mockResolvedValue(finalized)
    mocks.finalizedEvidenceTransaction.mockResolvedValue(null)

    await expect(reconcileReleaseEvidence(9)).resolves.toBe(finalized)
    expect(mocks.finalizedEvidenceTransaction).toHaveBeenCalledWith(
      'mainnet',
      'finalized-signature',
    )
    expect(mocks.execute).not.toHaveBeenCalled()
  })
})
