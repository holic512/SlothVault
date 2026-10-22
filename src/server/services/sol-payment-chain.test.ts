import { randomUUID } from 'node:crypto'
import { Keypair, PublicKey, SystemProgram, Transaction, type AccountInfo, type TokenBalance } from '@solana/web3.js'
import { ACCOUNT_SIZE, MINT_SIZE, AccountLayout, MintLayout, AccountState, TOKEN_PROGRAM_ID, TOKEN_2022_PROGRAM_ID, ASSOCIATED_TOKEN_PROGRAM_ID, getAssociatedTokenAddressSync, decodeTransferCheckedInstruction } from '@solana/spl-token'
import bs58 from 'bs58'
import { beforeEach,describe,expect,it,vi } from 'vitest'
const rpc=vi.hoisted(()=>({genesis:vi.fn(),transaction:vi.fn(),height:vi.fn(),send:vi.fn(),latest:vi.fn(),balance:vi.fn(),fee:vi.fn(),accounts:vi.fn(),rent:vi.fn(),statuses:vi.fn()}))
vi.mock('@solana/web3.js',async original=>({...await original<typeof import('@solana/web3.js')>(),Connection:class {
 getGenesisHash=rpc.genesis;getTransaction=rpc.transaction;getBlockHeight=rpc.height;sendRawTransaction=rpc.send;getLatestBlockhash=rpc.latest;getBalance=rpc.balance;getFeeForMessage=rpc.fee
 getMultipleAccountsInfo=rpc.accounts;getMinimumBalanceForRentExemption=rpc.rent;getSignatureStatuses=rpc.statuses
}}))
vi.mock('./system-config',()=>({getSolanaNetworkProfile:async()=>({primaryUrl:'https://primary.example.com',fallbackUrl:'https://fallback.example.com'})}))
beforeEach(()=>{vi.clearAllMocks();rpc.genesis.mockResolvedValue('5eykt4UsFv8P8NJdTREpY1vzqKqZKvdp');rpc.transaction.mockResolvedValue(null);rpc.height.mockResolvedValue(1000);rpc.statuses.mockResolvedValue({value:[{confirmationStatus:'finalized',slot:99,err:null}]})})
import { buildSolTransfer,validatePreparedTransfer,validateSignedTransfer,validateSolIntent,observeSolTransfer,broadcastSolTransfer,prepareSolTransfer,USDT_MINT,USDT_DECIMALS } from './sol-payment-chain'
import { createHash } from 'node:crypto'
const id='slothvault.sol-payments'
function fixture(){
 const payer=Keypair.generate(),recipient=Keypair.generate().publicKey.toBase58()
 const intent={orderId:randomUUID(),payer:payer.publicKey.toBase58(),recipient,lamports:'123456789',network:'mainnet' as const}
 const blockhash=Keypair.generate().publicKey.toBase58(),lastValidBlockHeight=100
 const tx=buildSolTransfer(id,intent,blockhash,lastValidBlockHeight)
 const prepared={...intent,blockhash,lastValidBlockHeight,messageHash:createHash('sha256').update(tx.serializeMessage()).digest('hex'),transactionBase64:tx.serialize({requireAllSignatures:false}).toString('base64')}
 tx.sign(payer)
 return {payer,prepared,tx,signedTransaction:tx.serialize().toString('base64')}
}
describe('fixed native SOL transfer security',()=>{
 it('accepts only the prepared payer signature and exact transfer plus scoped Memo',()=>{
  const f=fixture();expect(validateSignedTransfer(id,{prepared:f.prepared,signedTransaction:f.signedTransaction}).signature).toBeTruthy();expect(f.tx.instructions).toHaveLength(2)
  expect(validatePreparedTransfer(id,f.prepared)).toEqual(f.prepared)
 })
 it('rejects changed payer, recipient, amount, Memo and cross-plugin replay',()=>{
  const f=fixture()
  for(const altered of [{recipient:Keypair.generate().publicKey.toBase58()},{payer:Keypair.generate().publicKey.toBase58()},{lamports:'1'},{orderId:randomUUID()},{network:'devnet'}])expect(()=>validateSignedTransfer(id,{prepared:{...f.prepared,...altered},signedTransaction:f.signedTransaction})).toThrow()
  expect(()=>validateSignedTransfer('other.plugin',{prepared:f.prepared,signedTransaction:f.signedTransaction})).toThrow()
 })
 it('rejects appended instructions and missing or forged signatures',()=>{
  const f=fixture();f.tx.add(SystemProgram.transfer({fromPubkey:f.payer.publicKey,toPubkey:Keypair.generate().publicKey,lamports:1}));f.tx.sign(f.payer)
  expect(()=>validateSignedTransfer(id,{prepared:f.prepared,signedTransaction:f.tx.serialize().toString('base64')})).toThrow()
  expect(()=>validateSignedTransfer(id,{prepared:f.prepared,signedTransaction:f.prepared.transactionBase64})).toThrow()
  const bad=Transaction.from(Buffer.from(f.signedTransaction,'base64'));bad.signatures[0].signature=Buffer.alloc(64,1)
  expect(()=>validateSignedTransfer(id,{prepared:f.prepared,signedTransaction:bad.serialize({verifySignatures:false}).toString('base64')})).toThrow()
 })
 it('rejects self-payment and unsafe lamports',()=>{
  const f=fixture();expect(()=>validateSolIntent({orderId:f.prepared.orderId,payer:f.prepared.payer,recipient:f.prepared.payer,lamports:'1',network:'mainnet'})).toThrow()
  expect(()=>buildSolTransfer(id,{orderId:randomUUID(),payer:f.prepared.payer,recipient:f.prepared.recipient,lamports:'9007199254740992',network:'mainnet'},f.prepared.blockhash,100)).toThrow()
 })
})

