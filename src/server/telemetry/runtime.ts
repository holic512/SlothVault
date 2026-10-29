/**
 * @file runtime.ts
 * @project SlothVault
 * @module Telemetry Runtime
 * @description Provides a bounded, hot-reload-safe bridge to the instance telemetry worker.
 * @logic Aggregate requests in memory, prioritize diagnostic samples, batch without awaiting disk, retry idempotent batches after bounded worker restarts, and expose honest collection health.
 * @dependencies node:worker_threads, node:perf_hooks, app-data, telemetry contracts
 * @index_tags telemetry,worker,queue,batching,recovery,availability
 * @author holic512
 */
import 'server-only'
import { randomUUID } from 'node:crypto'
import { monitorEventLoopDelay } from 'node:perf_hooks'
import { resolve, dirname } from 'node:path'
import { mkdir, writeFile, rename } from 'node:fs/promises'
import { Worker } from 'node:worker_threads'
import { appDataPath } from '@/server/config/app-data'
import type { CollectionState, RequestSample, TelemetryMetadata, TrustedPageEvent } from '@/types/telemetry'

const BOUNDS = Array.from({ length: 193 }, (_, i) => Math.round(1.1 ** i * 10) / 10)

type Aggregate = {
  bucket: number
  route: string
  method: string
  category: string
  count: number
  duration: number
  wait: number
  handler: number
  errors4: number
  errors5: number
  slow: number
  streamErrors: number
  histogram: number[]
}

type StreamUpdate = {
  id: string
  timestamp: number
  route: string
  method: string
  state: 'complete' | 'canceled' | 'error'
  durationMs: number
}

type Batch = {
  id: string
  timestamp: number
  requests: Aggregate[]
  samples: RequestSample[]
  pages: TrustedPageEvent[]
  streams: StreamUpdate[]
  lostEvents: boolean
  epoch: string
}

type Pending = {
  resolve: (value: unknown) => void
  reject: (error: Error) => void
  timer: ReturnType<typeof setTimeout>
}

export class TelemetryRuntime {
  private worker?: Worker
  private ready = false
  private attempts = 0
  private restarting = false
  private timer?: ReturnType<typeof setInterval>
  private retryTimer?: ReturnType<typeof setTimeout>
  private pending = new Map<string, Pending>()
  private aggregates = new Map<string, Aggregate>()
  private samples: RequestSample[] = []
  private pages: TrustedPageEvent[] = []
  private streams: StreamUpdate[] = []
  private inFlight?: Batch
  private droppedSamples = 0
  private droppedEvents = 0
  private error: string | null = null
  private metadata: TelemetryMetadata = { epoch: '', startedAt: Date.now(), epochStartedAt: Date.now(), lastPersistedAt: null }
  private readonly loop = monitorEventLoopDelay({ resolution: 20 })
  private stopped = false
  private rotating = false
  private desiredEpoch?: { epoch: string; startedAt: number; sourceGeneration?: string }

  constructor(private file = resolve(appDataPath(), 'telemetry', 'metrics.sqlite')) {
    this.loop.enable()
    this.start()
    this.timer = setInterval(() => {
      this.flush()
      this.loop.reset()
    }, 5000)
    this.timer.unref()
  }

  private start() {
    if (this.stopped) return
    try {
      const worker = new Worker(
        resolve(/* turbopackIgnore: true */ process.cwd(), 'scripts', 'telemetry-worker.mjs'),
        { workerData: { file: this.file } }
      )
      worker.unref()
      this.worker = worker
      worker.on('message', (message: { type: string; id?: string; metadata?: TelemetryMetadata; data?: unknown }) => {
        if (worker !== this.worker) return
        if (message.type === 'ready') {
          this.ready = true
          this.restarting = false
          this.metadata = message.metadata!
          this.error = null
          if (this.desiredEpoch) {
            void this
              .send('rotate', this.desiredEpoch)
              .then(data => {
                this.metadata = data as TelemetryMetadata
                this.desiredEpoch = undefined
                this.rotating = false
                this.flush()
              })
              .catch(() => {
                this.error = 'TELEMETRY_EPOCH_PENDING'
              })
          } else {
            this.flush()
          }
          return
        }
        if (message.type === 'fatal') {
          this.fail(worker)
          return
        }
        const task = message.id ? this.pending.get(message.id) : undefined
        if (!task) return
        clearTimeout(task.timer)
        this.pending.delete(message.id!)
        if (message.type === 'failure') {
          task.reject(new Error('TELEMETRY_OPERATION_FAILED'))
          this.fail(worker)
        } else {
          task.resolve(message.data)
        }
      })
      worker.on('error', () => this.fail(worker))
      worker.on('exit', () => { if (!this.stopped && worker === this.worker) this.fail(worker) })
    } catch { this.fail(this.worker) }
  }

