/**
 * @file record-store.ts
 * @project SlothVault
 * @module Backup Record Store
 * @description Keeps validated backup rows and restore mappings in a private disk index.
 * @logic Page records from SQLite, expose repeatable lazy collection views, and spill validation indexes and ID mappings to disk.
 * @dependencies better-sqlite3, Node filesystem, backup row schemas
 * @index_tags backup,stream,sqlite,index,validation,restore
 * @author holic512
 */
import 'server-only'
import { randomUUID } from 'node:crypto'
import { chmodSync } from 'node:fs'
import Database from 'better-sqlite3'

type Stored = { sequence: number; json: string }
const contexts = new WeakMap<object, RecordStore>()
const collections = new WeakMap<object, string>()

/**
 * 备份校验与恢复使用的临时磁盘索引，不承担提交回执或断点续传记录的持久化责任。
 * 所有关联的惰性视图和磁盘集合只能在当前实例关闭前使用。
 */
export class RecordStore {
  readonly db: Database.Database
  private statements = new Map<string, Database.Statement>()

  constructor(path: string) {
    this.db = new Database(path)
    chmodSync(path, 0o600)
    // This rebuildable index is never a commit receipt or a resumable-upload record.
    this.db.pragma('journal_mode = OFF')
    this.db.pragma('synchronous = OFF')
    this.db.pragma('cache_size = -8192')
    this.db.pragma('temp_store = FILE')
    this.db.exec(`
      CREATE TABLE IF NOT EXISTS records (sequence INTEGER PRIMARY KEY, collection TEXT NOT NULL, id TEXT NOT NULL, json TEXT NOT NULL, UNIQUE(collection,id));
      CREATE INDEX IF NOT EXISTS records_collection ON records(collection,sequence);
      CREATE TABLE IF NOT EXISTS mappings (scope TEXT NOT NULL, key TEXT NOT NULL, json TEXT NOT NULL, PRIMARY KEY(scope,key));
      CREATE TABLE IF NOT EXISTS sort_runs (scope TEXT NOT NULL, run INTEGER NOT NULL, sequence INTEGER NOT NULL, json TEXT NOT NULL, PRIMARY KEY(scope,run,sequence));
    `)
    // One private rebuildable transaction avoids an fs commit for every indexed record.
    // Durable upload receipts and restore journals use their own fsynced control store.
    this.db.exec('BEGIN')
  }

  statement(sql: string) {
    let value = this.statements.get(sql)
    if (!value) {
      value = this.db.prepare(sql)
      this.statements.set(sql, value)
    }
    return value
  }

  close() {
    this.statements.clear()
    this.db.close()
  }

  put<T extends { id: string }>(collection: string, row: T) {
    this.statement('INSERT INTO records(collection,id,json) VALUES(?,?,?)').run(collection, row.id, JSON.stringify(row))
  }

  get<T>(collection: string, id: string): T | undefined {
    const row = this.statement('SELECT json FROM records WHERE collection=? AND id=?').get(collection, id) as { json: string } | undefined
    return row ? JSON.parse(row.json) as T : undefined
  }

  *iterate<T>(collection: string): Generator<T> {
    let after = 0
    while (true) {
      const batch = this.statement('SELECT sequence,json FROM records WHERE collection=? AND sequence>? ORDER BY sequence LIMIT 100').all(collection, after) as Stored[]
      if (!batch.length) return
      for (const row of batch) {
        after = row.sequence
        yield JSON.parse(row.json) as T
      }
    }
  }

  count(collection: string) {
    return (this.statement('SELECT count(*) AS n FROM records WHERE collection=?').get(collection) as { n: number }).n
  }

  /**
   * 返回可重复遍历的惰性集合，不将整批记录载入内存。
   * @returns 为兼容现有校验器保留数组外观，但仅实现 lazyRows 中列出的只读访问方式。
   */
  rows<T>(collection: string): T[] {
    const rows = lazyRows(this, () => this.iterate<T>(collection), () => this.count(collection))
    collections.set(rows, collection)
    return rows
  }