describe('finalized chain observations',()=>{
 it('checks the transfer plus actual fee before asking the wallet to sign',async()=>{
  const f=fixture(),{orderId,payer,recipient,lamports,network}=f.prepared
  rpc.latest.mockResolvedValue({blockhash:f.prepared.blockhash,lastValidBlockHeight:100})
  rpc.fee.mockResolvedValue({value:5000});rpc.balance.mockResolvedValue(Number(lamports)+4999)
  await expect(prepareSolTransfer(id,{orderId,payer,recipient,lamports,network})).rejects.toThrow('PAYMENT_BALANCE_INSUFFICIENT')
  rpc.balance.mockResolvedValue(Number(lamports)+5000)
  expect(await prepareSolTransfer(id,{orderId,payer,recipient,lamports,network})).toMatchObject({lamports,payer,recipient})
 })
 it('requires finalized success and the exact message before returning a receipt',async()=>{
  const f=fixture(),signature=bs58.encode(f.tx.signature!)
  rpc.transaction.mockResolvedValue({version:'legacy',slot:99,meta:{err:null},transaction:{message:f.tx.compileMessage(),signatures:[signature]}})
  expect(await observeSolTransfer(id,{prepared:f.prepared,signature})).toEqual({status:'FINALIZED',slot:99})
  expect(rpc.transaction).toHaveBeenCalledWith(signature,{commitment:'finalized',maxSupportedTransactionVersion:0})
  rpc.transaction.mockResolvedValue({version:'legacy',slot:99,meta:{err:{InstructionError:[0,'error']}},transaction:{message:f.tx.compileMessage(),signatures:[signature]}})
  expect(await observeSolTransfer(id,{prepared:f.prepared,signature})).toMatchObject({status:'FAILED'})
 })
 it('never treats a null signed-transaction lookup as expiry even beyond the last block height',async()=>{
  const f=fixture(),signature=bs58.encode(f.tx.signature!)
  expect(await observeSolTransfer(id,{prepared:f.prepared,signature})).toEqual({status:'PENDING'})
  expect(rpc.height).not.toHaveBeenCalled()
  expect(await observeSolTransfer(id,{prepared:f.prepared})).toEqual({status:'EXPIRED'})
 })
 it('rejects wrong networks and RPC results carrying another message',async()=>{
  const f=fixture(),other=fixture(),signature=bs58.encode(f.tx.signature!)
  rpc.genesis.mockResolvedValue('DEVNET')
  await expect(observeSolTransfer(id,{prepared:f.prepared,signature})).rejects.toThrow('PAYMENT_RPC_UNAVAILABLE')
  expect(rpc.transaction).not.toHaveBeenCalled()
  rpc.genesis.mockResolvedValue('5eykt4UsFv8P8NJdTREpY1vzqKqZKvdp')
  rpc.transaction.mockResolvedValue({version:'legacy',slot:99,meta:{err:null},transaction:{message:other.tx.compileMessage(),signatures:[bs58.encode(other.tx.signature!)]}})
  await expect(observeSolTransfer(id,{prepared:f.prepared,signature})).rejects.toThrow()
 })
 it('rebroadcasts identical signed bytes on fallback and never considers RPC receipt a finalized payment',async()=>{
  const f=fixture(),signature=bs58.encode(f.tx.signature!)
  rpc.send.mockRejectedValueOnce(new Error('timeout')).mockResolvedValueOnce(signature)
  expect(await broadcastSolTransfer(id,{prepared:f.prepared,signedTransaction:f.signedTransaction})).toEqual({signature})
  expect(rpc.send.mock.calls[0][0]).toEqual(rpc.send.mock.calls[1][0]);expect(rpc.transaction).not.toHaveBeenCalled()
 })
})

