import { describe, expect, it } from 'vitest'
import { advanceReading, privacyDeclined, publicTelemetryTarget, readerDepth, visitorDay } from './telemetry-reading'
describe('privacy-safe public reading policy',()=>{
  it('only accepts canonical public routes without credentials or queries',()=>{
    expect(publicTelemetryTarget('/project/10000000-0000-4000-8000-000000000002/v/10000000-0000-4000-8000-000000000003/docs/10000000-0000-4000-8000-000000000004')).toMatchObject({type:'note',id:'10000000-0000-4000-8000-000000000004',projectId:'10000000-0000-4000-8000-000000000002',versionId:'10000000-0000-4000-8000-000000000003'})
    for(const path of ['/admin/mm','/account','/login','/install','/maintenance','/commission-invitations/secret','/articles/1?token=secret','/articles/999999999999','/unknown'])expect(publicTelemetryTarget(path)).toBeNull()
  })
  it('short visible bodies reach full depth, offscreen readers do not',()=>{
    expect(readerDepth(100,100,800)).toEqual({visible:true,depth:100})
    expect(readerDepth(900,100,800)).toEqual({visible:false,depth:0})
    expect(readerDepth(-100,100,800)).toEqual({visible:false,depth:0})
  })
  it('never accrues hidden/offscreen time or lower depth and bounds stalled timer ticks',()=>{
    expect(advanceReading({visibleMs:1000,depth:50},10000,false,90)).toEqual({visibleMs:1000,depth:50})
    expect(advanceReading({visibleMs:1000,depth:50},10000,true,20)).toEqual({visibleMs:3000,depth:50})
  })
  it('respects privacy refusal and rotates days at Shanghai midnight',()=>{
    expect(privacyDeclined({globalPrivacyControl:true})).toBe(true)
    expect(privacyDeclined({doNotTrack:'1'})).toBe(true)
    expect(visitorDay(new Date('2026-10-14T15:59:00Z'))).toBe('2026-10-14')
    expect(visitorDay(new Date('2026-10-14T16:00:00Z'))).toBe('2026-10-15')
  })
})
