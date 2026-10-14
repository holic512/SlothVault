import { describe, expect, it, vi, afterEach } from 'vitest'
import { mkdtempSync, rmSync } from 'node:fs'
import { join } from 'node:path'
import { tmpdir } from 'node:os'
import { TelemetryRuntime } from './runtime'
import type { AnalyticsData, RequestSample } from '@/types/telemetry'
const directories:string[]=[],runtimes:TelemetryRuntime[]=[]
function runtime(){const directory=mkdtempSync(join(tmpdir(),'sv-telemetry-runtime-'));directories.push(directory);const value=new TelemetryRuntime(join(directory,'metrics.sqlite'));runtimes.push(value);return value}
async function waitFor(operation:()=>boolean){const deadline=Date.now()+5000;while(!operation()){if(Date.now()>deadline)throw new Error('Worker did not become ready');await new Promise(resolve=>setTimeout(resolve,25))}}
const sample:RequestSample={id:'one',timestamp:Date.now(),route:'/api/test',method:'GET',category:'api',status:200,durationMs:10,waitMs:1,handlerMs:9,kind:'normal'}
afterEach(async()=>{for(const value of runtimes)await value.stop();runtimes.length=0;for(const directory of directories)rmSync(directory,{recursive:true,force:true});directories.length=0;vi.restoreAllMocks()})
describe('bounded telemetry worker runtime',()=>{
  it('persists off-thread, survives a worker exit and rotates restored content epochs',async()=>{
    const value=runtime();await waitFor(()=>value.collection().state==='healthy')
    value.record(sample,true);value.page({id:'view',timestamp:Date.now(),key:'article:1',visitorHash:null,visibleMs:0,depth:0,content:{key:'article:1',kind:'article',title:'Real',href:'/articles/1'}});value.flush()
    await waitFor(()=>value.collection().lastPersistedAt!==null)
    expect((await value.query<AnalyticsData>('analytics',{range:'today'})).summary.views).toBe(1)
    const worker=(value as unknown as {worker:{terminate:()=>Promise<unknown>}}).worker;await worker.terminate()
    await waitFor(()=>value.collection().state==='healthy')
    expect((await value.query<AnalyticsData>('analytics',{range:'today'})).summary.views).toBe(1)
    await value.rotate();expect((await value.query<AnalyticsData>('analytics',{range:'today'})).summary.views).toBe(0)
  })
  it('reconciles persisted business restore receipts after a process restart',async()=>{
    const value=runtime();await waitFor(()=>value.collection().state==='healthy')
    const epoch=value.collection().epoch
    await value.reconcileSourceGeneration('restore-one')
    expect(value.collection().epoch).not.toBe(epoch)
    const restored=value.collection().epoch
    await value.reconcileSourceGeneration('restore-one');expect(value.collection().epoch).toBe(restored)
    await value.reconcileSourceGeneration('restore-two');expect(value.collection().epoch).not.toBe(restored)
  })
  it('bounds aggregate and reading queues and surfaces dropped events instead of false zero',async()=>{
    const value=runtime()
    for(let index=0;index<2050;index++)value.record({...sample,route:`/route-${index}`},false)
    for(let index=0;index<2005;index++)value.page({id:String(index),timestamp:Date.now(),key:'page:/',visitorHash:null,visibleMs:0,depth:0})
    expect(value.collection().droppedEvents).toBeGreaterThanOrEqual(7)
    expect(value.collection().pending).toBeLessThanOrEqual(4048)
  })
  it('prioritizes errors over ordinary samples when the sample buffer is full',()=>{
    const value=runtime();for(let index=0;index<1000;index++)value.record({...sample,id:String(index)},true)
    value.record({...sample,id:'failure',kind:'error',status:500},true)
    expect((value as unknown as {samples:RequestSample[]}).samples).toHaveLength(1000)
    expect((value as unknown as {samples:RequestSample[]}).samples.at(-1)?.id).toBe('failure')
    expect(value.collection().droppedSamples).toBe(1)
  })
  it('startup/storage failure never throws into a business record call',async()=>{
    const directory=mkdtempSync(join(tmpdir(),'sv-telemetry-bad-'));directories.push(directory)
    const value=new TelemetryRuntime(directory);runtimes.push(value)
    await waitFor(()=>value.collection().state==='degraded')
    expect(()=>value.record(sample,true)).not.toThrow()
    await expect(value.query('analytics',{range:'today'})).rejects.toThrow('TELEMETRY_UNAVAILABLE')
  })
})
