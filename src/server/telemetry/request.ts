/**
 * @file request.ts
 * @project SlothVault
 * @module Request Telemetry Boundary
 * @description Captures route preparation, maintenance-lock wait and handler timing without storing request secrets.
 * @logic Match only committed route templates, exclude telemetry traffic, sample ordinary requests, and append stream terminal state without consuming response bodies.
 * @dependencies node:crypto, telemetry runtime, committed route templates
 * @index_tags telemetry,request,redaction,timing,stream
 * @author holic512
 */
import 'server-only'
import { randomUUID } from 'node:crypto'
import type { RequestSample } from '@/types/telemetry'
import type { NextRequest } from 'next/server'
import { telemetryRuntime } from './runtime'
import { ROUTE_TEMPLATES } from './route-templates'

const patterns = ROUTE_TEMPLATES.map(route=>({route,pattern:new RegExp(`^${route.split('/').map(segment=>segment.startsWith('[...')?'.+':segment.startsWith('[')?'[^/]+':segment.replace(/[.*+?^${}()|[\]\\]/g,'\\$&')).join('/')}$`)}))
export function safeRoute(pathname: string) {return patterns.find(entry=>entry.pattern.test(pathname))?.route ?? '/unknown'}
export function ignoredTelemetryPath(pathname: string) {return /^\/api\/(?:telemetry(?:\/|$)|admin\/mm\/(?:analytics|observability)(?:\/|$))/.test(pathname)}
export function createRequestProbe(request: Pick<NextRequest,'method'|'nextUrl'>) {
  if(ignoredTelemetryPath(request.nextUrl.pathname)) return undefined
  const runtime=telemetryRuntime();if(!runtime) return undefined
  const route=safeRoute(request.nextUrl.pathname), method=['GET','POST','PUT','PATCH','DELETE','HEAD','OPTIONS'].includes(request.method)?request.method:'OTHER'
  const category=route==='/mcp'||/\/backup(?:\/|$)|\/rpc\/test$|\/install\/(?:test-connection|initialize)/.test(route)?'long':'api'
  const started=performance.now(), timestamp=Date.now(), id=randomUUID()
  let waitMs=0,handlerMs=0,finished=false,streamState: 'complete'|'canceled'|'error'|undefined,streamDuration=0
  let lastSample: RequestSample | undefined
  let keptSample = false
  const terminal=()=>{if(streamState==='error'&&lastSample&&!keptSample) { runtime.retainSample({...lastSample,kind:'error',streamState,streamMs:streamDuration}); keptSample=true }
    if(streamState) runtime.stream({id,timestamp,route,method,state:streamState,durationMs:streamDuration})}
  return {
    wait(duration:number){waitMs+=duration},handler(duration:number){handlerMs+=duration},
    finish(status:number,streaming=false){
      if(finished) return;finished=true
      const durationMs=Math.max(0,performance.now()-started),kind=status>=400?'error':durationMs>=(category==='long'?5000:1000)?'slow':'normal'
      const keep=kind!=='normal'||Math.random()<.01
      keptSample=keep
      lastSample={id,timestamp,route,method,category,status,durationMs,waitMs,handlerMs,kind,streamState:streaming?'open':null}
      runtime.record(lastSample,keep)
      terminal()
    },
    stream(state:'complete'|'canceled'|'error'){streamState=state;streamDuration=performance.now()-started;if(finished)terminal()},
  }
}
export type RequestProbe = ReturnType<typeof createRequestProbe>
