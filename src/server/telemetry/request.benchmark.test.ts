import { expect, it, vi } from 'vitest'
import { tmpdir } from 'node:os'
import { join } from 'node:path'
import { mkdtempSync, rmSync } from 'node:fs'
const state=vi.hoisted(()=>({runtime:undefined as unknown}))
vi.mock('./runtime',async(importOriginal)=>{
  const actual=await importOriginal<typeof import('./runtime')>()
  return {...actual,telemetryRuntime:()=>state.runtime}
})
import { TelemetryRuntime } from './runtime'
import { createRequestProbe } from './request'
it('reports local enabled/disabled boundary overhead under the 5ms P95 target',async()=>{
  const directory=mkdtempSync(join(tmpdir(),'sv-telemetry-benchmark-')),runtime=new TelemetryRuntime(join(directory,'metrics.sqlite'))
  try {
    const deadline=Date.now()+5000;while(runtime.collection().state!=='healthy'){if(Date.now()>deadline)throw new Error('Worker startup timeout');await new Promise(resolve=>setTimeout(resolve,20))}
    const request={method:'GET',nextUrl:new URL('http://localhost/api/project/list')}
    const measure=(enabled:boolean)=>{
      state.runtime=enabled?runtime:undefined;const times:number[]=[]
      for(let index=0;index<11000;index++){const start=performance.now();const probe=createRequestProbe(request as never);probe?.handler(0);probe?.finish(200);if(index>=1000)times.push(performance.now()-start)}
      times.sort((a,b)=>a-b);return {p95Ms:times[Math.ceil(times.length*.95)-1],averageMs:times.reduce((a,b)=>a+b,0)/times.length}
    }
    const disabled=measure(false),enabled=measure(true),extraP95Ms=enabled.p95Ms-disabled.p95Ms
    process.stdout.write('[telemetry-local-benchmark] '+JSON.stringify({samples:10000,disabled,enabled,extraP95Ms,targetMs:5,scope:'in-process synthetic handler-boundary overhead; not a production throughput claim'})+'\n')
    expect(extraP95Ms).toBeLessThanOrEqual(5)
  }finally{state.runtime=undefined;await runtime.stop();rmSync(directory,{recursive:true,force:true})}
})