function tokenFixture() {
 const payer = Keypair.generate(), recipient = Keypair.generate().publicKey.toBase58()
 const intent = { orderId: randomUUID(), payer: payer.publicKey.toBase58(), recipient, asset: 'USDT' as const, tokenAmount: '1250000', network: 'mainnet' as const }
 const blockhash = Keypair.generate().publicKey.toBase58(), lastValidBlockHeight = 100
 const tx = buildSolTransfer(id, intent, blockhash, lastValidBlockHeight)
 const prepared = { ...intent, blockhash, lastValidBlockHeight, messageHash: createHash('sha256').update(tx.serializeMessage()).digest('hex'), transactionBase64: tx.serialize({ requireAllSignatures: false }).toString('base64') }
 tx.sign(payer)
 const source = getAssociatedTokenAddressSync(USDT_MINT, payer.publicKey)
 const destination = getAssociatedTokenAddressSync(USDT_MINT, new PublicKey(recipient), true)
 return { intent, payer, prepared, tx, source, destination, signedTransaction: tx.serialize().toString('base64') }
}
const zeroKey = PublicKey.default
function mintInfo(decimals = USDT_DECIMALS, owner = TOKEN_PROGRAM_ID): AccountInfo<Buffer> {
 const data = Buffer.alloc(MINT_SIZE)
 MintLayout.encode({ mintAuthorityOption: 0, mintAuthority: zeroKey, supply: 1_000_000_000_000n, decimals, isInitialized: true, freezeAuthorityOption: 0, freezeAuthority: zeroKey }, data)
 return { owner, data, lamports: 1, executable: false }
}
function accountInfo(owner: PublicKey, amount = 2_000_000n, mint = USDT_MINT, state = AccountState.Initialized, program = TOKEN_PROGRAM_ID): AccountInfo<Buffer> {
 const data = Buffer.alloc(ACCOUNT_SIZE)
 AccountLayout.encode({ mint, owner, amount, delegateOption: 0, delegate: zeroKey, state, isNativeOption: 0, isNative: 0n, delegatedAmount: 0n, closeAuthorityOption: 0, closeAuthority: zeroKey }, data)
 return { owner: program, data, lamports: 2_039_280, executable: false }
}
function prepareTokenRpc(f: ReturnType<typeof tokenFixture>, destinationExists = true) {
 rpc.latest.mockResolvedValue({ blockhash: f.prepared.blockhash, lastValidBlockHeight: 100 })
 rpc.fee.mockResolvedValue({ value: 5000 })
 rpc.balance.mockResolvedValue(10_000_000)
 rpc.rent.mockResolvedValue(2_039_280)
 rpc.accounts.mockResolvedValue([mintInfo(), accountInfo(f.payer.publicKey), destinationExists ? accountInfo(new PublicKey(f.intent.recipient), 0n) : null])
}
function finalizedTokenResult(f: ReturnType<typeof tokenFixture>, newDestination = false) {
 const message = f.tx.compileMessage(), signature = bs58.encode(f.tx.signature!)
 const balance = (address: PublicKey, owner: string, amount: string): TokenBalance => ({
  accountIndex: message.accountKeys.findIndex(key => key.equals(address)), mint: USDT_MINT.toBase58(), owner, programId: TOKEN_PROGRAM_ID.toBase58(),
  uiTokenAmount: { amount, decimals: USDT_DECIMALS, uiAmount: null },
 })
 const preTokenBalances = [balance(f.source, f.intent.payer, '2000000'), ...newDestination ? [] : [balance(f.destination, f.intent.recipient, '100000')]]
 const postTokenBalances = [balance(f.source, f.intent.payer, '750000'), balance(f.destination, f.intent.recipient, newDestination ? '1250000' : '1350000')]
 return { version: 'legacy' as const, slot: 99, meta: { err: null, preTokenBalances, postTokenBalances }, transaction: { message, signatures: [signature] } }
}

