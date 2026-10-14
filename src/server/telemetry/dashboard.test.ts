import { describe, expect, it, vi, beforeEach } from 'vitest'
import { NextRequest } from 'next/server'
const mocks=vi.hoisted(()=>({query:vi.fn(),session:vi.fn(),collection:vi.fn(()=>({state:'degraded'})),snapshot:vi.fn(()=>({rssBytes:100})),health:vi.fn()}))
vi.mock('./runtime',()=>({telemetryRuntime:()=>mocks}))
vi.mock('@/server/database/runtime-health',()=>({readRuntimeInstallationPublicStatus:mocks.health}))
vi.mock('@/server/auth/session',()=>({requireAdminSession:mocks.session}))
vi.mock('@/server/http/handler',()=>({defineRoute:<T>(handler:T)=>handler}))
import { readTelemetryDashboard } from './dashboard'
import { GET as analyticsGet } from '@/app/api/admin/mm/analytics/route'
import { GET as samplesGet } from '@/app/api/admin/mm/observability/requests/route'
const context={params:Promise.resolve({})}
describe('authenticated telemetry query boundary',()=>{
  beforeEach(()=>{vi.clearAllMocks();mocks.query.mockResolvedValue({summary:{},collection:{state:'healthy'}});mocks.session.mockResolvedValue({});mocks.health.mockResolvedValue({status:'INSTALLED'})})
  it('requires existing admin session before reading either dashboard',async()=>{
    mocks.session.mockRejectedValue(new Error('Unauthorized'))
    await expect(analyticsGet(new NextRequest('http://localhost/api/admin/mm/analytics'),context)).rejects.toThrow('Unauthorized')
    await expect(samplesGet(new NextRequest('http://localhost/api/admin/mm/observability/requests'),context)).rejects.toThrow('Unauthorized')
    expect(mocks.query).not.toHaveBeenCalled()
  })
  it('validates windows, content keys and page bounds before any worker query',async()=>{
    for(const [operation,url] of [['analytics','?range=year'],['content','?key=arbitrary-secret'],['samples','?pageSize=51'],['samples','?status=9']] as const)await expect(readTelemetryDashboard(new NextRequest('http://localhost/api/test'+url),operation)).rejects.toBeDefined()
    expect(mocks.query).not.toHaveBeenCalled()
  })
  it('composes current process state with cached business health',async()=>{
    const result=await readTelemetryDashboard(new NextRequest('http://localhost/api/test?range=1h'),'observability')
    expect(result).toMatchObject({runtime:{rssBytes:100,databaseStatus:'INSTALLED'}})
  })
  it('returns a sanitized collection error when the isolated store fails',async()=>{
    mocks.query.mockRejectedValue(new Error('private path or secret must never leak'))
    await expect(readTelemetryDashboard(new NextRequest('http://localhost/api/test'),'analytics')).rejects.toMatchObject({status:503,data:{collection:{state:'degraded'}}})
  })
})
