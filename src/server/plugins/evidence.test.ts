import { beforeEach, describe, expect, it, vi } from 'vitest'
import { Keypair, Transaction } from '@solana/web3.js'
const rpc = vi.hoisted(() => ({ latest: vi.fn(), fee: vi.fn(), balance: vi.fn(), send: vi.fn(), chain: vi.fn(), statuses: vi.fn(), height: vi.fn() }))
vi.mock('@/server/services/system-config', () => ({ requireEnabledSolanaNetwork: vi.fn() }))
vi.mock('@/server/services/release-evidence-chain', () => ({ withEvidenceRpc: (_network: string, operation: (client: unknown) => unknown) => operation({ getLatestBlockhash: rpc.latest, getFeeForMessage: rpc.fee, getBalance: rpc.balance, sendRawTransaction: rpc.send, getSignatureStatuses: rpc.statuses, getBlockHeight: rpc.height }), finalizedEvidenceTransaction: rpc.chain }))
import { preparePluginEvidence, validatePluginEvidence, broadcastPluginEvidence, observePluginEvidence } from './evidence'
const pluginId = 'slothvault.commissions'
let signer: Keypair
beforeEach(() => {
  vi.clearAllMocks(); signer = Keypair.generate()
  rpc.latest.mockResolvedValue({ blockhash: Keypair.generate().publicKey.toBase58(), lastValidBlockHeight: 100 })
  rpc.fee.mockResolvedValue({ value: 5000 }); rpc.balance.mockResolvedValue(10000)
  rpc.chain.mockResolvedValue(null); rpc.statuses.mockResolvedValue({ value: [null] }); rpc.height.mockResolvedValue(99)
})
async function prepared() { return preparePluginEvidence(pluginId, { memo: JSON.stringify({ protocol: pluginId, hash: 'a'.repeat(64) }), signerAddress: signer.publicKey.toBase58() }) }
describe('plugin Mainnet evidence boundary', () => {
  it('binds preparation to the plugin namespace and a real fee estimate', async () => {
    await expect(preparePluginEvidence(pluginId, { memo: '{"protocol":"another.plugin"}', signerAddress: signer.publicKey.toBase58() })).rejects.toThrow('protocol')
    rpc.fee.mockResolvedValue({ value: null }); await expect(prepared()).rejects.toThrow('estimate')
    rpc.fee.mockResolvedValue({ value: 20000 }); await expect(prepared()).rejects.toThrow('余额')
  })
  it('accepts exact signed messages and rejects mutated prepared/signed messages', async () => {
    const item = await prepared(), tx = Transaction.from(Buffer.from(item.transactionBase64, 'base64')); tx.sign(signer)
    const signedTransactionBase64 = tx.serialize().toString('base64')
    expect(validatePluginEvidence(pluginId, { prepared: item, signedTransactionBase64 }).signature).toBeTruthy()
    expect(() => validatePluginEvidence(pluginId, { prepared: { ...item, memo: item.memo.replace('aaaa', 'bbbb') }, signedTransactionBase64 })).toThrow('altered')
    expect(() => validatePluginEvidence('other.plugin', { prepared: item, signedTransactionBase64 })).toThrow('protocol')
  })
  it('does not report broadcast as finality or expire a confirmed transaction', async () => {
    const item = await prepared(), tx = Transaction.from(Buffer.from(item.transactionBase64, 'base64')); tx.sign(signer)
    const signedTransactionBase64 = tx.serialize().toString('base64'), { signature } = validatePluginEvidence(pluginId, { prepared: item, signedTransactionBase64 })
    rpc.send.mockResolvedValue(signature)
    expect(await broadcastPluginEvidence(pluginId, { prepared: item, signedTransactionBase64 })).toEqual({ signature })
    rpc.height.mockResolvedValue(101); rpc.statuses.mockResolvedValue({ value: [{ err: null, confirmationStatus: 'confirmed' }] })
    expect((await observePluginEvidence(pluginId, { prepared: item, signature })).status).toBe('PENDING')
    rpc.statuses.mockResolvedValue({ value: [null] }); expect((await observePluginEvidence(pluginId, { prepared: item, signature })).status).toBe('EXPIRED')
    rpc.chain.mockResolvedValue({ transaction: tx, failed: false, blockTime: new Date('2026-10-23T00:00:00Z') })
    expect((await observePluginEvidence(pluginId, { prepared: item, signature })).status).toBe('FINALIZED')
  })
})