  private fail(worker?: Worker) {
    if (this.stopped || this.restarting || (worker && worker !== this.worker)) return
    this.ready = false
    this.restarting = true
    this.error = 'TELEMETRY_STORAGE_UNAVAILABLE'
    this.worker = undefined
    void worker?.terminate().catch(() => undefined)
    for (const task of this.pending.values()) {
      clearTimeout(task.timer)
      task.reject(new Error(this.error))
    }
    this.pending.clear()
    if (this.attempts < 3) {
      const delay = [1000, 5000, 30000][this.attempts++]
      this.retryTimer = setTimeout(() => {
        this.restarting = false
        this.start()
      }, delay)
      this.retryTimer.unref()
    }
  }

  record(sample: RequestSample, keepSample: boolean) {
    if (this.stopped || this.rotating) {
      this.droppedEvents++
      return
    }
    const bucket = Math.floor(sample.timestamp / 60000) * 60000
    const key = `${bucket}|${sample.route}|${sample.method}`
    let entry = this.aggregates.get(key)
    if (!entry) {
      if (this.aggregates.size >= 2048) {
        this.droppedEvents++
        return
      }
      entry = {
        bucket,
        route: sample.route,
        method: sample.method,
        category: sample.category,
        count: 0,
        duration: 0,
        wait: 0,
        handler: 0,
        errors4: 0,
        errors5: 0,
        slow: 0,
        streamErrors: 0,
        histogram: Array(BOUNDS.length + 1).fill(0),
      }
      this.aggregates.set(key, entry)
    }
    entry.count++
    entry.duration += sample.durationMs
    entry.wait += sample.waitMs
    entry.handler += sample.handlerMs
    entry.errors4 += Number(sample.status >= 400 && sample.status < 500)
    entry.errors5 += Number(sample.status >= 500)
    entry.slow += Number(sample.durationMs >= (sample.category === 'long' ? 5000 : 1000))
    let bin = BOUNDS.findIndex(bound => sample.durationMs <= bound)
    if (bin < 0) bin = BOUNDS.length
    entry.histogram[bin]++
    if (keepSample) this.retainSample(sample)
  }

  retainSample(sample: RequestSample) {
    if (this.samples.length >= 1000) {
      const normal = this.samples.findIndex(item => item.kind === 'normal')
      if (sample.kind !== 'normal' && normal >= 0) {
        this.samples.splice(normal, 1)
      } else {
        this.droppedSamples++
        return
      }
      this.droppedSamples++
    }
    this.samples.push(sample)
  }

  page(event: TrustedPageEvent) {
    if (this.rotating || this.pages.length >= 2000) {
      this.droppedEvents++
      return false
    }
    this.pages.push(event)
    return true
  }

  stream(event: StreamUpdate) {
    if (this.streams.length < 1000 && !this.rotating) {
      this.streams.push(event)
    } else {
      this.droppedSamples++
    }
  }

  private send(type: string, payload: Record<string, unknown>) {
    return new Promise<unknown>((resolveTask, reject) => {
      if (!this.ready || !this.worker || this.pending.size >= 32) {
        reject(new Error('TELEMETRY_UNAVAILABLE'))
        return
      }
      const id = randomUUID()
      const timer = setTimeout(
        () => {
          this.pending.delete(id)
          reject(new Error('TELEMETRY_TIMEOUT'))
          if (type === 'batch') {
            this.fail(this.worker)
          }
        },
        5000
      )
      timer.unref()
      this.pending.set(id, { resolve: resolveTask, reject, timer })
      try {
        this.worker.postMessage({ type, id, ...payload })
      } catch {
        clearTimeout(timer)
        this.pending.delete(id)
        reject(new Error('TELEMETRY_UNAVAILABLE'))
        this.fail(this.worker)
      }
    })
  }

  private flushing = false

  /** 发起非阻塞批量持久化；成功确认前保留同一批次供重试，不向业务调用传播存储错误。 */
  flush() {
    if (!this.ready || this.flushing || this.rotating) return
    if (!this.inFlight) {
      if (!this.aggregates.size && !this.samples.length && !this.pages.length && !this.streams.length &&
        (!this.droppedEvents || this.metadata.incompleteSince)) {
        return
      }
      // 失败时保留整个批次及其 ID，重连后重发，由存储端去重。
      this.inFlight = {
        id: randomUUID(),
        timestamp: Date.now(),
        requests: [...this.aggregates.values()],
        samples: this.samples,
        pages: this.pages,
        streams: this.streams,
        lostEvents: this.droppedEvents > 0,
        epoch: this.metadata.epoch,
      }
      this.aggregates.clear()
      this.samples = []
      this.pages = []
      this.streams = []
    }
    this.flushing = true
    void this
      .send('batch', { batch: this.inFlight })
      .then(data => {
        this.metadata = data as TelemetryMetadata
        this.inFlight = undefined
      })
      .catch(() => {
        this.error = 'TELEMETRY_PERSISTENCE_DELAYED'
      })
      .finally(() => {
        this.flushing = false
      })
  }

