/**
 * @file telemetry-store.mjs
 * @project SlothVault
 * @module Instance Telemetry Persistence
 * @description Owns bounded, privacy-safe SQLite aggregates and samples outside the business database.
 * @logic Apply idempotent batches, merge full-population histograms, attribute cumulative readings once, retain history by epoch, and query only bounded windows.
 * @dependencies better-sqlite3, node:crypto, node:fs
 * @index_tags telemetry,sqlite,retention,histogram,reading,epoch
 * @author holic512
 */
import Database from 'better-sqlite3'
import { randomUUID } from 'node:crypto'
import { mkdirSync, chmodSync } from 'node:fs'
import { dirname } from 'node:path'

export const STORE_SCHEMA_REVISION = 1
const MINUTE = 60_000
const HOUR = 60 * MINUTE
const DAY = 24 * HOUR
const BOUNDS = Array.from({ length: 193 }, (_, i) => Math.round(1.1 ** i * 10) / 10)
const emptyHist = () => Array(BOUNDS.length + 1).fill(0)
const parseHist = (value) => { try { return JSON.parse(value) } catch { return emptyHist() } }

function mergeHist(a, b) {
  for (let i = 0; i < a.length; i++) a[i] += b[i] || 0
  return a
}

function percentile(hist) {
  const target = Math.ceil(hist.reduce((a, b) => a + b, 0) * .95)
  if (!target) return null
  let count = 0
  for (let i = 0; i < hist.length; i++) {
    count += hist[i]
    if (count >= target) return BOUNDS[i] ?? BOUNDS.at(-1)
  }
  return null
}

function dayKey(ts) {
  return new Date(ts + 8 * HOUR).toISOString().slice(0, 10)
}

function dayStart(ts) {
  return Math.floor((ts + 8 * HOUR) / DAY) * DAY - 8 * HOUR
}

function rangeWindow(range, now) {
  const duration = { '15m': 15 * MINUTE, '1h': HOUR, '24h': DAY, '7d': 7 * DAY, '30d': 30 * DAY, '90d': 90 * DAY }[range]
  const start = range === 'today' ? dayStart(now) : now - duration
  return {
    start,
    end: now,
    previousStart: start - (now - start),
    previousEnd: start,
    timezone: 'Asia/Shanghai',
  }
}

const requestFields = 'SUM(count) count, SUM(duration) duration, SUM(wait) wait, SUM(handler) handler, SUM(errors4) errors4, SUM(errors5) errors5, SUM(slow) slow, SUM(streamErrors) streamErrors, merge_hist(histogram) histogram'

function requestDto(row) {
  const count = row?.count || 0
  return {
    count,
    averageMs: count ? row.duration / count : null,
    waitMs: count ? row.wait / count : null,
    handlerMs: count ? row.handler / count : null,
    p95Ms: percentile(parseHist(row?.histogram)),
    errors4: row?.errors4 || 0,
    errors5: row?.errors5 || 0,
    slow: row?.slow || 0,
    streamErrors: row?.streamErrors || 0,
    errorRate: count ? (row.errors5 || 0) / count * 100 : null,
  }
}

const pageFields = 'SUM(views) views, SUM(reads) reads, SUM(visibleMs) visibleMs, SUM(readingViews) readingViews, SUM(depth) depth, SUM(completions) completions'

function pageDto(row) {
  return {
    views: row?.views || 0,
    reads: row?.reads || 0,
    averageVisibleMs: row?.readingViews ? row.visibleMs / row.readingViews : null,
    averageDepth: row?.readingViews ? row.depth / row.readingViews : null,
    completionRate: row?.readingViews ? row.completions / row.readingViews * 100 : null,
    readingViews: row?.readingViews || 0,
  }
}

