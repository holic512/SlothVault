import { describe, expect, it, beforeEach, vi } from 'vitest'
import { NextRequest } from 'next/server'
const mocks=vi.hoisted(()=>({page:vi.fn((_event:unknown)=>{void _event;return true}),rate:vi.fn(),viewer:vi.fn(),article:vi.fn(),articleAccess:vi.fn(),project:vi.fn(),projectAccess:vi.fn(),versions:vi.fn(),note:vi.fn(),home:vi.fn()}))
vi.mock('./runtime',()=>({telemetryRuntime:()=>({page:mocks.page})}))
vi.mock('@/server/config/master-key',()=>({getMasterKey:()=> 'test-only-not-real-master-key'}))
vi.mock('./rate-limit',()=>({telemetryRateLimit:mocks.rate}))
vi.mock('@/server/prisma',()=>({prisma:{projectHome:{findFirst:mocks.home}}}))
vi.mock('@/server/auth/viewer',()=>({getRequestViewer:mocks.viewer}))
vi.mock('@/server/services/public-content-ids',()=>({resolvePublicArticleId:async()=>1,resolvePublicProjectIds:async()=>({projectId:2,versionId:3,noteId:4})}))
vi.mock('@/server/services/public-articles',()=>({getPublicArticleMetadata:mocks.article}))
vi.mock('@/server/services/content-access',()=>({resolveArticleAccess:mocks.articleAccess,resolveProjectAccess:mocks.projectAccess}))
vi.mock('@/server/services/public-projects',()=>({getPublicProject:mocks.project,getProjectNoteMetadata:mocks.note,getProjectVersions:mocks.versions,findPublicProjectHome:mocks.home}))
import { ingestTelemetry, isSameOriginTelemetry } from './events'
const payload={id:'a1e1d6c0-e43a-4a24-8fba-9286b1f73cc3',page:'/articles/10000000-0000-4000-8000-000000000001',visitorId:'b1e1d6c0-e43a-4a24-8fba-9286b1f73cc3',visibleMs:12000,depth:50}
function request(body:unknown=payload,headers:Record<string,string>={}){return new NextRequest('http://localhost/api/telemetry/events',{method:'POST',body:JSON.stringify(body),headers:{origin:'http://localhost','content-type':'application/json','x-forwarded-for':'203.0.113.2',...headers}})}
describe('public telemetry ingestion security',()=>{
  beforeEach(()=>{vi.clearAllMocks();mocks.article.mockResolvedValue({id:'1',title:'Authoritative title'});mocks.articleAccess.mockResolvedValue(true);mocks.project.mockResolvedValue({id:'2',projectName:'Atlas'});mocks.projectAccess.mockResolvedValue({canRead:true});mocks.versions.mockResolvedValue([{id:'10000000-0000-4000-8000-000000000003',version:'1.0'}]);mocks.note.mockResolvedValue({id:'4',noteTitle:'Install'});mocks.home.mockResolvedValue({});mocks.viewer.mockResolvedValue(null)})
  it('rejects cross-origin and absent-origin submissions before any persistence',async()=>{
    await expect(ingestTelemetry(request(payload,{origin:'https://other.test'}))).rejects.toMatchObject({status:403})
    await expect(ingestTelemetry(request(payload,{origin:''}))).rejects.toMatchObject({status:403})
    expect(mocks.page).not.toHaveBeenCalled()
  })
  it('accepts preserved-host TLS termination only with browser same-origin metadata',()=>{
    expect(isSameOriginTelemetry(request(payload,{origin:'https://vault.example.test',host:'vault.example.test','sec-fetch-site':'same-origin'}))).toBe(true)
    expect(isSameOriginTelemetry(request(payload,{origin:'https://vault.example.test',host:'vault.example.test'}))).toBe(false)
    expect(isSameOriginTelemetry(request(payload,{'sec-fetch-site':'cross-site'}))).toBe(false)
    expect(isSameOriginTelemetry(request(payload,{origin:'http://localhost/extra'}))).toBe(false)
  })
  it.each(['dnt','sec-gpc'])('honors privacy header %s',async(header)=>{
    expect(await ingestTelemetry(request(payload,{[header]:'1'}))).toEqual({accepted:false,reason:'PRIVACY_PREFERENCE'})
    expect(mocks.page).not.toHaveBeenCalled()
  })
  it('does not trust a supplied title, arbitrary page or oversized body',async()=>{
    for(const body of [{...payload,title:'Injected'}, {...payload,page:'/account'}, {...payload,id:'x'.repeat(3000)}]) await expect(ingestTelemetry(request(body))).rejects.toBeDefined()
    expect(mocks.page).not.toHaveBeenCalled()
  })
  it('uses authoritative metadata and hashes visitor and rate-limit identity',async()=>{
    expect(await ingestTelemetry(request())).toEqual({accepted:true})
    const event=mocks.page.mock.calls[0]?.[0] as unknown as Record<string,unknown>
    expect(event).toMatchObject({key:'article:1',visibleMs:12000,depth:50,content:{title:'Authoritative title'}})
    expect(JSON.stringify(event)).not.toContain(payload.visitorId)
    expect(JSON.stringify(event)).not.toContain('203.0.113.2')
    expect(JSON.stringify(mocks.rate.mock.calls)).not.toContain('203.0.113.2')
  })
  it('locked content can count a view but never effective reading',async()=>{
    mocks.articleAccess.mockResolvedValue(false)
    await ingestTelemetry(request())
    expect(mocks.page.mock.calls[0]?.[0]).toMatchObject({visibleMs:0,depth:0,key:'article:1'})
  })
  it('validates note publication and uses project/version rollup identity',async()=>{
    await ingestTelemetry(request({...payload,page:'/project/10000000-0000-4000-8000-000000000002/v/10000000-0000-4000-8000-000000000003/docs/10000000-0000-4000-8000-000000000004'}))
    expect(mocks.page.mock.calls[0]?.[0]).toMatchObject({key:'note:2:3:4',content:{projectKey:'project:2',version:'1.0',title:'Install'}})
    mocks.versions.mockResolvedValue([])
    await expect(ingestTelemetry(request({...payload,page:'/project/10000000-0000-4000-8000-000000000002/v/10000000-0000-4000-8000-000000000003/docs/10000000-0000-4000-8000-000000000004'}))).rejects.toMatchObject({status:404})
  })
})