  where<T>(collection: string, field: string, value: string): T[] {
    if (!/^[a-zA-Z][a-zA-Z0-9]*$/.test(field)) throw new Error('Invalid backup index field')
    this.db.exec(`CREATE INDEX IF NOT EXISTS relation_${field} ON records(collection,json_extract(json,'$.${field}'),sequence)`)
    const statement = this.statement(`SELECT sequence,json FROM records WHERE collection=? AND json_extract(json,'$.${field}')=? AND sequence>? ORDER BY sequence LIMIT 100`)
    return lazyRows(this, function* () {
      let after = 0
      while (true) {
        const batch = statement.all(collection, value, after) as Stored[]
        if (!batch.length) return
        for (const row of batch) {
          after = row.sequence
          yield JSON.parse(row.json) as T
        }
      }
    })
  }

  map<V>(): Map<string, V> {
    return new DiskMap<V>(this, randomUUID())
  }

  set(): Set<string> {
    return new DiskSet(this)
  }

  /**
   * 通过磁盘有序段归并排序，结果仍以惰性视图返回。
   * @param source 可迭代的数据源工厂，记录必须可用 JSON 序列化。
   * @param compare 排序比较器；相等时保留输入顺序，不应依赖调用次数或产生副作用。
   */
  sorted<T>(source: () => Iterable<T>, compare: (a: T, b: T) => number): T[] {
    let scope = randomUUID()
    let runs = 0
    let batch: T[] = []
    const insert = this.statement('INSERT INTO sort_runs VALUES(?,?,?,?)')
    const flush = () => {
      batch.sort(compare)
      batch.forEach((row, i) => insert.run(scope, runs, i, JSON.stringify(row)))
      runs++
      batch = []
    }
    for (const row of source()) {
      batch.push(row)
      if (batch.length === 100) flush()
    }
    if (batch.length) flush()
    const read = this.statement('SELECT json FROM sort_runs WHERE scope=? AND run=? AND sequence=?')
    // 每轮从相邻的两个磁盘有序段各读取一条，避免将完整备份载入内存。
    while (runs > 1) {
      const next = randomUUID()
      for (let run = 0; run < runs; run += 2) {
        let left = 0
        let right = 0
        let sequence = 0
        const get = (side: number, position: number) => {
          const value = read.get(scope, side, position) as { json: string } | undefined
          return value ? { json: value.json, row: JSON.parse(value.json) as T } : undefined
        }
        let a = get(run, left)
        let b = get(run + 1, right)
        while (a || b) {
          if (a && (!b || compare(a.row, b.row) <= 0)) {
            insert.run(next, run / 2, sequence++, a.json)
            a = get(run, ++left)
          } else {
            insert.run(next, run / 2, sequence++, b!.json)
            b = get(run + 1, ++right)
          }
        }
      }
      this.statement('DELETE FROM sort_runs WHERE scope=?').run(scope)
      scope = next
      runs = Math.ceil(runs / 2)
    }
    return lazyRows(
      this,
      function* () {
        let i = 0
        while (true) {
          const row = read.get(scope, 0, i++) as { json: string } | undefined
          if (!row) {
            return
          }
          yield JSON.parse(row.json) as T
        }
      }
    )
  }
}

/**
 * 以数组代理兼容现有校验器，每次访问从数据源重新读取；不保证完整的原生数组语义。
 * @param source 必须能重复产生同一集合，filter/map 链和 length 访问可能触发多次遍历。
 * @param count 可选的快速计数方式；省略时通过完整遍历计算长度。
 */
