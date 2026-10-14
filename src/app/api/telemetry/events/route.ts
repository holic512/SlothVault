/**
 * @file route.ts
 * @project SlothVault
 * @module Public Telemetry API
 * @description Receives bounded, same-origin public viewing observations.
 * @logic Preserve installation gating, enforce ingestion policy and avoid the exclusive business-write lock for independent statistics.
 * @dependencies HTTP helpers, telemetry ingestion
 * @index_tags api,telemetry,reading,privacy
 * @author holic512
 */
import { defineRoute } from '@/server/http/handler'
import { apiOk } from '@/server/http/response'
import { ingestTelemetry } from '@/server/telemetry/events'
export const dynamic = 'force-dynamic'
export const POST = defineRoute(async request => apiOk(await ingestTelemetry(request)), { cacheControl: 'no-store', lockMode: 'shared' })