class TelemetryStore {
  constructor(file, now = Date.now()) {
    if (file !== ':memory:') {
      mkdirSync(dirname(file), { recursive: true, mode: 0o700 })
      chmodSync(dirname(file), 0o700)
    }
    this.db = new Database(file, { timeout: 100 })
    if (file !== ':memory:') chmodSync(file, 0o600)
    this.db.pragma('journal_mode = WAL')
    this.db.pragma('synchronous = NORMAL')
    const revision = this.db.pragma('user_version', { simple: true })
    if (revision > STORE_SCHEMA_REVISION) {
      this.db.close()
      throw new Error('Unsupported telemetry schema')
    }
    this.db.exec(`
      CREATE TABLE IF NOT EXISTS meta (key TEXT PRIMARY KEY, value TEXT NOT NULL);
      CREATE TABLE IF NOT EXISTS batches (id TEXT PRIMARY KEY, timestamp INTEGER NOT NULL);
      CREATE TABLE IF NOT EXISTS request_bucket (
        epoch TEXT NOT NULL, resolution TEXT NOT NULL, bucket INTEGER NOT NULL, route TEXT NOT NULL, method TEXT NOT NULL, category TEXT NOT NULL,
        count INTEGER NOT NULL, duration REAL NOT NULL, wait REAL NOT NULL, handler REAL NOT NULL, errors4 INTEGER NOT NULL, errors5 INTEGER NOT NULL,
        slow INTEGER NOT NULL, streamErrors INTEGER NOT NULL, histogram TEXT NOT NULL,
        PRIMARY KEY(epoch,resolution,bucket,route,method));
      CREATE TABLE IF NOT EXISTS request_sample (
        id TEXT PRIMARY KEY, epoch TEXT NOT NULL, timestamp INTEGER NOT NULL, route TEXT NOT NULL, method TEXT NOT NULL, category TEXT NOT NULL,
        status INTEGER NOT NULL, durationMs REAL NOT NULL, waitMs REAL NOT NULL, handlerMs REAL NOT NULL, kind TEXT NOT NULL,
        streamState TEXT, streamMs REAL);
      CREATE INDEX IF NOT EXISTS sample_epoch_time ON request_sample(epoch,timestamp);
      CREATE INDEX IF NOT EXISTS sample_priority ON request_sample(kind,timestamp);
      CREATE TABLE IF NOT EXISTS content (epoch TEXT NOT NULL, key TEXT NOT NULL, kind TEXT NOT NULL, title TEXT NOT NULL, href TEXT NOT NULL, projectKey TEXT, projectTitle TEXT, version TEXT, PRIMARY KEY(epoch,key));
      CREATE TABLE IF NOT EXISTS page_hour (
        epoch TEXT NOT NULL, bucket INTEGER NOT NULL, key TEXT NOT NULL, views INTEGER NOT NULL, reads INTEGER NOT NULL,
        visibleMs REAL NOT NULL, readingViews INTEGER NOT NULL, depth REAL NOT NULL, completions INTEGER NOT NULL, PRIMARY KEY(epoch,bucket,key));
      CREATE TABLE IF NOT EXISTS view_state (id TEXT PRIMARY KEY, epoch TEXT NOT NULL, timestamp INTEGER NOT NULL, key TEXT NOT NULL, visibleMs REAL NOT NULL, depth REAL NOT NULL, effective INTEGER NOT NULL, reading INTEGER NOT NULL, completed INTEGER NOT NULL);
      CREATE INDEX IF NOT EXISTS view_expiry ON view_state(timestamp);
      CREATE TABLE IF NOT EXISTS visitor_day (epoch TEXT NOT NULL, day TEXT NOT NULL, scope TEXT NOT NULL, hash TEXT NOT NULL, timestamp INTEGER NOT NULL, PRIMARY KEY(epoch,day,scope,hash));
      CREATE INDEX IF NOT EXISTS visitor_expiry ON visitor_day(timestamp);
      PRAGMA user_version = 1;
    `)
    this.db.aggregate(
      'merge_hist',
      {
        start: emptyHist,
        step: (state, value) => mergeHist(state, parseHist(value)),
        result: state => JSON.stringify(state),
      }
    )
    this.epoch = this.getMeta('epoch') || randomUUID()
    if (!this.getMeta('epoch')) {
      this.setMeta('epoch', this.epoch)
      this.setMeta('epochStartedAt', String(now))
      this.setMeta('startedAt', String(now))
    }
    this.lastCleanup = 0
    this.db.function('add_hist', (a, b) => JSON.stringify(mergeHist(parseHist(a), parseHist(b))))
    this.requestUpsert = this.db.prepare(`INSERT INTO request_bucket VALUES (@epoch,@resolution,@bucket,@route,@method,@category,@count,@duration,@wait,@handler,@errors4,@errors5,@slow,@streamErrors,@histogram)
      ON CONFLICT(epoch,resolution,bucket,route,method) DO UPDATE SET count=count+excluded.count,duration=duration+excluded.duration,wait=wait+excluded.wait,handler=handler+excluded.handler,errors4=errors4+excluded.errors4,errors5=errors5+excluded.errors5,slow=slow+excluded.slow,streamErrors=streamErrors+excluded.streamErrors,histogram=add_hist(histogram,excluded.histogram)`)
    this.pageUpsert = this.db.prepare(`INSERT INTO page_hour VALUES (@epoch,@bucket,@key,@views,@reads,@visibleMs,@readingViews,@depth,@completions)
      ON CONFLICT(epoch,bucket,key) DO UPDATE SET views=views+excluded.views,reads=reads+excluded.reads,visibleMs=visibleMs+excluded.visibleMs,readingViews=readingViews+excluded.readingViews,depth=depth+excluded.depth,completions=completions+excluded.completions`)
  }

