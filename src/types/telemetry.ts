/**
 * @file telemetry.ts
 * @project SlothVault
 * @module Telemetry Contracts
 * @description Separates analytics, request diagnostics, and collection availability from the legacy dashboard contract.
 * @logic Keep nullable measurements distinct from zero activity and expose privacy-safe samples with explicit coverage and freshness.
 * @dependencies none
 * @index_tags telemetry,types,analytics,observability
 * @author holic512
 */
export type AnalyticsRange = 'today' | '7d' | '30d' | '90d'
export type ObservabilityRange = '15m' | '1h' | '24h' | '7d'
export type ContentKind = 'article' | 'project' | 'note'
export type ContentSort = 'reads' | 'views' | 'duration'
export type TelemetryMetadata = { epoch: string; startedAt: number; epochStartedAt: number; lastPersistedAt: number | null; incompleteSince?: number | null; sourceGeneration?: string | null }
export type CollectionState = TelemetryMetadata & {
  state: 'starting' | 'healthy' | 'delayed' | 'degraded' | 'unavailable'
  droppedSamples: number; droppedEvents: number; pending: number
  error: string | null; timezone: 'Asia/Shanghai'
}
export type MetricWindow = { start: number; end: number; previousStart: number; previousEnd: number; timezone: string }
export type ReadingSummary = { views: number; reads: number; readingViews: number; averageVisibleMs: number | null; averageDepth: number | null; completionRate: number | null }
export type ContentMetric = ReadingSummary & { key: string; kind: ContentKind; title: string; href: string; projectTitle: string | null; version: string | null; previous: ReadingSummary }
export type AnalyticsData = {
  range: MetricWindow; summary: ReadingSummary & { visitors: number }; previous: ReadingSummary & { visitors: number }
  trend: Array<ReadingSummary & { timestamp: number }>; rankings: ContentMetric[]
  content: { key: string; title: string; kind: ContentKind; href: string; projectTitle: string | null; version: string | null } | null
  collection: CollectionState
}
export type RequestSummary = { count: number; averageMs: number | null; p95Ms: number | null; waitMs: number | null; handlerMs: number | null; errors4: number; errors5: number; slow: number; streamErrors: number; errorRate: number | null }
export type RouteMetric = RequestSummary & { route: string; method: string; category: string; baselineMs: number | null; baselineReady: boolean; regressed: boolean; averageLimitMs: number; slowLimitMs: number }
export type RuntimeSnapshot = { uptimeSeconds: number; rssBytes: number; heapUsedBytes: number; heapTotalBytes: number; eventLoopP95Ms: number | null; databaseStatus: string }
export type ObservabilityData = { range: MetricWindow; summary: RequestSummary & { rps: number }; trend: Array<RequestSummary & { timestamp: number }>; routes: RouteMetric[]; runtime: RuntimeSnapshot; collection: CollectionState }
export type RequestSample = { id: string; timestamp: number; route: string; method: string; category: string; status: number; durationMs: number; waitMs: number; handlerMs: number; kind: 'error' | 'slow' | 'normal'; streamState?: 'open' | 'complete' | 'canceled' | 'error' | null; streamMs?: number | null }
export type RequestSamplesData = { items: RequestSample[]; total: number; page: number; pageSize: number; collection: CollectionState }
export type TrustedPageEvent = {
  id: string; timestamp: number; key: string; visitorHash: string | null; visibleMs: number; depth: number
  content?: { key: string; kind: ContentKind; title: string; href: string; projectKey?: string; projectTitle?: string; version?: string }
}
