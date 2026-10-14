import { describe, it, expect } from 'vitest'
import { mkdtempSync, rmSync } from 'node:fs'
import { tmpdir } from 'node:os'
import { join } from 'node:path'
import { randomUUID } from 'node:crypto'
import { TelemetryStore, BOUNDS, emptyHist, percentile, dayStart } from './telemetry-store.mjs'
const NOW=Date.parse('2026-10-14T04:00:00Z'),MINUTE=60000,DAY=86400000
function request({count=1,ms=10,bucket=NOW-MINUTE,route='/api/test',method='GET',category='api',errors5=0,wait=0}={}){const histogram=emptyHist();histogram[BOUNDS.findIndex(value=>value>=ms)]=count;return {bucket,route,method,category,count,duration:count*ms,wait:wait*count,handler:count*(ms-wait),errors4:0,errors5,slow:ms>=(category==='long'?5000:1000)?count:0,streamErrors:0,histogram}}
function batch(values={}){return {id:randomUUID(),timestamp:NOW,requests:[],pages:[],samples:[],streams:[],...values}}
function page(values={}){return {id:'view-1',timestamp:NOW-MINUTE,key:'article:1',visibleMs:0,depth:0,visitorHash:'anonymous',content:{key:'article:1',kind:'article',title:'A real title',href:'/articles/1'},...values}}
function withStore(operation){const store=new TelemetryStore(':memory:',NOW-14*DAY);try{return operation(store)}finally{store.close()}}
describe('isolated telemetry aggregates',()=>{
  it('computes weighted mean and merges histograms, never averages bucket percentiles',()=>withStore(store=>{
    store.apply(batch({requests:[request({count:99,ms:10}),request({count:1,ms:1000,bucket:NOW-2*MINUTE})]}))
    const result=store.observability('1h',NOW)
    expect(result.summary.averageMs).toBe(19.9);expect(result.summary.count).toBe(100);expect(result.summary.p95Ms).toBeLessThan(11)
    expect(percentile(emptyHist())).toBeNull()
  }))
  it('replayed batch IDs never double count even after reconnect',()=>withStore(store=>{
    const input=batch({requests:[request({count:3})]});store.apply(input);store.apply(input)
    expect(store.observability('1h',NOW).summary.count).toBe(3)
  }))
  it('compares same-route complete-day history only after sufficient samples',()=>withStore(store=>{
    store.apply(batch({requests:[request({count:100,ms:200,bucket:dayStart(NOW)-DAY}),request({count:20,ms:500}),request({count:10,ms:2000,route:'/api/other'})]}))
    const routes=store.observability('1h',NOW).routes
    expect(routes.find(row=>row.route==='/api/test')).toMatchObject({baselineReady:true,regressed:true,baselineMs:200})
    expect(routes.find(row=>row.route==='/api/other')).toMatchObject({baselineReady:false,regressed:false})
  }))
  it('deduplicates cumulative, repeated and out-of-order reading and clamps invented time',()=>withStore(store=>{
    store.apply(batch({pages:[page()]}))
    store.apply(batch({pages:[page({timestamp:NOW-40000,visibleMs:12000,depth:80})]}))
    store.apply(batch({pages:[page({timestamp:NOW-30000,visibleMs:5000,depth:20}),page({timestamp:NOW-20000,visibleMs:12000,depth:80})]}))
    const result=store.analytics('today',NOW)
    expect(result.summary).toMatchObject({views:1,reads:1,averageVisibleMs:12000,averageDepth:80,visitors:1})
    store.apply(batch({pages:[page({id:'spoofed',visibleMs:1800000,depth:100})]}))
    expect(store.analytics('today',NOW).summary.reads).toBe(1)
  }))
  it('counts project rollups without duplicating site totals and keeps versions separate',()=>withStore(store=>{
    const content={key:'note:1:2:3',kind:'note',title:'Install',href:'/project/1/v/2/docs/3',projectKey:'project:1',projectTitle:'Atlas',version:'v2'}
    store.apply(batch({pages:[page({key:content.key,content})]}))
    store.apply(batch({pages:[page({key:content.key,content,timestamp:NOW-30000,visibleMs:20000,depth:100})]}))
    expect(store.analytics('today',NOW).summary.views).toBe(1)
    expect(store.analytics('today',NOW,'__all__','project').rankings[0]).toMatchObject({key:'project:1',views:1,reads:1})
    expect(store.analytics('today',NOW,'__all__','note').rankings[0]).toMatchObject({key:'note:1:2:3',version:'v2',views:1,reads:1})
  }))
  it('does not merge a reused view ID with a different content identity',()=>withStore(store=>{
    store.apply(batch({pages:[page(),page({key:'article:2',content:{key:'article:2',kind:'article',title:'Other',href:'/articles/2'}})]}))
    expect(store.analytics('today',NOW).summary.views).toBe(1)
  }))
  it('multi-day visitors are daily averages, not cross-day unique people',()=>withStore(store=>{
    store.apply(batch({pages:[page({timestamp:NOW-DAY,visitorHash:'day-one'}),page({id:'view-2',visitorHash:'day-two'})]}))
    expect(store.analytics('today',NOW).summary.visitors).toBe(1)
    expect(store.analytics('7d',NOW).summary.visitors).toBeCloseTo(2/8)
  }))
  it('records stream terminal state separately from Response preparation',()=>withStore(store=>{
    store.apply(batch({requests:[request()],samples:[{id:'req',timestamp:NOW-MINUTE,route:'/api/test',method:'GET',category:'api',status:200,durationMs:10,waitMs:0,handlerMs:10,kind:'normal',streamState:'open'}]}))
    store.apply(batch({streams:[{id:'req',timestamp:NOW-MINUTE,route:'/api/test',method:'GET',state:'error',durationMs:500}]}))
    expect(store.samples({range:'1h'},NOW).items[0]).toMatchObject({durationMs:10,streamState:'error',streamMs:500})
    expect(store.observability('1h',NOW).summary.streamErrors).toBe(1)
  }))
  it('keeps 7-day samples and 90-day hourly history and limits sample pages',()=>withStore(store=>{
    store.apply(batch({requests:[request({bucket:NOW-8*DAY}),request({bucket:NOW-91*DAY})],samples:[{id:'old',timestamp:NOW-8*DAY,route:'/api/test',method:'GET',category:'api',status:500,durationMs:10,waitMs:0,handlerMs:10,kind:'error'}]}))
    store.cleanup(NOW)
    expect(store.db.prepare("SELECT COUNT(*) n FROM request_bucket WHERE resolution='minute'").get().n).toBe(0)
    expect(store.db.prepare("SELECT COUNT(*) n FROM request_bucket WHERE resolution='hour'").get().n).toBe(1)
    expect(store.samples({pageSize:100},NOW).pageSize).toBe(50)
    expect(store.db.prepare('SELECT COUNT(*) n FROM request_sample').get().n).toBe(0)
  }))
  it('persists history on restart and epoch rotation prevents restored IDs from inheriting old popularity',()=>{
    const directory=mkdtempSync(join(tmpdir(),'sv-telemetry-test-')),file=join(directory,'metrics.sqlite')
    try {
      let store=new TelemetryStore(file,NOW);store.apply(batch({pages:[page()]}));const epoch=store.metadata().epoch;store.close()
      store=new TelemetryStore(file,NOW);expect(store.analytics('today',NOW).summary.views).toBe(1)
      store.rotate(NOW);expect(store.metadata().epoch).not.toBe(epoch);expect(store.analytics('today',NOW).summary.views).toBe(0)
      expect(store.db.prepare('SELECT COUNT(*) n FROM page_hour').get().n).toBe(2);store.close()
    }finally{rmSync(directory,{recursive:true,force:true})}
  })
})
describe('sample capacity and persistence integrity',()=>{
  it('enforces 100,000 samples with ordinary entries evicted first',()=>withStore(store=>{
    const statement=store.db.prepare('INSERT INTO request_sample VALUES (?,?,?,?,?,?,?,?,?,?,?,?,?)')
    store.db.transaction(()=>{for(let i=0;i<100001;i++)statement.run(`sample-${i}`,store.epoch,NOW-1000,'/api/test','GET','api',200,10,0,10,'normal',null,null)})()
    // Cap by priority independently of age-based cleanup.
    store.apply(batch({samples:[{id:'error-priority',timestamp:NOW-500,route:'/api/test',method:'GET',category:'api',status:500,durationMs:10,waitMs:0,handlerMs:10,kind:'error'}]}))
    expect(store.db.prepare('SELECT COUNT(*) count FROM request_sample').get().count).toBe(100000)
    expect(store.db.prepare('SELECT id FROM request_sample WHERE id=?').get('error-priority')).toBeDefined()
  }))
  it('persists data-gap markers rather than showing falsely healthy history after restart',()=>withStore(store=>{
    store.apply(batch({lostEvents:true}))
    expect(store.metadata().incompleteSince).toBe(NOW)
    store.apply(batch());expect(store.metadata().incompleteSince).toBe(NOW)
  }))
})