  getMeta(key) {
    return this.db.prepare('SELECT value FROM meta WHERE key=?').get(key)?.value
  }

  setMeta(key, value) {
    this.db.prepare('INSERT INTO meta VALUES (?,?) ON CONFLICT(key) DO UPDATE SET value=excluded.value').run(key, String(value))
  }

  metadata() {
    return {
      epoch: this.epoch,
      startedAt: Number(this.getMeta('startedAt')),
      epochStartedAt: Number(this.getMeta('epochStartedAt')),
      lastPersistedAt: Number(this.getMeta('lastPersistedAt')) || null,
      incompleteSince: Number(this.getMeta('incompleteSince')) || null,
      sourceGeneration: this.getMeta('sourceGeneration') || null,
    }
  }

  rotate(now = Date.now(), epoch = randomUUID(), sourceGeneration) {
    this.db.transaction(() => {
      this.epoch = epoch
      this.setMeta('epoch', epoch)
      this.setMeta('epochStartedAt', now)
      if (sourceGeneration !== undefined) this.setMeta('sourceGeneration', sourceGeneration)
    })()
    return this.metadata()
  }

  apply(batch) {
    this.db.transaction(() => {
      if (!this.db.prepare('INSERT OR IGNORE INTO batches VALUES (?,?)').run(batch.id, batch.timestamp).changes) return
      if (batch.lostEvents && !this.getMeta('incompleteSince')) this.setMeta('incompleteSince', batch.timestamp)
      for (const row of batch.requests || []) {
        for (const resolution of ['minute', 'hour']) {
          this.requestUpsert.run({
            ...row,
            epoch: this.epoch,
            resolution,
            bucket: Math.floor(row.bucket / (resolution === 'minute' ? MINUTE : HOUR)) * (resolution === 'minute' ? MINUTE : HOUR),
            histogram: JSON.stringify(row.histogram),
          })
        }
      }
      for (const sample of batch.samples || []) {
        this.db.prepare(`INSERT OR IGNORE INTO request_sample VALUES (@id,@epoch,@timestamp,@route,@method,@category,@status,@durationMs,@waitMs,@handlerMs,@kind,@streamState,@streamMs)`).run({
          ...sample,
          epoch: this.epoch,
          streamState: sample.streamState ?? null,
          streamMs: sample.streamMs ?? null,
        })
      }
      for (const event of batch.pages || []) this.reading(event)
      for (const stream of batch.streams || []) {
        this.db.prepare("UPDATE request_sample SET streamState=?, streamMs=?, kind=CASE WHEN ?='error' THEN 'error' ELSE kind END WHERE id=?").run(stream.state, stream.durationMs, stream.state, stream.id)
        if (stream.state === 'error') {
          this.db.prepare("UPDATE request_bucket SET streamErrors=streamErrors+1 WHERE epoch=? AND route=? AND method=? AND ((resolution='minute' AND bucket=?) OR (resolution='hour' AND bucket=?))").run(
            this.epoch,
            stream.route,
            stream.method,
            Math.floor(stream.timestamp / MINUTE) * MINUTE,
            Math.floor(stream.timestamp / HOUR) * HOUR
          )
        }
      }
      this.setMeta('lastPersistedAt', batch.timestamp)
    })()
    if (batch.samples?.length && this.db.prepare('SELECT COUNT(*) n FROM request_sample').get().n > 100000) {
      this.capSamples()
    }
    if (batch.timestamp - this.lastCleanup >= HOUR) {
      this.cleanup(batch.timestamp)
      this.lastCleanup = batch.timestamp
    }
    return this.metadata()
  }

