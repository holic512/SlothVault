import { EventEmitter } from 'node:events'
import { beforeEach, describe, expect, it, vi } from 'vitest'
const mocks=vi.hoisted(()=>({ config:vi.fn(), request:vi.fn(), lookup:vi.fn() }))
vi.mock('./system-config',()=>({getConfigValue:mocks.config}))
vi.mock('node:https',()=>({request:mocks.request}))
vi.mock('node:dns/promises',()=>({lookup:mocks.lookup}))
import { parseMarketQuote,isPublicMarketAddress,validateMarketUrl,fetchMarketJson,getMarketQuote } from './market-data'
const quote=(provider='okx',price='123.45',ts=Date.now())=>({code:provider==='okx'?'0':'00000',data:[provider==='okx'?{instId:'SOL-USDT',last:price,ts:String(ts)}:{symbol:'SOLUSDT',lastPr:price,ts:String(ts)}]})
beforeEach(()=>{vi.clearAllMocks();mocks.config.mockResolvedValue('');mocks.lookup.mockResolvedValue([{address:'8.8.8.8',family:4}])})
function responses(values:unknown[]){
 mocks.request.mockImplementation((_url,options,callback)=>{
   const req=new EventEmitter() as EventEmitter & {end:()=>void}
   req.end=()=>queueMicrotask(()=>{
     options.lookup('example.com',{},(error:Error|null)=>{
       if(error){req.emit('error',error);return}
       const response=new EventEmitter() as EventEmitter & {statusCode:number;headers:object;destroy:()=>void}
       response.statusCode=200;response.headers={};response.destroy=()=>{}
       callback(response);response.emit('data',Buffer.from(JSON.stringify(values.shift())));response.emit('end')
     })
   });return req
 })
}
describe('public system quotes',()=>{
 it('normalizes both adapters with explicit units and timestamps',()=>{
   expect(parseMarketQuote('okx',quote())).toMatchObject({base:'SOL',quote:'USDT',price:'123.45',provider:'okx'})
   expect(parseMarketQuote('bitget',quote('bitget'))).toMatchObject({price:'123.45',provider:'bitget'})
 })
 it('rejects stale, future, malformed and mismatched data',()=>{
   for(const value of [quote('okx','0'),quote('okx','NaN'),quote('okx','1',Date.now()-60001),quote('okx','1',Date.now()+6000),{code:'0',data:[{instId:'BTC-USDT',last:'10',ts:Date.now()}]}])expect(()=>parseMarketQuote('okx',value)).toThrow('PRICE_UNAVAILABLE')
 })
 it.each(['127.0.0.1','10.0.0.1','169.254.169.254','172.16.0.1','192.168.1.1','100.64.0.1','::1','::ffff:127.0.0.1','fc00::1','fe80::1','2002:7f00:1::'])('blocks nonpublic or transition address %s',address=>expect(isPublicMarketAddress(address)).toBe(false))
 it('accepts ordinary public IPs and rejects credentials, redirects targets and insecure URLs',()=>{
   expect(isPublicMarketAddress('8.8.8.8')).toBe(true)
   expect(isPublicMarketAddress('2606:4700:4700::1111')).toBe(true)
   for(const url of ['http://example.com','https://localhost/a','https://127.0.0.1','https://user:secret@example.com','https://example.com:444'])expect(()=>validateMarketUrl(url)).toThrow()
 })
 it('pins validated DNS and rejects mixed public/private DNS answers',async()=>{
   responses([quote()]);mocks.lookup.mockResolvedValue([{address:'8.8.8.8',family:4},{address:'127.0.0.1',family:4}])
   await expect(fetchMarketJson('https://example.com',AbortSignal.timeout(1000))).rejects.toThrow('Non-public')
 })
 it('fails over, coalesces only current requests, then fetches again',async()=>{
   responses([{code:'error'},quote('bitget'),quote()])
   const [a,b]=await Promise.all([getMarketQuote(),getMarketQuote()]);expect(a).toEqual(b);expect(a.provider).toBe('bitget');expect(mocks.request).toHaveBeenCalledTimes(2)
   expect((await getMarketQuote()).provider).toBe('okx');expect(mocks.request).toHaveBeenCalledTimes(3)
 })
 it('never serves an old quote when both sources fail',async()=>{responses([{code:'error'},{code:'error'}]);await expect(getMarketQuote()).rejects.toThrow('PRICE_UNAVAILABLE')})
})