function lazyRows<T>(store: RecordStore, source: () => Iterable<T>, count?: () => number): T[] {
  const iterator = () => source()[Symbol.iterator]()
  const view = new Proxy([] as T[], {
    get(target, key, receiver) {
      if (key === Symbol.iterator || key === 'values') return iterator
      if (key === 'entries') {
        return function* () {
          let index = 0
          for (const row of source()) yield [index++, row]
        }
      }
      if (key === 'keys') {
        return function* () {
          let index = 0
          for (const row of source()) {
            void row
            yield index++
          }
        }
      }
      if (key === 'length') {
        if (count) return count()
        let n = 0
        for (const _ of source()) {
          void _
          n++
        }
        return n
      }
      if (key === 'filter') {
        return (predicate: (row: T, index: number) => boolean) => lazyRows(store, function* () {
          let i = 0
          for (const row of source()) {
            if (predicate(row, i++)) {
              yield row
            }
          }
        })
      }
      if (key === 'map') {
        return <R>(map: (row: T, index: number) => R) => lazyRows(store, function* () {
          let i = 0
          for (const row of source()) yield map(row, i++)
        })
      }
      if (key === 'find' || key === 'some' || key === 'every') {
        return (predicate: (row: T, index: number) => boolean) => {
          let i = 0
          for (const row of source()) {
            const matched = predicate(row, i++)
            if (key === 'find' && matched) return row
            if (key === 'some' && matched) return true
            if (key === 'every' && !matched) return false
          }
          return key === 'every' ? true : key === 'some' ? false : undefined
        }
      }
      if (key === 'reduce') {
        return <R>(reduce: (value: R, row: T, index: number) => R, initial: R) => {
          let value = initial
          let i = 0
          for (const row of source()) value = reduce(value, row, i++)
          return value
        }
      }
      if (key === 'forEach') {
        return (visit: (row: T, index: number) => void) => {
          let i = 0
          for (const row of source()) visit(row, i++)
        }
      }
      if (key === 'sort') return (compare: (a: T, b: T) => number) => store.sorted(source, compare)
      if (typeof key === 'string' && /^\d+$/.test(key)) {
        let i = 0
        for (const row of source()) {
          if (i++ === Number(key)) {
            return row
          }
        }
        return undefined
      }
      return Reflect.get(target, key, receiver)
    },
  })
  contexts.set(view, store)
  return view
}

class DiskMap<V> extends Map<string, V> {
  constructor(private store: RecordStore, private scope: string) { super() }

  override get size() {
    return (this.store.statement('SELECT count(*) AS n FROM mappings WHERE scope=?').get(this.scope) as { n: number }).n
  }

  override get(key: string): V | undefined {
    const row = this.store.statement('SELECT json FROM mappings WHERE scope=? AND key=?').get(this.scope, key) as { json: string } | undefined
    return row ? JSON.parse(row.json) as V : undefined
  }

  override has(key: string) {
    return Boolean(this.store.statement('SELECT 1 FROM mappings WHERE scope=? AND key=?').get(this.scope, key))
  }

  override set(key: string, value: V): this {
    this.store.statement('INSERT INTO mappings(scope,key,json) VALUES(?,?,?) ON CONFLICT(scope,key) DO UPDATE SET json=excluded.json').run(this.scope, key, JSON.stringify(value))
    return this
  }

  override delete(key: string) {
    return this.store.statement('DELETE FROM mappings WHERE scope=? AND key=?').run(this.scope, key).changes > 0
  }

  override clear() {
    this.store.statement('DELETE FROM mappings WHERE scope=?').run(this.scope)
  }

  override *entries(): MapIterator<[string, V]> {
    let after: string | null = null
    while (true) {
      const rows = (after === null
        ? this.store.statement('SELECT key,json FROM mappings WHERE scope=? ORDER BY key LIMIT 100').all(this.scope)
        : this.store.statement('SELECT key,json FROM mappings WHERE scope=? AND key>? ORDER BY key LIMIT 100').all(this.scope, after)) as { key: string; json: string }[]
      if (!rows.length) return
      for (const row of rows) {
        after = row.key
        yield [row.key, JSON.parse(row.json) as V]
      }
    }
  }

