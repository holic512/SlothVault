/**
 * @file dashboard.ts
 * @project SlothVault
 * @module Telemetry Dashboard Boundary
 * @description Validates bounded dashboard filters and composes isolated statistics with current runtime status.
 * @logic Reject invalid ranges and filters before worker queries, expose sanitized collection failures, and reuse the cached business-database health state.
 * @dependencies zod, telemetry runtime, database/runtime-health
 * @index_tags telemetry,analytics,observability,validation,health
 * @author holic512
 */
import 'server-only'
import { z } from 'zod'
import type { NextRequest } from 'next/server'
import { HttpError } from '@/server/http/errors'
import { readRuntimeInstallationPublicStatus } from '@/server/database/runtime-health'
import { telemetryRuntime } from './runtime'
import type { AnalyticsData, ObservabilityData, RequestSamplesData } from '@/types/telemetry'

const analytics=z.object({range:z.enum(['today','7d','30d','90d']).default('7d'),kind:z.enum(['article','project','note']).default('article'),sort:z.enum(['reads','views','duration']).default('reads'),key:z.string().regex(/^(article:[1-9]\d*|project:[1-9]\d*|note:[1-9]\d*:[1-9]\d*:[1-9]\d*)$/).max(90).optional()})
const samples=z.object({range:z.enum(['15m','1h','24h','7d']).default('1h'),route:z.string().max(200).optional(),method:z.enum(['GET','POST','PUT','PATCH','DELETE','HEAD','OPTIONS','OTHER']).optional(),kind:z.enum(['error','slow','normal']).optional(),status:z.coerce.number().int().min(2).max(5).optional(),page:z.coerce.number().int().min(1).max(10000).default(1),pageSize:z.coerce.number().int().min(1).max(50).default(20)})
const observability=z.object({range:z.enum(['15m','1h','24h','7d']).default('1h')})
export async function readTelemetryDashboard(request:NextRequest,operation:'analytics'|'content'|'observability'|'samples') {
  const values=Object.fromEntries(request.nextUrl.searchParams),runtime=telemetryRuntime()
  const input=operation==='analytics'||operation==='content'?analytics.parse(values):operation==='samples'?samples.parse(values):observability.parse(values)
  if(operation==='content'&&!('key' in input&&input.key)) throw new HttpError('Missing content key',400,400)
  if(!runtime) throw new HttpError('Telemetry is unavailable',503,503,{collection:{state:'unavailable',error:'TELEMETRY_UNAVAILABLE'}})
  try {
    if(operation==='analytics'||operation==='content')return await runtime.query<AnalyticsData>('analytics',input)
    if(operation==='samples')return await runtime.query<RequestSamplesData>('samples',input)
    const [data,health]=await Promise.all([runtime.query<ObservabilityData>('observability',input),readRuntimeInstallationPublicStatus()])
    return {...data,runtime:{...runtime.snapshot(),databaseStatus:health.status}}
  }catch {throw new HttpError('Telemetry is temporarily unavailable',503,503,{collection:runtime.collection()})}
}