describe('fixed Mainnet USDT transaction boundary', () => {
 it('builds only canonical idempotent ATA creation, six-decimal TransferChecked and the scoped Memo', () => {
  const f = tokenFixture(), [ata, transfer, memo] = f.tx.instructions
  expect(f.tx.instructions).toHaveLength(3)
  expect(ata.programId.equals(ASSOCIATED_TOKEN_PROGRAM_ID)).toBe(true)
  expect(ata.data).toEqual(Buffer.from([1]))
  expect(ata.keys.map(key => key.pubkey.toBase58())).toEqual([f.intent.payer, f.destination.toBase58(), f.intent.recipient, USDT_MINT.toBase58(), SystemProgram.programId.toBase58(), TOKEN_PROGRAM_ID.toBase58()])
  const decoded = decodeTransferCheckedInstruction(transfer)
  expect(decoded.keys.source.pubkey.equals(f.source)).toBe(true)
  expect(decoded.keys.destination.pubkey.equals(f.destination)).toBe(true)
  expect(decoded.keys.mint.pubkey.equals(USDT_MINT)).toBe(true)
  expect(decoded.keys.owner.pubkey.equals(f.payer.publicKey)).toBe(true)
  expect(decoded.data).toMatchObject({ amount: 1_250_000n, decimals: 6 })
  expect(memo.data.toString()).toBe(`${id}:${f.intent.orderId}`)
  expect(validatePreparedTransfer(id, f.prepared)).toEqual(f.prepared)
  expect(validateSignedTransfer(id, { prepared: f.prepared, signedTransaction: f.signedTransaction }).signature).toBe(bs58.encode(f.tx.signature!))
 })
 it('rejects ambiguous assets, arbitrary mint overrides, noninteger amounts, overflows and non-Mainnet intents', () => {
  const { intent } = tokenFixture()
  for (const altered of [{ asset: undefined }, { asset: 'SOL' }, { asset: 'USDC' }, { lamports: '1' }, { mint: Keypair.generate().publicKey.toBase58() }, { network: 'devnet' }, { tokenAmount: '1.25' }, { tokenAmount: '0' }, { tokenAmount: '01' }, { tokenAmount: '18446744073709551616' }]) {
   expect(() => validateSolIntent({ ...intent, ...altered })).toThrow()
  }
  expect(validateSolIntent({ ...intent, tokenAmount: '18446744073709551615' })).toMatchObject({ asset: 'USDT' })
 })
 it('rejects changed asset, payer, recipient, amount, order and cross-plugin replay', () => {
  const f = tokenFixture()
  for (const altered of [{ asset: 'SOL' }, { payer: Keypair.generate().publicKey.toBase58() }, { recipient: Keypair.generate().publicKey.toBase58() }, { tokenAmount: '1' }, { orderId: randomUUID() }]) {
   expect(() => validateSignedTransfer(id, { prepared: { ...f.prepared, ...altered }, signedTransaction: f.signedTransaction })).toThrow()
  }
  expect(() => validateSignedTransfer('another.plugin', { prepared: f.prepared, signedTransaction: f.signedTransaction })).toThrow()
 })
 it('rejects substituted mint, programs, ATAs, authority, decimals, amount, Memo and appended instructions even with recomputed hashes', () => {
  const f = tokenFixture(), other = Keypair.generate().publicKey
  const edits: ((tx: Transaction) => void)[] = [
   tx => { tx.instructions[1].keys[1].pubkey = other },
   tx => { tx.instructions[1].programId = TOKEN_2022_PROGRAM_ID },
   tx => { tx.instructions[1].keys[0].pubkey = other },
   tx => { tx.instructions[1].keys[2].pubkey = other },
   tx => { tx.instructions[1].keys[3].pubkey = other },
   tx => { tx.instructions[1].data[9] = 9 },
   tx => { tx.instructions[1].data.writeBigUInt64LE(1n, 1) },
   tx => { tx.instructions[0].keys[1].pubkey = other },
   tx => { tx.instructions[0].keys[2].pubkey = other },
   tx => { tx.instructions[0].keys[3].pubkey = other },
   tx => { tx.instructions[0].programId = other },
   tx => { tx.instructions[2].data = Buffer.from('unscoped memo') },
   tx => { tx.add(SystemProgram.transfer({ fromPubkey: f.payer.publicKey, toPubkey: other, lamports: 1 })) },
  ]
  for (const edit of edits) {
   const tx = Transaction.from(Buffer.from(f.prepared.transactionBase64, 'base64'))
   edit(tx)
   const forged = { ...f.prepared, messageHash: createHash('sha256').update(tx.serializeMessage()).digest('hex'), transactionBase64: tx.serialize({ requireAllSignatures: false, verifySignatures: false }).toString('base64') }
   expect(() => validatePreparedTransfer(id, forged)).toThrow('PAYMENT_TRANSACTION_INVALID')
  }
 })
 it('rejects missing and forged token signatures before broadcast', async () => {
  const f = tokenFixture()
  expect(() => validateSignedTransfer(id, { prepared: f.prepared, signedTransaction: f.prepared.transactionBase64 })).toThrow()
  const bad = Transaction.from(Buffer.from(f.signedTransaction, 'base64'))
  bad.signatures[0].signature = Buffer.alloc(64, 1)
  await expect(broadcastSolTransfer(id, { prepared: f.prepared, signedTransaction: bad.serialize({ verifySignatures: false }).toString('base64') })).rejects.toThrow()
  expect(rpc.send).not.toHaveBeenCalled()
 })
})