  reading(event) {
    const old = this.db.prepare('SELECT * FROM view_state WHERE id=?').get(event.id)
    if (old && (old.epoch !== this.epoch || old.key !== event.key)) return
    const timestamp = old?.timestamp ?? event.timestamp
    // Server elapsed-time bound prevents a first beacon from inventing hours of reading.
    const visibleMs = Math.max(old?.visibleMs || 0, Math.min(event.visibleMs, Math.max(0, event.timestamp - timestamp), 30 * MINUTE))
    const depth = Math.max(old?.depth || 0, event.depth)
    const reading = Number(visibleMs > 0)
    const effective = Number(visibleMs >= 10_000 && depth >= 25)
    const completed = Number(depth >= 90 && reading)
    this.db.prepare('INSERT INTO view_state VALUES (?,?,?,?,?,?,?,?,?) ON CONFLICT(id) DO UPDATE SET visibleMs=excluded.visibleMs,depth=excluded.depth,effective=excluded.effective,reading=excluded.reading,completed=excluded.completed').run(
      event.id,
      this.epoch,
      timestamp,
      event.key,
      visibleMs,
      depth,
      effective,
      reading,
      completed
    )
    const delta = {
      epoch: this.epoch,
      bucket: Math.floor(timestamp / HOUR) * HOUR,
      key: event.key,
      views: Number(!old),
      reads: effective - (old?.effective || 0),
      visibleMs: visibleMs - (old?.visibleMs || 0),
      readingViews: reading - (old?.reading || 0),
      depth: (reading ? depth : 0) - (old?.reading ? old.depth : 0),
      completions: completed - (old?.completed || 0),
    }
    this.pageUpsert.run(delta)
    if (event.content) {
      const content = event.content
      this.db.prepare('INSERT INTO content VALUES (@epoch,@key,@kind,@title,@href,@projectKey,@projectTitle,@version) ON CONFLICT(epoch,key) DO UPDATE SET title=excluded.title,href=excluded.href,projectTitle=excluded.projectTitle').run({
        ...content,
        epoch: this.epoch,
        projectKey: content.projectKey ?? null,
        projectTitle: content.projectTitle ?? null,
        version: content.version ?? null,
      })
      if (content.projectKey && content.projectKey !== content.key) {
        this.pageUpsert.run({ ...delta, key: content.projectKey })
        this.db.prepare('INSERT INTO content VALUES (?,?,?,?,?,?,?,?) ON CONFLICT(epoch,key) DO UPDATE SET title=excluded.title').run(
          this.epoch,
          content.projectKey,
          'project',
          content.projectTitle,
          `/project/${content.projectKey.split(':')[1]}/home`,
          null,
          null,
          null
        )
      }
    }
    // Global totals are maintained separately; project rollups must never double count them.
    this.pageUpsert.run({ ...delta, key: '__all__' })
    if (event.visitorHash) {
      this.db.prepare('INSERT OR IGNORE INTO visitor_day VALUES (?,?,?,?,?)').run(
        this.epoch,
        dayKey(event.timestamp),
        'site',
        event.visitorHash,
        event.timestamp
      )
    }
  }

  capSamples() {
    this.db.exec("DELETE FROM request_sample WHERE id IN (SELECT id FROM request_sample ORDER BY CASE kind WHEN 'normal' THEN 0 ELSE 1 END, timestamp ASC LIMIT MAX(0,(SELECT COUNT(*) FROM request_sample)-100000))")
  }