  async query<T>(operation: 'analytics' | 'observability' | 'samples', input: Record<string, unknown>): Promise<T> {
    if (this.desiredEpoch) throw new Error('TELEMETRY_EPOCH_PENDING')
    const data = await this.send('query', { operation, input }) as T & { metadata: TelemetryMetadata }
    this.metadata = data.metadata
    const { metadata: ignored, ...rest } = data
    void ignored
    return { ...rest, collection: this.collection() } as T
  }

  collection(): CollectionState {
    const stale = this.metadata.lastPersistedAt !== null && Date.now() - this.metadata.lastPersistedAt > 15000
    const pending = this.aggregates.size + this.pages.length + (this.inFlight ? 1 : 0)
    return {
      ...this.metadata,
      state: this.error
        ? 'degraded'
        : !this.ready
          ? 'starting'
          : this.droppedEvents || this.metadata.incompleteSince
            ? 'degraded'
            : stale && pending
              ? 'delayed'
              : 'healthy',
      droppedSamples: this.droppedSamples,
      droppedEvents: this.droppedEvents,
      pending,
      error: this.error,
      timezone: 'Asia/Shanghai',
    }
  }

  snapshot() {
    const memory = process.memoryUsage()
    const value = this.loop.count ? this.loop.percentile(95) / 1e6 : null
    return {
      uptimeSeconds: process.uptime(),
      rssBytes: memory.rss,
      heapUsedBytes: memory.heapUsed,
      heapTotalBytes: memory.heapTotal,
      eventLoopP95Ms: value,
    }
  }

  /**
   * 对齐已持久化的业务恢复代次，避免进程重启后把恢复后的内容接到旧统计周期。
   * @param sourceGeneration 业务恢复提交回执；与当前值相同时不重复切换统计周期。
   */
  async reconcileSourceGeneration(sourceGeneration: string) {
    if (!this.ready) {
      this.rotating = true
      this.desiredEpoch = { epoch: randomUUID(), startedAt: Date.now(), sourceGeneration }
      return
    }
    if (this.metadata.sourceGeneration !== sourceGeneration) await this.rotate(sourceGeneration)
  }

  /**
   * 等待当前批次结束后切换统计周期，并丢弃尚未发送的旧内容数据。
   * 切换失败时保持阻塞状态，不能让恢复后的实体 id 继承旧内容统计。
   * @param sourceGeneration 可选的业务恢复提交回执，用于重启后识别是否已经完成切换。
   */
  async rotate(sourceGeneration?: string) {
    this.rotating = true
    this.desiredEpoch = { epoch: randomUUID(), startedAt: Date.now(), sourceGeneration }
    try {
      if (this.flushing) {
        await new Promise<void>(resolveWait => {
          const timer = setInterval(() => {
            if (!this.flushing) {
              clearInterval(timer)
              resolveWait()
            }
          }, 20)
        })
      }
      this.aggregates.clear()
      this.samples = []
      this.pages = []
      this.streams = []
      this.inFlight = undefined
      const directory = dirname(this.file)
      const marker = resolve(directory, 'epoch.json')
      const temporary = `${marker}.${randomUUID()}.tmp`
      await mkdir(directory, { recursive: true, mode: 0o700 })
      await writeFile(temporary, JSON.stringify(this.desiredEpoch), { mode: 0o600 })
      await rename(temporary, marker)
      this.metadata = await this.send('rotate', this.desiredEpoch) as TelemetryMetadata
      this.desiredEpoch = undefined
      this.rotating = false
    } catch {
      this.error = 'TELEMETRY_EPOCH_PENDING'
      // Block analytics rather than attach restored IDs to the previous content epoch.
      throw new Error('TELEMETRY_EPOCH_PENDING')
    }
  }

  async stop() {
    this.stopped = true
    clearInterval(this.timer)
    clearTimeout(this.retryTimer)
    this.loop.disable()
    for (const task of this.pending.values()) {
      clearTimeout(task.timer)
      task.reject(new Error('TELEMETRY_STOPPED'))
    }
    this.pending.clear()
    await this.worker?.terminate()
  }
}

const globalRuntime = globalThis as unknown as { slothVaultTelemetry?: TelemetryRuntime }

export function telemetryRuntime(): TelemetryRuntime | undefined {
  if (process.env.NEXT_PHASE === 'phase-production-build' || process.env.VITEST) return undefined
  try { return globalRuntime.slothVaultTelemetry ??= new TelemetryRuntime() } catch { return undefined }
}

/** 恢复业务提交后的尽力切换入口；统计故障不应将已成功提交的业务恢复判为失败。 */
export async function rotateTelemetryEpoch(sourceGeneration?: string) {
  try {
    await telemetryRuntime()?.rotate(sourceGeneration)
  } catch {/* A statistics failure must not invalidate a committed business restore. */ }
}
