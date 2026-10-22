import { mkdtempSync, rmSync } from 'node:fs'
import { tmpdir } from 'node:os'
import { join } from 'node:path'
import { createHash, randomUUID } from 'node:crypto'
import { Keypair, Transaction } from '@solana/web3.js'
import type { AppPrismaClient } from '@/server/database/client'
import type { PreparedSolTransfer, SolTransferIntent } from '@slothvault/plugin-sdk/protocol'
import { personalSecurityDatabase } from '@/test/personal-security-database'
import { beforeEach, afterEach, describe, expect, it, vi } from 'vitest'
const mocks = vi.hoisted(()=>({ client:null as unknown as AppPrismaClient, directory:'', quote:vi.fn(), prepare:vi.fn(), broadcast:vi.fn(), observe:vi.fn() }))
vi.mock('@/server/prisma',()=>({get prisma(){return mocks.client}}))
vi.mock('@/server/database/client',()=>({getDatabaseClient:()=>mocks.client,configuredDatabaseProvider:()=> 'sqlite',databaseSnapshotIsolationLevel:()=> 'Serializable'}))
vi.mock('@/server/config/app-data',()=>({appDataPath:()=>mocks.directory}))
vi.mock('@/server/config/master-key',()=>({getMasterKey:()=> 'sol-payment-test-only-master'}))
vi.mock('@/server/services/market-data',()=>({getMarketQuote:mocks.quote}))
vi.mock('@/server/services/sol-payment-chain',async original=>({ ...await original<typeof import('@/server/services/sol-payment-chain')>(),prepareSolTransfer:mocks.prepare,broadcastSolTransfer:mocks.broadcast,observeSolTransfer:mocks.observe }))
import { buildSolTransfer,validateSignedTransfer } from '@/server/services/sol-payment-chain'
import { initializePlugins,installPlugin,savePluginConfig,setPluginEnabled,invokeRegisteredPlugin,resetPluginInitialization,uninstallPlugin } from './manager'
import { pluginWorkers,stopPluginWorker,startPluginWorker } from './runtime'
import { pluginRegistry } from './state'
import { pluginTableMap,PluginTransactions } from './database'
import { RESTORE_COMMIT_CONFIG_KEY } from '@/server/services/admin-backup/constants'
import { z } from 'zod'
import { toJsonSafe } from '@/server/http/response'
import { editTestPackage, readTestPackage } from './test-package'
import { exportPluginRows, pluginBackupShape, validatePluginBackup, preparePluginRestore, clearPluginDataForRestore, importPluginRecords, reconcilePluginRestore } from './backup'
const ID='slothvault.sol-payments'
let db:ReturnType<typeof personalSecurityDatabase>,actor:{userId:number;role:string},payer:Keypair,recipient:string,tables:Record<string,string>
type PaymentOrder={id:string;asset:'SOL'|'USDT';amount:string;lamports:string;rate:string;quote:{price:string}|null;points:number;status:string;reason:string|null;signature:string|null;recipient:string}
const invoke=(key:string,input?:unknown,query?:Record<string,string>,admin=false)=>invokeRegisteredPlugin(pluginRegistry.get(ID)!,'api',key,{actor:admin?{...actor,role:'ADMIN'}:actor,input,query},false,['options','list','detail','admin-list'].includes(key))
async function create(asset:'SOL'|'USDT'='SOL'){return await invoke('create',{points:1000,payer:payer.publicKey.toBase58(),requestKey:randomUUID(),asset}) as PaymentOrder}
async function signed(orderId:string){const result=await invoke('prepare',{orderId}) as {attemptId:string;prepared:PreparedSolTransfer};const tx=Transaction.from(Buffer.from(result.prepared.transactionBase64,'base64'));tx.sign(payer);return {orderId,attemptId:result.attemptId,signedTransaction:tx.serialize().toString('base64')}}
async function submit(){const order=await create();const input=await signed(order.id);await invoke('submit',input);return {order,input}}
const order=(id:string)=>invoke('detail',undefined,{orderId:id}) as Promise<PaymentOrder>
const due=()=>mocks.client.$executeRawUnsafe(`UPDATE "${tables.attempts}" SET next_check_at = ?`,new Date(Date.now()-1000).toISOString())
const job=()=>invokeRegisteredPlugin(pluginRegistry.get(ID)!,'jobs','reconcile',{},true,false,{id:randomUUID(),attempt:1,scheduledAt:new Date().toISOString()})
describe('Solana payment worker and durable SQLite ledger',{timeout:30000},()=>{
 beforeEach(async()=>{
  vi.clearAllMocks();db=personalSecurityDatabase();mocks.client=db.client;mocks.directory=mkdtempSync(join(tmpdir(),'sv-sol-plugin-'))
  resetPluginInitialization();await initializePlugins()
  const user=await mocks.client.user.create({data:{username:'buyer',password:'test-only',role:'USER'}});actor={userId:user.id,role:'USER'};payer=Keypair.generate();recipient=Keypair.generate().publicKey.toBase58()
  mocks.quote.mockImplementation(async()=>({base:'SOL',quote:'USDT',price:'100',provider:'okx',observedAt:new Date().toISOString(),fetchedAt:new Date().toISOString()}))
  mocks.prepare.mockImplementation(async(pluginId:string,intent:SolTransferIntent)=>{const blockhash=Keypair.generate().publicKey.toBase58(),lastValidBlockHeight=100;const tx=buildSolTransfer(pluginId,intent,blockhash,lastValidBlockHeight);return {...intent,blockhash,lastValidBlockHeight,messageHash:createHash('sha256').update(tx.serializeMessage()).digest('hex'),transactionBase64:tx.serialize({requireAllSignatures:false}).toString('base64')}})
  mocks.broadcast.mockImplementation(async(pluginId:string,input:unknown)=>({signature:validateSignedTransfer(pluginId,input).signature}))
  mocks.observe.mockResolvedValue({status:'PENDING'})
  await installPlugin(readTestPackage('sol-payments'),{trusted:true,actorUserId:null})
  await savePluginConfig(ID,{salesEnabled:true,recipient,pointsPerUsdt:'100',minPoints:1,maxPoints:1000000},actor.userId)
  await setPluginEnabled(ID,true,actor.userId);tables=pluginTableMap(pluginRegistry.get(ID)!.manifest)
 },60000)
 afterEach(async()=>{for(const id of pluginWorkers.keys())await stopPluginWorker(id);resetPluginInitialization();await db.close();rmSync(mocks.directory,{recursive:true,force:true})},60000)
 it('defaults to six-decimal USDT and creates rounded orders without consulting unavailable SOL quotes',async()=>{
  expect(await invoke('options')).toMatchObject({assets:['USDT','SOL'],defaultAsset:'USDT'})
  mocks.quote.mockRejectedValue(new Error('PRICE_UNAVAILABLE'))
  await savePluginConfig(ID,{salesEnabled:true,recipient,pointsPerUsdt:'3',minPoints:1,maxPoints:1000000},actor.userId)
  const created=await invoke('create',{points:1,payer:payer.publicKey.toBase58(),requestKey:randomUUID()}) as PaymentOrder
  expect(created).toMatchObject({asset:'USDT',amount:'333334',lamports:'0',rate:'3',points:1,quote:null,status:'AWAITING_PAYMENT'})
  expect(await order(created.id)).toMatchObject({asset:'USDT',amount:'333334',quote:null})
  const prepared=await invoke('prepare',{orderId:created.id}) as {prepared:PreparedSolTransfer}
  expect(prepared.prepared).toMatchObject({asset:'USDT',tokenAmount:'333334',recipient,payer:payer.publicKey.toBase58()})
  expect(prepared.prepared).not.toHaveProperty('lamports')
  expect(mocks.quote).not.toHaveBeenCalled()
 })
 it('treats default and explicit USDT as the same request but rejects changing its payment asset',async()=>{
  const input={points:1000,payer:payer.publicKey.toBase58(),requestKey:randomUUID()}
  const created=await invoke('create',input) as PaymentOrder
  expect(await invoke('create',{...input,asset:'USDT'})).toMatchObject({id:created.id,asset:'USDT',amount:'10000000'})
  await expect(invoke('create',{...input,asset:'SOL'})).rejects.toThrow('IDEMPOTENCY_CONFLICT')
  expect(mocks.quote).not.toHaveBeenCalled()
  const nativeInput={...input,requestKey:randomUUID(),asset:'SOL'}
  const native=await invoke('create',nativeInput) as PaymentOrder
  await expect(invoke('create',{...nativeInput,asset:'USDT'})).rejects.toThrow('IDEMPOTENCY_CONFLICT')
  expect(await order(native.id)).toMatchObject({asset:'SOL',amount:'100000000'})
  expect(mocks.quote).toHaveBeenCalledTimes(1)
 })
 it('keeps USDT amount, recipient and credited points locked after configuration changes and paused sales',async()=>{
  const input={points:1000,payer:payer.publicKey.toBase58(),requestKey:randomUUID(),asset:'USDT'}
  const created=await invoke('create',input) as PaymentOrder
  await savePluginConfig(ID,{salesEnabled:false,recipient:Keypair.generate().publicKey.toBase58(),pointsPerUsdt:'1',minPoints:2000,maxPoints:1000000},actor.userId)
  mocks.quote.mockRejectedValue(new Error('PRICE_UNAVAILABLE'))
  expect(await invoke('create',input)).toMatchObject({id:created.id,asset:'USDT',amount:'10000000',rate:'100',recipient,quote:null})
  const payment=await signed(created.id)
  expect(mocks.prepare).toHaveBeenLastCalledWith(ID,expect.objectContaining({asset:'USDT',tokenAmount:'10000000',recipient}))
  await invoke('submit',payment)
  mocks.observe.mockResolvedValue({status:'FINALIZED',slot:34})
  await invoke('reconcile',{orderId:created.id})
  expect(await order(created.id)).toMatchObject({status:'PAID',asset:'USDT',amount:'10000000',points:1000,rate:'100',recipient})
  expect(await mocks.client.pointTransaction.findFirstOrThrow()).toMatchObject({amount:1000,referenceId:created.id})
  expect(mocks.quote).not.toHaveBeenCalled()
 })
 it('persists USDT signatures before broadcast and credits finalized transfers once after restart and concurrent retries',async()=>{
  mocks.quote.mockRejectedValue(new Error('PRICE_UNAVAILABLE'))
  const durable:{expectedSignature:string;signed_transaction:string;signature:string;prepared_json:string}[]=[]
  mocks.broadcast.mockImplementation(async(pluginId:string,input:unknown)=>{
   const checked=validateSignedTransfer(pluginId,input)
   const rows=await mocks.client.$queryRawUnsafe<{signed_transaction:string;signature:string;prepared_json:string}[]>(`SELECT signed_transaction, signature, prepared_json FROM "${tables.attempts}"`)
   durable.push({expectedSignature:checked.signature,...rows[0]})
   throw new Error('response lost')
  })
  const created=await create('USDT'),payment=await signed(created.id)
  const submits=await Promise.allSettled([invoke('submit',payment),invoke('submit',payment)])
  expect(submits.some(result=>result.status==='fulfilled')).toBe(true)
  expect(mocks.broadcast).toHaveBeenCalled()
  expect(durable.length).toBeGreaterThan(0)
  for(const evidence of durable){
   expect(evidence.signature).toBe(evidence.expectedSignature)
   expect(Transaction.from(Buffer.from(evidence.signed_transaction,'base64')).verifySignatures()).toBe(true)
   expect(JSON.parse(evidence.prepared_json)).toMatchObject({asset:'USDT',tokenAmount:'10000000'})
  }
  expect(await order(created.id)).toMatchObject({status:'CONFIRMING',asset:'USDT',amount:'10000000',signature:expect.any(String)})
  await stopPluginWorker(ID);resetPluginInitialization();await initializePlugins()
  mocks.observe.mockResolvedValue({status:'FINALIZED',slot:701})
  await Promise.allSettled([invoke('reconcile',{orderId:created.id}),invoke('reconcile',{orderId:created.id})]);await due();await job();await due();await job()
  expect(await order(created.id)).toMatchObject({status:'PAID',asset:'USDT',amount:'10000000',signature:expect.any(String)})
  expect(await mocks.client.pointTransaction.count()).toBe(1)
  expect(await mocks.client.pluginPointReceipt.count()).toBe(1)
  expect(await mocks.client.pluginPointReceipt.findFirstOrThrow()).toMatchObject({pluginId:ID,sourceKey:`order:${created.id}`,amount:1000,userId:actor.userId})
  expect((await mocks.client.user.findUniqueOrThrow({where:{id:actor.userId}})).pointsBalance).toBe(1000)
  expect(await invoke('submit',payment)).toMatchObject({status:'PAID'})
  expect(mocks.quote).not.toHaveBeenCalled()
 })
 it('upgrades the original SOL schema and settles preserved prepared transactions without an asset tag',async()=>{
  const created=await create()
  const first=await invoke('prepare',{orderId:created.id}) as {attemptId:string;prepared:PreparedSolTransfer}
  if(first.prepared.asset==='USDT')throw new Error('Expected a legacy-compatible SOL transfer')
  const legacyPrepared={...first.prepared};delete legacyPrepared.asset
  const [savedOrder]=await mocks.client.$queryRawUnsafe<Record<string,unknown>[]>(`SELECT * FROM "${tables.orders}" WHERE id = ?`,created.id)
  const [savedAttempt]=await mocks.client.$queryRawUnsafe<Record<string,unknown>[]>(`SELECT * FROM "${tables.attempts}" WHERE id = ?`,first.attemptId)
  delete savedOrder.payment_asset;delete savedOrder.token_amount;savedAttempt.prepared_json=JSON.stringify(legacyPrepared)
  const currentPackage=readTestPackage('sol-payments')
  const legacyPackage=await editTestPackage(currentPackage,files=>{
   const manifest=JSON.parse(files.get('plugin.json')!.toString())
   manifest.version='1.1.0';manifest.migrations=['initial'];manifest.api=[];manifest.jobs=[]
   const legacyOrders=manifest.tables.find((table:{name:string})=>table.name==='orders')
   legacyOrders.columns=legacyOrders.columns.filter((column:{name:string})=>!['payment_asset','token_amount'].includes(column.name))
   files.set('plugin.json',Buffer.from(JSON.stringify(manifest)))
   files.set('src/server.ts',Buffer.from('export default () => ({ migrations: { initial: async () => {} } })'))
  })
  await uninstallPlugin(ID,{deleteData:true,confirmPluginId:ID,actorUserId:actor.userId})
  await installPlugin(legacyPackage,{trusted:true,actorUserId:actor.userId})
  const insert=async(table:string,row:Record<string,unknown>)=>mocks.client.$executeRawUnsafe(`INSERT INTO "${table}" (${Object.keys(row).map(key=>`"${key}"`).join(', ')}) VALUES (${Object.keys(row).map(()=>'?').join(', ')})`,...Object.values(row))
  await insert(tables.orders,savedOrder);await insert(tables.attempts,savedAttempt)
  const before=await mocks.client.$queryRawUnsafe<{name:string}[]>(`PRAGMA table_info("${tables.orders}")`)
  expect(before.map(column=>column.name)).not.toContain('payment_asset')
  expect(before.map(column=>column.name)).not.toContain('token_amount')
  await installPlugin(currentPackage,{trusted:true,actorUserId:actor.userId})
  await setPluginEnabled(ID,true,actor.userId)
  const after=await mocks.client.$queryRawUnsafe<{name:string;notnull:bigint|number}[]>(`PRAGMA table_info("${tables.orders}")`)
  for(const name of ['payment_asset','token_amount'])expect(Number(after.find(column=>column.name===name)?.notnull)).toBe(0)
  expect(await mocks.client.$queryRawUnsafe(`SELECT payment_asset, token_amount FROM "${tables.orders}" WHERE id = ?`,created.id)).toEqual([{payment_asset:null,token_amount:null}])
  await stopPluginWorker(ID);resetPluginInitialization();await initializePlugins()
  expect(await order(created.id)).toMatchObject({asset:'SOL',amount:'100000000',lamports:'100000000',quote:{price:'100'}})
  const replay=await invoke('prepare',{orderId:created.id}) as {attemptId:string;prepared:PreparedSolTransfer}
  expect(replay).toEqual({attemptId:first.attemptId,prepared:legacyPrepared})
  expect(replay.prepared).not.toHaveProperty('asset')
  const payment=await signed(created.id);await invoke('submit',payment)
  expect(mocks.prepare).toHaveBeenCalledTimes(1)
  mocks.observe.mockResolvedValue({status:'FINALIZED',slot:702});await job()
  expect(await order(created.id)).toMatchObject({status:'PAID',asset:'SOL',amount:'100000000'})
  expect(await mocks.client.pointTransaction.count()).toBe(1)
  await due();await job();expect(await invoke('submit',payment)).toMatchObject({status:'PAID'})
  expect(await mocks.client.pointTransaction.count()).toBe(1)
  expect(await mocks.client.pluginPointReceipt.count()).toBe(1)
 })
 it('locks one quote per idempotent request, detects conflicts, and honors locked orders during paused sales and price outages',async()=>{
  const input={points:1000,payer:payer.publicKey.toBase58(),requestKey:randomUUID(),asset:'SOL'}
  const a=await invoke('create',input) as {id:string};expect(await invoke('create',input)).toMatchObject({id:a.id,lamports:'100000000'});expect(mocks.quote).toHaveBeenCalledTimes(1)
  await expect(invoke('create',{...input,points:1001})).rejects.toThrow('IDEMPOTENCY_CONFLICT')
  await savePluginConfig(ID,{salesEnabled:false,recipient:Keypair.generate().publicKey.toBase58(),pointsPerUsdt:'1',minPoints:1,maxPoints:1000000},actor.userId)
  mocks.quote.mockRejectedValue(new Error('PRICE_UNAVAILABLE'))
  await expect(create()).rejects.toThrow('SALES_PAUSED')
  await invoke('submit',await signed(a.id));expect(await order(a.id)).toMatchObject({status:'CONFIRMING',recipient,lamports:'100000000'})
 })
 it('credits exactly once under concurrent submits, foreground reconciliation and background retries',async()=>{
  const o=await create(),input=await signed(o.id)
  const results=await Promise.allSettled([invoke('submit',input),invoke('submit',input)])
  expect(results.some(r=>r.status==='fulfilled')).toBe(true)
  mocks.observe.mockResolvedValue({status:'FINALIZED',slot:123})
  await Promise.allSettled([invoke('reconcile',{orderId:o.id}),invoke('reconcile',{orderId:o.id})]);await due();await job()
  expect(await order(o.id)).toMatchObject({status:'PAID'})
  expect(await mocks.client.pointTransaction.count()).toBe(1);expect(await mocks.client.pluginPointReceipt.count()).toBe(1)
  expect((await mocks.client.user.findUniqueOrThrow({where:{id:actor.userId}})).pointsBalance).toBe(1000)
  expect(await invoke('submit',input)).toMatchObject({status:'PAID'})
 })
 it('persists before broadcast, survives restart and disable/re-enable, and settles without a browser actor',async()=>{
  mocks.broadcast.mockImplementation(async()=>{const rows=await mocks.client.$queryRawUnsafe<{signed_transaction:string;signature:string}[]>(`SELECT signed_transaction, signature FROM "${tables.attempts}"`);expect(rows[0].signature).toBeTruthy();expect(rows[0].signed_transaction).toBeTruthy();throw new Error('response lost')})
  const {order:o}=await submit();expect(await order(o.id)).toMatchObject({status:'CONFIRMING'})
  await setPluginEnabled(ID,false,actor.userId);await setPluginEnabled(ID,true,actor.userId)
  await stopPluginWorker(ID);resetPluginInitialization();await initializePlugins()
  mocks.observe.mockResolvedValue({status:'FINALIZED',slot:900});await job()
  expect(await order(o.id)).toMatchObject({status:'PAID'});expect(await mocks.client.pointTransaction.count()).toBe(1)
 })
 it('expires unsigned quotes while accepted payments settle at their original price after expiry',async()=>{
  const unsigned=await create(),input=await signed(unsigned.id),paid=await submit()
  await mocks.client.$executeRawUnsafe(`UPDATE "${tables.orders}" SET expires_at = ?`,new Date(Date.now()-1000).toISOString())
  await expect(invoke('submit',input)).rejects.toThrow('ORDER_NOT_PAYABLE');expect(await order(unsigned.id)).toMatchObject({status:'EXPIRED'})
  mocks.quote.mockRejectedValue(new Error('PRICE_UNAVAILABLE'));mocks.observe.mockResolvedValue({status:'FINALIZED',slot:10});await job();expect(await order(paid.order.id)).toMatchObject({status:'PAID'})
 })
 it('does not replace uncertain signed attempts and preserves delayed receipts for review',async()=>{
  const {order:o}=await submit();await expect(invoke('prepare',{orderId:o.id})).rejects.toThrow('ORDER_NOT_PAYABLE')
  await mocks.client.$executeRawUnsafe(`UPDATE "${tables.attempts}" SET checks = 29`);await job()
  expect(await order(o.id)).toMatchObject({status:'NEEDS_REVIEW',reason:'CONFIRMATION_DELAYED'});expect(await mocks.client.pointTransaction.count()).toBe(0)
  expect(mocks.prepare).toHaveBeenCalledTimes(1)
 })
 it('rolls back a failed credit, preserves chain evidence and settles after the account limit is resolved',async()=>{
  const {order:o}=await submit();await mocks.client.user.update({where:{id:actor.userId},data:{pointsBalance:2147483647}})
  mocks.observe.mockResolvedValue({status:'FINALIZED',slot:777});await job()
  expect(await order(o.id)).toMatchObject({status:'NEEDS_REVIEW',reason:'CREDIT_PENDING'});expect(await mocks.client.pluginPointReceipt.count()).toBe(0)
  await mocks.client.user.update({where:{id:actor.userId},data:{pointsBalance:0}});await due();await job()
  expect(await order(o.id)).toMatchObject({status:'PAID'});expect(await mocks.client.pointTransaction.count()).toBe(1)
 })
 it('enforces owner access and rejects actorless foreground credits even when background permission is declared',async()=>{
  const o=await create();actor={userId:actor.userId+999,role:'USER'};await expect(order(o.id)).rejects.toThrow('ORDER_NOT_FOUND')
  const worker=await startPluginWorker(pluginRegistry.get(ID)!),post=vi.spyOn(worker.worker,'postMessage'),transactions=new PluginTransactions()
  const timer=setTimeout(()=>undefined,10000)
  worker.pending.set('boundary',{resolve:()=>{},reject:()=>{},timer,scope:{scheduledJob:false,actor:null,transactions,ddl:false,readOnly:false,background:true,active:true,hosts:new Set()}})
  try {await worker.host({id:1,invocationId:'boundary',method:'points.credit',payload:{userId:1,amount:100,sourceKey:'forged-job',description:'test'}});expect(post).toHaveBeenCalledWith(expect.objectContaining({error:expect.objectContaining({status:403})}));expect(await mocks.client.pointTransaction.count()).toBe(0)}finally{clearTimeout(timer);worker.pending.delete('boundary')}
 })
 it('exports portable payment tables and retains receipts on ordinary uninstall',async()=>{
  const {order:o}=await submit();mocks.observe.mockResolvedValue({status:'FINALIZED',slot:12});await job()
  const rows=[];for await (const row of exportPluginRows(mocks.client)) rows.push(row)
  const stringifyIds=(values: {id:unknown}[])=>values.map(r=>({...r,id:String(r.id)}))
  const data=z.object(pluginBackupShape).parse(toJsonSafe({pluginInstallations:stringifyIds(await mocks.client.pluginInstallation.findMany()),pluginTables:stringifyIds(await mocks.client.pluginOwnedTable.findMany()),pluginMigrations:stringifyIds(await mocks.client.pluginMigration.findMany()),pluginPointReceipts:(await mocks.client.pluginPointReceipt.findMany()).map(r=>({...r,id:String(r.id),userId:String(r.userId)})),pluginRows:rows}))
  validatePluginBackup({...data,users:[{id:String(actor.userId)}]})
  expect(JSON.stringify(toJsonSafe(rows))).toContain(o.id)
  // Ordinary uninstall must leave the order/attempt evidence and host receipt intact.
  await uninstallPlugin(ID,{deleteData:false,actorUserId:actor.userId})
  expect(await mocks.client.pluginPointReceipt.count()).toBe(1)
  const saved=await mocks.client.$queryRawUnsafe<{status:string}[]>(`SELECT status FROM "${tables.orders}"`);expect(saved[0].status).toBe('PAID')
  const receipt=randomUUID()
  await preparePluginRestore({...data,giftCards:[],giftCardBatches:[]},receipt)
  await mocks.client.$transaction(async tx=>{
    await clearPluginDataForRestore(tx)
    await importPluginRecords(tx,data,{users:new Map([[String(actor.userId),actor.userId]])})
    await tx.systemConfig.create({data:{configKey:RESTORE_COMMIT_CONFIG_KEY,configValue:receipt}})
  })
  await reconcilePluginRestore();resetPluginInitialization();await initializePlugins()
  await installPlugin(readTestPackage('sol-payments'),{trusted:true,actorUserId:null});await setPluginEnabled(ID,true,actor.userId)
  expect(await order(o.id)).toMatchObject({status:'PAID'})
  expect(await mocks.client.pluginPointReceipt.count()).toBe(1)
  await due();await job();expect(await mocks.client.pointTransaction.count()).toBe(1)
 })
})