  cleanup(now) {
    this.db.transaction(() => {
      if (Number(this.getMeta('incompleteSince')) < now - 90 * DAY) {
        this.db.prepare("DELETE FROM meta WHERE key='incompleteSince'").run()
      }
      this.db.prepare("DELETE FROM request_bucket WHERE (resolution='minute' AND bucket<?) OR bucket<?").run(now - 7 * DAY, now - 90 * DAY)
      for (const table of ['request_sample', 'view_state', 'batches']) this.db.prepare(`DELETE FROM ${table} WHERE timestamp<?`).run(now - 7 * DAY)
      this.db.prepare('DELETE FROM page_hour WHERE bucket<?').run(now - 90 * DAY)
      this.db.prepare('DELETE FROM visitor_day WHERE timestamp<?').run(now - 90 * DAY)
      this.capSamples()
      this.db.exec('DELETE FROM content WHERE NOT EXISTS (SELECT 1 FROM page_hour WHERE page_hour.epoch=content.epoch AND page_hour.key=content.key)')
    })()
  }

  analytics(range = '7d', now = Date.now(), key = '__all__', kind = 'article', sort = 'reads') {
    const window = rangeWindow(range, now)
    const start = Math.floor(window.start / HOUR) * HOUR
    window.previousEnd = start
    const aggregate = (from, to) => pageDto(this.db.prepare(`SELECT ${pageFields} FROM page_hour WHERE epoch=? AND key=? AND bucket>=? AND bucket<?`).get(this.epoch, key, from, to))
    const summary = aggregate(start, now)
    const previous = aggregate(Math.floor(window.previousStart / HOUR) * HOUR, window.previousEnd)
    const visitorRows = this.db.prepare("SELECT day,COUNT(*) count FROM visitor_day WHERE epoch=? AND scope='site' AND timestamp>=? AND timestamp<? GROUP BY day").all(this.epoch, window.start, now)
    const coveredStart = Math.max(window.start, Number(this.getMeta('epochStartedAt')))
    const days = Math.max(1, Math.ceil((now - dayStart(coveredStart)) / DAY))
    const visitors = visitorRows.reduce((sum, row) => sum + row.count, 0)
    const previousVisitors = this.db.prepare("SELECT COUNT(*) count FROM visitor_day WHERE epoch=? AND scope='site' AND timestamp>=? AND timestamp<?").get(this.epoch, window.previousStart, window.previousEnd).count
    const trend = this.db
      .prepare(`SELECT bucket,${pageFields} FROM page_hour WHERE epoch=? AND key=? AND bucket>=? AND bucket<? GROUP BY bucket ORDER BY bucket`)
      .all(this.epoch, key, start, now)
      .map(row => ({ timestamp: row.bucket, ...pageDto(row) }))
    const order = {
      reads: 'reads',
      views: 'views',
      duration: 'CASE WHEN readingViews>0 THEN visibleMs/readingViews ELSE 0 END',
    }[sort] ||
      'reads'
    const rankings = this.db
      .prepare(`SELECT c.*,${pageFields} FROM page_hour p JOIN content c ON c.epoch=p.epoch AND c.key=p.key WHERE p.epoch=? AND c.kind=? AND p.bucket>=? AND p.bucket<? GROUP BY p.key ORDER BY ${order} DESC, views DESC LIMIT 50`)
      .all(this.epoch, kind, start, now)
      .map(row => ({
        ...pageDto(row),
        key: row.key,
        kind: row.kind,
        title: row.title,
        href: row.href,
        projectTitle: row.projectTitle,
        version: row.version,
      }))
    // Previous rankings must be looked up by their own content key, not the site total.
    for (const row of rankings) {
      row.previous = pageDto(this.db.prepare(`SELECT ${pageFields} FROM page_hour WHERE epoch=? AND key=? AND bucket>=? AND bucket<?`).get(
        this.epoch,
        row.key,
        Math.floor(window.previousStart / HOUR) * HOUR,
        window.previousEnd
      ))
    }
    const content = key === '__all__' ? null : this.db.prepare('SELECT * FROM content WHERE epoch=? AND key=?').get(this.epoch, key) || null
    return {
      range: window,
      summary: { ...summary, visitors: range === 'today' ? visitors : visitors / days },
      previous: { ...previous, visitors: range === 'today' ? previousVisitors : previousVisitors / days },
      trend,
      rankings,
      content,
      metadata: this.metadata(),
    }
  }

