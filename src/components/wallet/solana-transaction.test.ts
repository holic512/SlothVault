import { afterEach, describe, expect, it, vi } from 'vitest'
import { ComputeBudgetProgram, Keypair, PublicKey, Transaction, TransactionInstruction } from '@solana/web3.js'
import { buildMemoTransaction, assertSignedMemoTransaction, memoTransactionMessageHash } from '@/server/services/solana-memo-transaction'
import type { Adapter } from '@solana/wallet-adapter-base'
import { canWalletSignEvidence, signPreparedSolanaTransaction } from './solana-transaction'

function fixture(name = 'Phantom', chains = ['solana:devnet', 'solana:mainnet']) {
  const signer = Keypair.generate()
  const account = { address: signer.publicKey.toBase58(), publicKey: signer.publicKey.toBytes(), chains, features: ['solana:signTransaction'] }
  const sign = vi.fn(async (input: { transaction: Uint8Array }) => {
    const tx = Transaction.from(input.transaction)
    tx.sign(signer)
    return [{ signedTransaction: tx.serialize() }]
  })
  const adapter = { name, connected: true, publicKey: signer.publicKey, standard: true,
    wallet: { accounts: [account], features: { 'solana:signTransaction': { signTransaction: sign } } }, signTransaction: vi.fn() } as unknown as Adapter
  const tx = new Transaction({ feePayer: signer.publicKey, recentBlockhash: Keypair.generate().publicKey.toBase58() }).add(new TransactionInstruction({
    programId: new Keypair().publicKey, keys: [{ pubkey: signer.publicKey, isSigner: true, isWritable: false }], data: Buffer.from('private memo must not be logged'),
  }))
  const base64 = tx.serialize({ requireAllSignatures: false, verifySignatures: false }).toString('base64')
  return { signer, account, adapter, sign, tx, base64 }
}
afterEach(() => vi.restoreAllMocks())
describe('network-bound evidence signing', () => {
  it.each(['devnet', 'mainnet'] as const)('passes the explicit %s chain and preserves the prepared message', async network => {
    const f = fixture()
    const legacySigner = vi.fn()
    const info = vi.spyOn(console, 'info').mockImplementation(() => undefined)
    const signed = await signPreparedSolanaTransaction(f.base64, network, f.adapter, f.account.address, legacySigner, '7')
    const result = Transaction.from(Buffer.from(signed, 'base64'))
    expect(f.sign.mock.calls[0][0]).toMatchObject({ chain: `solana:${network}`, account: f.account })
    expect(legacySigner).not.toHaveBeenCalled()
    expect(result.serializeMessage()).toEqual(f.tx.serializeMessage())
    expect(result.verifySignatures()).toBe(true)
    const logs = JSON.stringify(info.mock.calls)
    expect(logs).not.toContain('private memo')
    expect(logs).not.toContain(f.account.address)
    expect(logs).not.toContain(f.base64)
    expect(logs).toContain('wallet.sign.returned')
  })
  it.each(['OKX Wallet', 'Solflare'])('blocks %s on Devnet before contacting its provider while allowing mainnet', async name => {
    const f = fixture(name)
    expect(canWalletSignEvidence(f.adapter, f.account.address, 'devnet')).toBe(false)
    expect(canWalletSignEvidence(f.adapter, f.account.address, 'mainnet')).toBe(true)
    await expect(signPreparedSolanaTransaction(f.base64, 'devnet', f.adapter, f.account.address, vi.fn())).rejects.toMatchObject({ reason: 'EVIDENCE_PHANTOM_REQUIRED' })
    expect(f.sign).not.toHaveBeenCalled()
  })
  it('rejects disconnected wallets, unsupported account chains and changed signers', async () => {
    const f = fixture('Phantom', ['solana:mainnet'])
    expect(canWalletSignEvidence(null, null, 'devnet')).toBe(false)
    expect(canWalletSignEvidence(f.adapter, f.account.address, 'devnet')).toBe(false)
    expect(canWalletSignEvidence(f.adapter, Keypair.generate().publicKey.toBase58(), 'mainnet')).toBe(false)
    await expect(signPreparedSolanaTransaction(f.base64, 'devnet', f.adapter, f.account.address, vi.fn())).rejects.toMatchObject({ reason: 'EVIDENCE_WALLET_UNSUPPORTED' })
    Object.assign(f.adapter, { connected: false })
    expect(canWalletSignEvidence(f.adapter, f.account.address, 'mainnet')).toBe(false)
    expect(f.sign).not.toHaveBeenCalled()
  })
  it('detects a provider mutating the supplied transaction in place', async () => {
    const f = fixture()
    const adapter = { ...f.adapter, standard: undefined } as unknown as Adapter
    const sign = vi.fn(async (tx: Transaction) => { tx.recentBlockhash = Keypair.generate().publicKey.toBase58(); tx.sign(f.signer); return tx })
    const log = vi.spyOn(console, 'warn').mockImplementation(() => undefined)
    await expect(signPreparedSolanaTransaction(f.base64, 'devnet', adapter, f.account.address, sign)).rejects.toMatchObject({ reason: 'EVIDENCE_MESSAGE_MISMATCH' })
    expect(log.mock.calls[0][1]).toMatchObject({ blockhashChanged: true, signatureValid: true })
  })
  it('rejects invalid signatures returned by a wallet', async () => {
    const f = fixture()
    f.sign.mockImplementation(async () => [{ signedTransaction: f.tx.serialize({ requireAllSignatures: false, verifySignatures: false }) }])
    await expect(signPreparedSolanaTransaction(f.base64, 'devnet', f.adapter, f.account.address, vi.fn())).rejects.toMatchObject({ reason: 'EVIDENCE_SIGNATURE_INVALID' })
  })
  it('rechecks the account after the wallet dialog returns', async () => {
    const f = fixture()
    f.sign.mockImplementation(async input => { const tx = Transaction.from(input.transaction); tx.sign(f.signer); Object.assign(f.adapter, { publicKey: Keypair.generate().publicKey }); return [{ signedTransaction: tx.serialize() }] })
    await expect(signPreparedSolanaTransaction(f.base64, 'devnet', f.adapter, f.account.address, vi.fn())).rejects.toMatchObject({ reason: 'EVIDENCE_WALLET_UNSUPPORTED' })
  })
  it('keeps explicitly budgeted evidence unchanged through a wallet that inserts missing priority fees', async () => {
    const f = fixture()
    const memo = 'private evidence memo'
    const tx = buildMemoTransaction({ memo, signer: f.signer.publicKey, blockhash: f.tx.recentBlockhash!, lastValidBlockHeight: 123 })
    // Emulate Phantom's documented insertion rule, without contacting a wallet or RPC.
    f.sign.mockImplementation(async input => {
      const returned = Transaction.from(input.transaction)
      if (!returned.instructions.some(instruction => instruction.programId.equals(ComputeBudgetProgram.programId))) {
        returned.add(ComputeBudgetProgram.setComputeUnitPrice({ microLamports: 1000 }))
      }
      returned.sign(f.signer)
      return [{ signedTransaction: returned.serialize() }]
    })
    const legacy = new Transaction({ feePayer: f.signer.publicKey, recentBlockhash: tx.recentBlockhash }).add(tx.instructions[2])
    const warning = vi.spyOn(console, 'warn').mockImplementation(() => undefined)
    await expect(signPreparedSolanaTransaction(legacy.serialize({ requireAllSignatures: false }).toString('base64'), 'devnet', f.adapter, f.account.address, vi.fn())).rejects.toMatchObject({ reason: 'EVIDENCE_MESSAGE_MISMATCH' })
    expect(warning.mock.calls[0][1]).toMatchObject({
      expectedInstructions: ['Memo'], actualInstructions: ['Memo', 'ComputeBudget.SetComputeUnitPrice(1000)'],
      instructionCountChanged: true, blockhashChanged: false, feePayerChanged: false, signatureValid: true,
    })
    const prepared = tx.serialize({ requireAllSignatures: false }).toString('base64')
    const signed = Transaction.from(Buffer.from(await signPreparedSolanaTransaction(prepared, 'devnet', f.adapter, f.account.address, vi.fn()), 'base64'))
    expect(signed.serializeMessage()).toEqual(tx.serializeMessage())
    expect(assertSignedMemoTransaction({ transaction: signed, memo, signerAddress: f.account.address, messageHash: memoTransactionMessageHash(tx) })).toBeTruthy()
    expect(JSON.stringify(warning.mock.calls)).not.toContain(memo)
  })
  it('logs unknown programs without exposing arbitrary program addresses or data', async () => {
    const f = fixture()
    const hiddenAddress = Keypair.generate().publicKey.toBase58()
    f.sign.mockImplementation(async input => {
      const returned = Transaction.from(input.transaction)
      returned.add(new TransactionInstruction({ programId: new PublicKey(hiddenAddress), keys: [], data: Buffer.from('secret payload') }))
      returned.sign(f.signer)
      return [{ signedTransaction: returned.serialize() }]
    })
    const warning = vi.spyOn(console, 'warn').mockImplementation(() => undefined)
    await expect(signPreparedSolanaTransaction(f.base64, 'devnet', f.adapter, f.account.address, vi.fn())).rejects.toMatchObject({ reason: 'EVIDENCE_MESSAGE_MISMATCH' })
    expect(warning.mock.calls[0][1]).toMatchObject({ actualInstructions: ['OtherProgram', 'OtherProgram'] })
    expect(JSON.stringify(warning.mock.calls)).not.toContain(hiddenAddress)
    expect(JSON.stringify(warning.mock.calls)).not.toContain('secret payload')
  })
  it('rejects a wallet changing the explicit priority fee even without adding instructions', async () => {
    const f = fixture()
    const tx = buildMemoTransaction({ memo: 'evidence', signer: f.signer.publicKey, blockhash: f.tx.recentBlockhash!, lastValidBlockHeight: 123 })
    f.sign.mockImplementation(async input => {
      const returned = Transaction.from(input.transaction)
      returned.instructions[1] = ComputeBudgetProgram.setComputeUnitPrice({ microLamports: 1000 })
      returned.sign(f.signer)
      return [{ signedTransaction: returned.serialize() }]
    })
    const warning = vi.spyOn(console, 'warn').mockImplementation(() => undefined)
    await expect(signPreparedSolanaTransaction(tx.serialize({ requireAllSignatures: false }).toString('base64'), 'devnet', f.adapter, f.account.address, vi.fn())).rejects.toMatchObject({ reason: 'EVIDENCE_MESSAGE_MISMATCH' })
    expect(warning.mock.calls[0][1]).toMatchObject({ instructionCountChanged: false, signatureValid: true,
      expectedInstructions: ['ComputeBudget.SetComputeUnitLimit(1400000)', 'ComputeBudget.SetComputeUnitPrice(0)', 'Memo'],
      actualInstructions: ['ComputeBudget.SetComputeUnitLimit(1400000)', 'ComputeBudget.SetComputeUnitPrice(1000)', 'Memo'],
    })
  })
})
