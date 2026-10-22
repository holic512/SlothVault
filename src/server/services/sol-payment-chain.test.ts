import { randomUUID } from 'node:crypto'
import { Keypair, SystemProgram, Transaction } from '@solana/web3.js'
import bs58 from 'bs58'
import { beforeEach,describe,expect,it,vi } from 'vitest'
const rpc=vi.hoisted(()=>({genesis:vi.fn(),transaction:vi.fn(),height:vi.fn(),send:vi.fn(),latest:vi.fn(),balance:vi.fn(),fee:vi.fn()}))
vi.mock('@solana/web3.js',async original=>({...await original<typeof import('@solana/web3.js')>(),Connection:class {
 getGenesisHash=rpc.genesis;getTransaction=rpc.transaction;getBlockHeight=rpc.height;sendRawTransaction=rpc.send;getLatestBlockhash=rpc.latest;getBalance=rpc.balance;getFeeForMessage=rpc.fee
}}))
vi.mock('./system-config',()=>({getSolanaNetworkProfile:async()=>({primaryUrl:'https://primary.example.com',fallbackUrl:'https://fallback.example.com'})}))
beforeEach(()=>{vi.clearAllMocks();rpc.genesis.mockResolvedValue('5eykt4UsFv8P8NJdTREpY1vzqKqZKvdp');rpc.transaction.mockResolvedValue(null);rpc.height.mockResolvedValue(1000)})
import { buildSolTransfer,validatePreparedTransfer,validateSignedTransfer,validateSolIntent,observeSolTransfer,broadcastSolTransfer,prepareSolTransfer } from './sol-payment-chain'
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