  observability(range = '1h', now = Date.now()) {
    const window = rangeWindow(range, now)
    const resolution = range === '7d' ? 'hour' : 'minute'
    const unit = resolution === 'hour' ? HOUR : MINUTE
    const start = Math.floor(window.start / unit) * unit
    const args = [this.epoch, resolution, start, now]
    const summary = requestDto(this.db.prepare(`SELECT ${requestFields} FROM request_bucket WHERE epoch=? AND resolution=? AND bucket>=? AND bucket<?`).get(...args))
    const trendUnit = range === '7d' ? HOUR : range === '24h' ? 15 * MINUTE : MINUTE
    const trend = this.db
      .prepare(`SELECT CAST(bucket/? AS INTEGER)*? timestamp,${requestFields} FROM request_bucket WHERE epoch=? AND resolution=? AND bucket>=? AND bucket<? GROUP BY timestamp ORDER BY timestamp`)
      .all(trendUnit, trendUnit, ...args)
      .map(row => ({ timestamp: row.timestamp, ...requestDto(row) }))
    const historyEnd = dayStart(now)
    const historyStart = historyEnd - 7 * DAY
    const history = this.db.prepare(`SELECT route,method,${requestFields} FROM request_bucket WHERE epoch=? AND resolution='hour' AND bucket>=? AND bucket<? GROUP BY route,method`).all(this.epoch, historyStart, historyEnd)
    const routes = this.db
      .prepare(`SELECT route,method,category,${requestFields} FROM request_bucket WHERE epoch=? AND resolution=? AND bucket>=? AND bucket<? GROUP BY route,method ORDER BY slow DESC,count DESC LIMIT 200`)
      .all(...args)
      .map(row => {
        const current = requestDto(row)
        const past = requestDto(history.find(item => item.route === row.route && item.method === row.method))
        const long = row.category === 'long'
        const baselineReady = current.count >= 20 && past.count >= 100
        return {
          route: row.route,
          method: row.method,
          category: row.category,
          ...current,
          baselineMs: past.averageMs,
          baselineReady,
          regressed: baselineReady && current.averageMs >= past.averageMs * 1.5 &&
            current.averageMs - past.averageMs >= 100,
          averageLimitMs: long ? 3000 : 500,
          slowLimitMs: long ? 5000 : 1000,
        }
      })
    return {
      range: window,
      summary: { ...summary, rps: summary.count / ((now - window.start) / 1000) },
      trend,
      routes,
      metadata: this.metadata(),
    }
  }

  samples(input, now = Date.now()) {
    const window = rangeWindow(input.range || '1h', now)
    const conditions = ['epoch=?', 'timestamp>=?', 'timestamp<?']
    const args = [this.epoch, window.start, now]
    for (const field of ['route', 'method', 'kind']) {
      if (input[field]) {
        conditions.push(`${field}=?`)
        args.push(input[field])
      }
    }
    if (input.status) {
      conditions.push('status>=? AND status<?')
      args.push(input.status * 100, (input.status + 1) * 100)
    }
    const where = conditions.join(' AND ')
    const total = this.db.prepare(`SELECT COUNT(*) count FROM request_sample WHERE ${where}`).get(...args).count
    const page = input.page || 1
    const pageSize = Math.min(input.pageSize || 20, 50)
    const items = this.db
      .prepare(`SELECT * FROM request_sample WHERE ${where} ORDER BY timestamp DESC LIMIT ? OFFSET ?`)
      .all(...args, pageSize, (page - 1) * pageSize)
      .map(({ epoch, ...row }) => {
        void epoch
        return row
      })
    return { items, total, page, pageSize, metadata: this.metadata() }
  }

  close() {
    this.db.close()
  }
}

export { TelemetryStore, BOUNDS, emptyHist, mergeHist, percentile, rangeWindow, dayKey, dayStart }
