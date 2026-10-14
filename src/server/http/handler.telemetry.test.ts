import { describe, expect, it, vi, beforeEach } from 'vitest'
import { NextRequest } from 'next/server'
import { HttpError } from './errors'
const mocks=vi.hoisted(()=>({probe:{wait:vi.fn(),handler:vi.fn(),finish:vi.fn(),stream:vi.fn()},health:vi.fn(),acquire:vi.fn(),release:vi.fn()}))
vi.mock('@/server/telemetry/request',()=>({createRequestProbe:()=>mocks.probe}))
vi.mock('@/server/database/runtime-health',()=>({readRuntimeInstallationPublicStatus:mocks.health,isDatabaseConnectivityError:()=>false,markInstalledDatabaseUnavailable:vi.fn()}))
vi.mock('@/server/services/maintenance-lock',()=>({acquireMaintenanceLock:mocks.acquire}))
import { defineRoute } from './handler'
const context={params:Promise.resolve({})}
const request=()=>new NextRequest('http://localhost/api/test')
describe('measured shared route boundary compatibility',()=>{
  beforeEach(()=>{vi.clearAllMocks();mocks.health.mockResolvedValue({status:'INSTALLED'});mocks.acquire.mockResolvedValue(mocks.release)})
  it('retains normal response identity and captures wait and handler boundaries',async()=>{
    const response=new Response('ok',{headers:{'x-original':'kept'}})
    expect(await defineRoute(async()=>response)(request(),context)).toBe(response)
    expect(mocks.release).toHaveBeenCalledOnce();expect(mocks.probe.finish).toHaveBeenCalledWith(200,false)
    expect(mocks.probe.wait).toHaveBeenCalledOnce();expect(mocks.probe.handler).toHaveBeenCalledOnce()
  })
  it('records maintenance failures without touching locks or handlers',async()=>{
    mocks.health.mockResolvedValue({status:'MAINTENANCE'})
    const handler=vi.fn();const result=await defineRoute(handler)(request(),context)
    expect(result.status).toBe(503);expect(mocks.probe.finish).toHaveBeenCalledWith(503,false);expect(handler).not.toHaveBeenCalled();expect(mocks.acquire).not.toHaveBeenCalled()
  })
  it('mapped permission failure is not incorrectly marked as an open stream',async()=>{
    const result=await defineRoute(async()=>{throw new HttpError('Forbidden',403,403)},{holdLockUntilBodyClosed:true})(request(),context)
    expect(result.status).toBe(403);expect(mocks.probe.finish).toHaveBeenCalledWith(403,false);expect(mocks.release).toHaveBeenCalledOnce()
  })
  it.each(['complete','canceled','error'] as const)('holds and releases streaming lock exactly once on %s',async(state)=>{
    const body=new ReadableStream<Uint8Array>({pull(controller){if(state==='error')controller.error(new Error('Stream failure'));else if(state==='complete'){controller.enqueue(new TextEncoder().encode('ok'));controller.close()}},cancel(){}})
    const result=await defineRoute(async()=>new Response(body),{holdLockUntilBodyClosed:true})(request(),context)
    expect(mocks.probe.finish).toHaveBeenCalledWith(200,true)
    if(state==='canceled')await result.body!.cancel('test')
    else if(state==='error')await expect(result.text()).rejects.toThrow('Stream failure')
    else expect(await result.text()).toBe('ok')
    expect(mocks.release).toHaveBeenCalledOnce();expect(mocks.probe.stream).toHaveBeenCalledWith(state)
  })
})
