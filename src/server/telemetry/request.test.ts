import { describe, expect, it, vi, beforeEach } from 'vitest'
import { readdirSync } from 'node:fs'
import { resolve } from 'node:path'
const mocks=vi.hoisted(()=>({runtime:{record:vi.fn(),stream:vi.fn()}}))
vi.mock('./runtime',()=>({telemetryRuntime:()=>mocks.runtime}))
import { createRequestProbe, ignoredTelemetryPath, safeRoute } from './request'
import { ROUTE_TEMPLATES } from './route-templates'
describe('privacy-safe request instrumentation',()=>{
  beforeEach(()=>vi.clearAllMocks())
  it('templates dynamic IDs, tokens, signatures and upload paths',()=>{
    expect(safeRoute('/api/commission-invitations/secret-token')).toBe('/api/commission-invitations/[token]')
    expect(safeRoute('/uploads/private/sensitive-file.pdf')).toBe('/uploads/[...path]')
    expect(safeRoute('/api/admin/mm/article/123')).toBe('/api/admin/mm/article/[id]')
    expect(safeRoute('/api/unknown/secret')).toBe('/unknown')
  })
  it('registry matches the actual committed route tree',()=>{
    const root=resolve(process.cwd(),'src/app'),routes:string[]=[]
    function walk(directory:string){for(const entry of readdirSync(directory,{withFileTypes:true})){const path=resolve(directory,entry.name);if(entry.isDirectory())walk(path);else if(entry.name==='route.ts')routes.push('/'+path.slice(root.length+1,-'/route.ts'.length).split('/').filter(part=>!part.startsWith('(')).join('/'))}}
    walk(root);expect([...ROUTE_TEMPLATES].sort()).toEqual(routes.sort())
  })
  it('excludes ingestion and dashboard traffic',()=>{
    for(const path of ['/api/telemetry/events','/api/admin/mm/analytics','/api/admin/mm/analytics/content','/api/admin/mm/observability/requests']){
      expect(ignoredTelemetryPath(path)).toBe(true);expect(createRequestProbe({nextUrl:new URL('http://localhost'+path),method:'GET'} as never)).toBeUndefined()
    }
  })
  it.each([200,400,401,403,500,503])('retains status %s without request body, URL or credentials',status=>{
    vi.spyOn(Math,'random').mockReturnValue(0)
    const probe=createRequestProbe({nextUrl:new URL('http://localhost/api/commission-invitations/secret?token=private'),method:'GET'} as never)
    probe?.wait(12);probe?.handler(25);probe?.finish(status)
    expect(mocks.runtime.record).toHaveBeenCalledOnce()
    const sample=mocks.runtime.record.mock.calls[0][0]
    expect(sample).toMatchObject({route:'/api/commission-invitations/[token]',status,waitMs:12,handlerMs:25})
    expect(JSON.stringify(sample)).not.toMatch(/secret|private|token=/)
    vi.restoreAllMocks()
  })
  it('captures stream cancellation independently',()=>{
    const probe=createRequestProbe({nextUrl:new URL('http://localhost/api/account/contracts/1/attachment'),method:'GET'} as never)
    probe?.finish(200,true);probe?.stream('canceled')
    expect(mocks.runtime.stream.mock.calls[0][0]).toMatchObject({state:'canceled',route:'/api/account/contracts/[id]/attachment'})
  })
})