describe('USDT account, balance and SOL fee preflight', () => {
 it('checks the fixed mint and both canonical token accounts, and charges only the fee for an existing destination', async () => {
  const f = tokenFixture(); prepareTokenRpc(f)
  rpc.balance.mockResolvedValue(5000)
  expect(await prepareSolTransfer(id, f.intent)).toEqual(f.prepared)
  expect(rpc.accounts).toHaveBeenCalledWith([USDT_MINT, f.source, f.destination], 'confirmed')
  expect(rpc.rent).not.toHaveBeenCalled()
  rpc.balance.mockResolvedValue(4999)
  await expect(prepareSolTransfer(id, f.intent)).rejects.toThrow('PAYMENT_GAS_INSUFFICIENT')
 })
 it('includes destination ATA rent in SOL gas and automatically creates it in the same signed transaction', async () => {
  const f = tokenFixture(); prepareTokenRpc(f, false)
  rpc.balance.mockResolvedValue(2_039_280 + 4999)
  await expect(prepareSolTransfer(id, f.intent)).rejects.toThrow('PAYMENT_GAS_INSUFFICIENT')
  expect(rpc.rent).toHaveBeenCalledWith(ACCOUNT_SIZE, 'confirmed')
  rpc.balance.mockResolvedValue(2_039_280 + 5000)
  expect(await prepareSolTransfer(id, f.intent)).toEqual(f.prepared)
 })
 it('reports insufficient tokens distinctly without retrying or misclassifying the error as RPC failure', async () => {
  const f = tokenFixture(); prepareTokenRpc(f)
  for (const source of [null, accountInfo(f.payer.publicKey, 1_249_999n)]) {
   rpc.accounts.mockClear().mockResolvedValue([mintInfo(), source, null])
   await expect(prepareSolTransfer(id, f.intent)).rejects.toThrow('PAYMENT_TOKEN_BALANCE_INSUFFICIENT')
   expect(rpc.accounts).toHaveBeenCalledTimes(1)
  }
  expect(rpc.rent).not.toHaveBeenCalled()
 })
 it('rejects incorrect mint program/decimals and mismatched, uninitialized or frozen ATA state as account errors', async () => {
  const f = tokenFixture(); prepareTokenRpc(f)
  const goodSource = accountInfo(f.payer.publicKey), goodDestination = accountInfo(new PublicKey(f.intent.recipient))
  const other = Keypair.generate().publicKey
  const variants = [
   [null, goodSource, goodDestination], [mintInfo(9), goodSource, goodDestination], [mintInfo(6, TOKEN_2022_PROGRAM_ID), goodSource, goodDestination],
   [mintInfo(), accountInfo(other), goodDestination], [mintInfo(), accountInfo(f.payer.publicKey, 2_000_000n, other), goodDestination],
   [mintInfo(), accountInfo(f.payer.publicKey, 2_000_000n, USDT_MINT, AccountState.Frozen), goodDestination],
   [mintInfo(), accountInfo(f.payer.publicKey, 2_000_000n, USDT_MINT, AccountState.Uninitialized), goodDestination],
   [mintInfo(), accountInfo(f.payer.publicKey, 2_000_000n, USDT_MINT, AccountState.Initialized, TOKEN_2022_PROGRAM_ID), goodDestination],
   [mintInfo(), goodSource, accountInfo(other)], [mintInfo(), goodSource, accountInfo(new PublicKey(f.intent.recipient), 0n, other)],
   [mintInfo(), goodSource, accountInfo(new PublicKey(f.intent.recipient), 0n, USDT_MINT, AccountState.Frozen)],
  ]
  for (const accounts of variants) {
   rpc.accounts.mockClear().mockResolvedValue(accounts)
   await expect(prepareSolTransfer(id, f.intent)).rejects.toThrow('PAYMENT_TOKEN_ACCOUNT_INVALID')
   expect(rpc.accounts).toHaveBeenCalledTimes(1)
  }
 })
 it('does not query balances or mint accounts on a wrong network', async () => {
  const f = tokenFixture(); prepareTokenRpc(f); rpc.genesis.mockResolvedValue('DEVNET')
  await expect(prepareSolTransfer(id, f.intent)).rejects.toThrow('PAYMENT_RPC_UNAVAILABLE')
  expect(rpc.accounts).not.toHaveBeenCalled(); expect(rpc.balance).not.toHaveBeenCalled()
 })
})