  override *values(): MapIterator<V> {
    for (const [, value] of this.entries()) yield value
  }

  override *keys(): MapIterator<string> {
    for (const [key] of this.entries()) yield key
  }

  override[Symbol.iterator]() {
    return this.entries()
  }

  override forEach(callback: (value: V, key: string, map: Map<string, V>) => void, thisArg?: unknown) {
    for (const [key, value] of this.entries()) callback.call(thisArg, value, key, this)
  }
}

class DiskSet extends Set<string> {
  private index: Map<string, boolean>

  constructor(store: RecordStore) {
    super()
    this.index = store.map()
  }

  override get size() {
    return this.index.size
  }

  override has(key: string) {
    return this.index.has(key)
  }

  override add(key: string): this {
    this.index.set(key, true)
    return this
  }

  override delete(key: string) {
    return this.index.delete(key)
  }

  override clear() {
    this.index.clear()
  }

  override keys() {
    return this.index.keys()
  }

  override values() {
    return this.index.keys()
  }

  override[Symbol.iterator]() {
    return this.values()
  }

  override *entries(): SetIterator<[string, string]> {
    for (const key of this.values()) yield [key, key]
  }

  override forEach(callback: (value: string, key: string, set: Set<string>) => void, thisArg?: unknown) {
    for (const key of this.values()) callback.call(thisArg, key, key, this)
  }
}
/** 只读校验索引直接复用记录主键，避免再次复制整份 JSON。 */
class DiskRecordMap<T extends { id: string }> extends Map<string, T> {
  constructor(private store: RecordStore, private collection: string) { super() }

  override get size() {
    return this.store.count(this.collection)
  }

  override get(key: string) {
    return this.store.get<T>(this.collection, key)
  }

  override has(key: string) {
    return Boolean(this.store.statement('SELECT 1 FROM records WHERE collection=? AND id=?').get(this.collection, key))
  }

  override set(): this {
    throw new Error('Backup record indexes are immutable')
  }

  override delete(): boolean {
    throw new Error('Backup record indexes are immutable')
  }

  override clear(): void {
    throw new Error('Backup record indexes are immutable')
  }

  override *entries(): MapIterator<[string, T]> {
    for (const row of this.store.iterate<T>(this.collection)) yield [row.id, row]
  }

  override *keys(): MapIterator<string> {
    for (const row of this.store.iterate<T>(this.collection)) yield row.id
  }

  override values(): MapIterator<T> {
    return this.store.iterate<T>(this.collection)
  }

  override[Symbol.iterator]() {
    return this.entries()
  }

  override forEach(callback: (value: T, key: string, map: Map<string, T>) => void, thisArg?: unknown) {
    for (const row of this.values()) callback.call(thisArg, row, row.id, this)
  }
}

export function recordStore(rows: object) {
  return contexts.get(rows)
}

export function recordWhere<T>(rows: T[], field: keyof T & string, value: string): T[] {
  const store = contexts.get(rows)
  const collection = collections.get(rows)
  return store && collection ? store.where<T>(collection, field, value) : rows.filter(row => row[field] === value)
}

export function backupMap<V>(rows: object): Map<string, V> {
  return recordStore(rows)?.map<V>() ?? new Map<string, V>()
}

export function backupSet(rows: object): Set<string> {
  return recordStore(rows)?.set() ?? new Set<string>()
}

/**
 * 为记录集合构建按 id 查询的索引。
 * @returns 原始磁盘集合复用只读索引，普通数组构建 Map；返回值只应按只读方式使用。
 */
export function recordIndex<T extends { id: string }>(rows: T[]): Map<string, T> {
  const store = contexts.get(rows)
  const collection = collections.get(rows)
  if (store && collection) return new DiskRecordMap<T>(store, collection)
  const map = backupMap<T>(rows)
  for (const row of rows) {
    if (map.has(row.id)) throw new Error('Duplicate backup ID')
    map.set(row.id, row)
  }
  return map
}