describe('finalized USDT settlement evidence', () => {
 it.each([false, true])('requires exact source debit and recipient credit, including a newly created ATA (%s)', async fresh => {
  const f = tokenFixture(), signature = bs58.encode(f.tx.signature!)
  rpc.transaction.mockResolvedValue(finalizedTokenResult(f, fresh))
  expect(await observeSolTransfer(id, { prepared: f.prepared, signature })).toEqual({ status: 'FINALIZED', slot: 99 })
  expect(rpc.statuses).toHaveBeenCalledWith([signature], { searchTransactionHistory: true })
 })
 it('keeps confirmed/missing signatures pending and only reports finalized failures', async () => {
  const f = tokenFixture(), signature = bs58.encode(f.tx.signature!)
  const result = finalizedTokenResult(f)
  rpc.transaction.mockResolvedValue(result)
  for (const status of [null, { confirmationStatus: 'confirmed', err: null }, { confirmationStatus: 'processed', err: null }]) {
   rpc.statuses.mockResolvedValue({ value: [status] })
   expect(await observeSolTransfer(id, { prepared: f.prepared, signature })).toEqual({ status: 'PENDING' })
  }
  rpc.statuses.mockResolvedValue({ value: [{ confirmationStatus: 'finalized', slot: 99, err: { InstructionError: [1, 'failure'] } }] })
  rpc.transaction.mockResolvedValue({ ...result, meta: { err: { InstructionError: [1, 'failure'] } } })
  expect(await observeSolTransfer(id, { prepared: f.prepared, signature })).toEqual({ status: 'FAILED', slot: 99 })
 })
 it('rejects missing, ambiguous or wrong token balance evidence instead of crediting points', async () => {
  const f = tokenFixture(), signature = bs58.encode(f.tx.signature!)
  const original = finalizedTokenResult(f)
  const variants = [
   { preTokenBalances: undefined }, { postTokenBalances: [] }, { preTokenBalances: [] },
   { postTokenBalances: [original.meta.postTokenBalances[0]] },
   { postTokenBalances: [...original.meta.postTokenBalances, original.meta.postTokenBalances[1]] },
   ...[{ mint: undefined }, { mint: Keypair.generate().publicKey.toBase58() }, { owner: undefined }, { owner: f.intent.payer }, { programId: undefined }, { programId: TOKEN_2022_PROGRAM_ID.toBase58() },
    { uiTokenAmount: { amount: '1350001', decimals: 6, uiAmount: null } }, { uiTokenAmount: { amount: '1350000', decimals: 9, uiAmount: null } }]
    .map(change => ({ postTokenBalances: [original.meta.postTokenBalances[0], { ...original.meta.postTokenBalances[1], ...change }] })),
  ]
  for (const change of variants) {
   rpc.transaction.mockResolvedValue({ ...original, meta: { ...original.meta, ...change } })
   await expect(observeSolTransfer(id, { prepared: f.prepared, signature })).rejects.toThrow('PAYMENT_TRANSACTION_INVALID')
  }
 })
 it('rejects finalized status with a different slot or an error hidden by transaction metadata', async () => {
  const f = tokenFixture(), signature = bs58.encode(f.tx.signature!)
  rpc.transaction.mockResolvedValue(finalizedTokenResult(f))
  for (const status of [{ confirmationStatus: 'finalized', slot: 98, err: null }, { confirmationStatus: 'finalized', slot: 99, err: { InstructionError: [1, 'failure'] } }]) {
   rpc.statuses.mockResolvedValue({ value: [status] })
   await expect(observeSolTransfer(id, { prepared: f.prepared, signature })).rejects.toThrow('PAYMENT_TRANSACTION_INVALID')
  }
  rpc.transaction.mockResolvedValue({ ...finalizedTokenResult(f), meta: { err: { InstructionError: [1, 'failure'] } } })
  for (const err of [null, { InstructionError: [0, 'different-failure'] }]) {
   rpc.statuses.mockResolvedValue({ value: [{ confirmationStatus: 'finalized', slot: 99, err }] })
   await expect(observeSolTransfer(id, { prepared: f.prepared, signature })).rejects.toThrow('PAYMENT_TRANSACTION_INVALID')
  }
 })
 it('rejects another transaction or a forged signature returned by RPC', async () => {
  const f = tokenFixture(), signature = bs58.encode(f.tx.signature!), other = tokenFixture()
  rpc.transaction.mockResolvedValue(finalizedTokenResult(other))
  await expect(observeSolTransfer(id, { prepared: f.prepared, signature })).rejects.toThrow('PAYMENT_TRANSACTION_INVALID')
  const result = finalizedTokenResult(f)
  rpc.transaction.mockResolvedValue({ ...result, transaction: { ...result.transaction, signatures: [bs58.encode(Buffer.alloc(64, 1))] } })
  await expect(observeSolTransfer(id, { prepared: f.prepared, signature })).rejects.toThrow('PAYMENT_TRANSACTION_INVALID')
 })
 it('preserves unknown lookups as pending, and validates the mainnet genesis before token observation', async () => {
  const f = tokenFixture(), signature = bs58.encode(f.tx.signature!)
  expect(await observeSolTransfer(id, { prepared: f.prepared, signature })).toEqual({ status: 'PENDING' })
  expect(rpc.statuses).not.toHaveBeenCalled()
  rpc.genesis.mockResolvedValue('DEVNET'); rpc.transaction.mockClear()
  await expect(observeSolTransfer(id, { prepared: f.prepared, signature })).rejects.toThrow('PAYMENT_RPC_UNAVAILABLE')
  expect(rpc.transaction).not.toHaveBeenCalled()
 })
 it('rebroadcasts the same signed token transfer through the fallback without claiming settlement', async () => {
  const f = tokenFixture(), signature = bs58.encode(f.tx.signature!)
  rpc.send.mockRejectedValueOnce(new Error('timeout')).mockResolvedValueOnce(signature)
  expect(await broadcastSolTransfer(id, { prepared: f.prepared, signedTransaction: f.signedTransaction })).toEqual({ signature })
  expect(rpc.send.mock.calls[0][0]).toEqual(rpc.send.mock.calls[1][0]); expect(rpc.transaction).not.toHaveBeenCalled()
 })
})
