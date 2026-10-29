/**
 * @file database.ts
 * @project SlothVault
 * @module Plugin Database Bridge
 * @description Owns namespaced portable tables and reuses Prisma transactions for dynamic SQL and core mutations.
 * @logic Keep transaction handles bound to one invocation, compile schema operations through Kysely, safely inspect declared columns for migrations, and retain independent table descriptors.
 * @dependencies Kysely SDK, Prisma Unit of Work, plugin protocol
 * @index_tags plugins,database,kysely,transactions,ownership
 * @author holic512
 */
import 'server-only'
import { createHash, randomUUID } from 'node:crypto'
import type { Prisma } from '@generated/prisma-postgresql/client'
import { createPluginContext } from '@slothvault/plugin-sdk/server'
import { CORE_TABLES, type PluginManifest, type PluginTable } from '@slothvault/plugin-sdk/protocol'
import { configuredDatabaseProvider } from '@/server/database/client'
import { unitOfWork } from '@/server/database/unit-of-work'
import { prisma } from '@/server/prisma'
import { HttpError } from '@/server/http/errors'

export type PluginTransaction = Prisma.TransactionClient
export { CORE_TABLES } from '@slothvault/plugin-sdk/protocol'

export function physicalTableName(pluginId: string, table: PluginTable) {
  return `svp_${createHash('sha256').update(pluginId).digest('hex').slice(0, 12)}_${table.name}`
}

export function pluginTableMap(manifest: PluginManifest) {
  return Object.fromEntries(manifest.tables.map(t => [t.name, physicalTableName(manifest.id, t)]))
}

export function quoteIdentifier(name: string) {
  if (!/^[a-z][a-z0-9_]{0,62}$/.test(name)) throw new HttpError('Invalid SQL identifier', 400)
  return configuredDatabaseProvider() === 'mysql' ? `\`${name}\`` : `"${name}"`
}

export function placeholder(index: number) {
  return configuredDatabaseProvider() === 'postgresql' ? `$${index}` : '?'
}

function rawParameters(values: unknown[]) {
  return values.map(v => v instanceof Date && configuredDatabaseProvider() === 'sqlite'
    ? v.toISOString()
    : typeof v === 'boolean' && configuredDatabaseProvider() === 'sqlite' ? Number(v) : v)
}

/**
 * 在给定连接上执行已校验的插件 SQL，并适配数据库参数和插入结果。
 * @param reader 显式事务或同一数据库连接；此方法不校验表归属，调用前须完成权限检查。
 */
export async function executePluginSql(reader: PluginTransaction, query: { sql: string; parameters: unknown[]; kind?: string }) {
  if (query.sql.length > 200_000 || query.parameters.length > 10000) {
    throw new HttpError('Plugin query limit exceeded', 413)
  }
  const params = rawParameters(query.parameters)
  if (/^\s*(select|pragma\s+table_info|with)\b/i.test(query.sql) || /\breturning\b/i.test(query.sql)) {
    const rows = await reader.$queryRawUnsafe<Record<string, unknown>[]>(query.sql, ...params)
    return { rows, ...(/\breturning\b/i.test(query.sql) ? { numAffectedRows: BigInt(rows.length) } : {}) }
  }
  const count = await reader.$executeRawUnsafe(query.sql, ...params)
  let insertId: bigint | undefined
  if (/^\s*insert\b/i.test(query.sql) && configuredDatabaseProvider() !== 'postgresql') {
    const id = await reader.$queryRawUnsafe<{ id: bigint | number }[]>(configuredDatabaseProvider() === 'mysql' ? 'SELECT LAST_INSERT_ID() AS id' : 'SELECT last_insert_rowid() AS id')
    insertId = BigInt(id[0].id)
  }
  return { rows: [], numAffectedRows: BigInt(count), insertId }
}

export function schemaDatabase() {
  return createPluginContext({
    manifest: {} as PluginManifest,
    config: {},
    provider: configuredDatabaseProvider() ?? 'sqlite',
    tables: {},
  }, async (_method, input) => {
    const query = input as { sql: string; parameters: unknown[] }
    return {
      rows: [],
      numAffectedRows: BigInt(await prisma.$executeRawUnsafe(query.sql, ...rawParameters(query.parameters))),
    }
  }).db
}

export async function tableExists(name: string, reader: PluginTransaction = prisma) {
  const p = configuredDatabaseProvider()
  const query = p === 'sqlite'
    ? `SELECT name FROM sqlite_master WHERE type='table' AND name = ?`
    : p === 'mysql'
      ? 'SELECT TABLE_NAME FROM information_schema.TABLES WHERE TABLE_SCHEMA = DATABASE() AND TABLE_NAME = ?'
      : 'SELECT table_name FROM information_schema.tables WHERE table_schema = current_schema() AND table_name = $1'
  return (await reader.$queryRawUnsafe<unknown[]>(query, name)).length > 0
}

export async function columnExists(name: string, column: string, reader: PluginTransaction = prisma) {
  const table = quoteIdentifier(name)
  quoteIdentifier(column)
  const provider = configuredDatabaseProvider()
  if (provider === 'sqlite') {
    const columns = await reader.$queryRawUnsafe<{ name: string }[]>(`PRAGMA table_info(${table})`)
    return columns.some(item => item.name === column)
  }
  const query = provider === 'mysql'
    ? 'SELECT COLUMN_NAME FROM information_schema.COLUMNS WHERE TABLE_SCHEMA=DATABASE() AND TABLE_NAME=? AND COLUMN_NAME=?'
    : 'SELECT column_name FROM information_schema.columns WHERE table_schema=current_schema() AND table_name=$1 AND column_name=$2'
  return (await reader.$queryRawUnsafe<unknown[]>(query, name, column)).length > 0
}

function schemaObjectName(table: string, kind: string, index: number) {
  return `${table.slice(0, 35)}_${createHash('sha256').update(table).digest('hex').slice(0, 10)}_${kind}${index}`
}

type DataTypeExpression = Parameters<ReturnType<ReturnType<typeof schemaDatabase>['schema']['createTable']>['addColumn']>[1]

/**
 * 按可移植描述创建表、索引和外键；调用者负责维护锁及失败后的恢复。
 * @param names 插件逻辑表名到物理表名的映射，用于解析插件内的外键。
 * @param actualName 实际创建的物理表名；恢复时可指定暂存表名，不覆盖正式表。
 */
export async function createOwnedTable(
  pluginId: string,
  table: PluginTable,
  names: Record<string, string>,
  actualName = physicalTableName(pluginId, table)
) {
  const db = schemaDatabase()
  const provider = configuredDatabaseProvider()
  let builder = db.schema.createTable(actualName)
  for (const column of table.columns) {
    let type: DataTypeExpression = ({
      string: `varchar(${column.length ?? 255})`,
      text: 'text',
      integer: 'integer',
      bigint: 'bigint',
      boolean: provider === 'sqlite' ? 'integer' : 'boolean',
      datetime: provider === 'postgresql' ? 'timestamptz' : provider === 'mysql' ? 'datetime(3)' : 'text',
      json: 'text',
      binary: provider === 'postgresql' ? 'bytea' : 'blob',
    } as Record<string, DataTypeExpression>)[column.type]
    if (column.generated && provider === 'postgresql') type = 'serial'
    builder = builder.addColumn(column.name, type, col => {
      if (column.primary) col = col.primaryKey()
      if (column.generated && provider !== 'postgresql') col = col.autoIncrement()
      if (!column.nullable) col = col.notNull()
      if (column.references) {
        const ref = column.references
        const target = ref.coreCollection ? CORE_TABLES[ref.coreCollection] : names[ref.table]
        if (!target || (ref.coreCollection && ref.table !== target)) {
          throw new HttpError('Invalid plugin foreign key declaration', 400)
        }
        if (provider !== 'mysql') {
          col = col.references(`${target}.${ref.column}`).onDelete(ref.onDelete.toLowerCase() as 'cascade' | 'set null' | 'restrict')
        }
      }
      return col
    })
  }
  await builder.execute()
  for (const [index, item] of table.indexes.entries()) {
    let b = db.schema.createIndex(schemaObjectName(actualName, 'i', index)).on(actualName).columns(item.columns)
    if (item.unique) b = b.unique()
    await b.execute()
  }
  // MySQL may create its own FK support indexes. Create declared indexes first
  // so the engine can reuse them instead of retaining redundant copies.
  if (provider === 'mysql') {
    for (const [index, column] of table.columns.filter(c => c.references).entries()) {
      const ref = column.references!
      const target = ref.coreCollection ? CORE_TABLES[ref.coreCollection] : names[ref.table]
      await db.schema
        .alterTable(actualName)
        .addForeignKeyConstraint(
          schemaObjectName(actualName, 'f', index),
          [column.name],
          target,
          [ref.column],
          constraint => constraint.onDelete(ref.onDelete.toLowerCase() as 'cascade' | 'set null' | 'restrict')
        )
        .execute()
    }
  }
}

export async function verifyOwnedTable(name: string, descriptor: PluginTable, names: Record<string, string>) {
  if (!await tableExists(name)) throw new HttpError(`Plugin migration did not create table ${name}`, 409)
  const p = configuredDatabaseProvider()
  type Column = { name: string; type: string; nullable: string | number; pk?: number }
  let columns: Column[]
  let primary: string[]
  let indexes: { columns: string[]; unique: boolean }[]
  let foreign: { source: string; target: string; column: string; rule: string }[]
  if (p === 'sqlite') {
    const rows = await prisma.$queryRawUnsafe<{ name: string; type: string; notnull: number; pk: number }[]>(`PRAGMA table_info(${quoteIdentifier(name)})`)
    columns = rows.map(r => ({ ...r, nullable: r.notnull || r.pk ? 'NO' : 'YES' }))
    primary = rows.filter(r => r.pk).map(r => r.name)
    const list = await prisma.$queryRawUnsafe<{ name: string; unique: number; origin: string }[]>(`PRAGMA index_list(${quoteIdentifier(name)})`)
    indexes = []
    for (const index of list.filter(i => i.origin !== 'pk')) {
      const parts = await prisma.$queryRawUnsafe<{ name: string }[]>('SELECT name FROM pragma_index_info(?) ORDER BY seqno', index.name)
      indexes.push({ columns: parts.map(i => i.name), unique: !!index.unique })
    }
    const refs = await prisma.$queryRawUnsafe<{ from: string; table: string; to: string; on_delete: string }[]>(`PRAGMA foreign_key_list(${quoteIdentifier(name)})`)
    foreign = refs.map(r => ({ source: r.from, target: r.table, column: r.to, rule: r.on_delete }))
  } else {
    columns = await prisma.$queryRawUnsafe<Column[]>(p === 'mysql'
      ? 'SELECT COLUMN_NAME AS name, CAST(DATA_TYPE AS CHAR) AS type, IS_NULLABLE AS nullable FROM information_schema.COLUMNS WHERE TABLE_SCHEMA = DATABASE() AND TABLE_NAME = ?'
      : 'SELECT column_name AS name, data_type AS type, is_nullable AS nullable FROM information_schema.columns WHERE table_schema = current_schema() AND table_name = $1', name)
    const primaryRows = await prisma.$queryRawUnsafe<{ name: string }[]>(p === 'mysql'
      ? "SELECT COLUMN_NAME AS name FROM information_schema.KEY_COLUMN_USAGE WHERE TABLE_SCHEMA = DATABASE() AND TABLE_NAME = ? AND CONSTRAINT_NAME = 'PRIMARY' ORDER BY ORDINAL_POSITION"
      : "SELECT k.column_name AS name FROM information_schema.table_constraints t JOIN information_schema.key_column_usage k ON k.constraint_name=t.constraint_name AND k.constraint_schema=t.constraint_schema WHERE t.table_schema=current_schema() AND t.table_name=$1 AND t.constraint_type='PRIMARY KEY' ORDER BY k.ordinal_position", name)
    primary = primaryRows.map(r => r.name)
    const parts = await prisma.$queryRawUnsafe<{ index: string; column: string; nonunique: number | boolean }[]>(p === 'mysql'
      ? "SELECT INDEX_NAME AS `index`, COLUMN_NAME AS `column`, NON_UNIQUE AS nonunique FROM information_schema.STATISTICS WHERE TABLE_SCHEMA=DATABASE() AND TABLE_NAME=? AND INDEX_NAME <> 'PRIMARY' ORDER BY INDEX_NAME, SEQ_IN_INDEX"
      : `SELECT i.relname AS index, a.attname AS column, NOT ix.indisunique AS nonunique FROM pg_class t JOIN pg_namespace ns ON ns.oid=t.relnamespace JOIN pg_index ix ON t.oid=ix.indrelid JOIN pg_class i ON i.oid=ix.indexrelid JOIN LATERAL unnest(ix.indkey) WITH ORDINALITY keys(attnum,position) ON true LEFT JOIN pg_attribute a ON a.attrelid=t.oid AND a.attnum=keys.attnum WHERE ns.nspname=current_schema() AND t.relname=$1 AND NOT ix.indisprimary ORDER BY i.relname, keys.position`, name)
    const grouped = new Map<string, { columns: string[]; unique: boolean }>()
    for (const part of parts) {
      const index = grouped.get(part.index) ?? { columns: [], unique: !part.nonunique }
      index.columns.push(part.column)
      grouped.set(part.index, index)
    }
    indexes = [...grouped.values()]
    foreign = await prisma.$queryRawUnsafe<typeof foreign>(p === 'mysql'
      ? 'SELECT k.COLUMN_NAME AS source, CAST(k.REFERENCED_TABLE_NAME AS CHAR) AS target, k.REFERENCED_COLUMN_NAME AS `column`, CAST(r.DELETE_RULE AS CHAR) AS rule FROM information_schema.KEY_COLUMN_USAGE k JOIN information_schema.REFERENTIAL_CONSTRAINTS r ON k.CONSTRAINT_NAME=r.CONSTRAINT_NAME AND k.CONSTRAINT_SCHEMA=r.CONSTRAINT_SCHEMA WHERE k.TABLE_SCHEMA=DATABASE() AND k.TABLE_NAME=? AND k.REFERENCED_TABLE_NAME IS NOT NULL'
      : `SELECT k.column_name AS source, c.table_name AS target, c.column_name AS column, r.delete_rule AS rule FROM information_schema.key_column_usage k JOIN information_schema.referential_constraints r ON k.constraint_name=r.constraint_name AND k.constraint_schema=r.constraint_schema JOIN information_schema.constraint_column_usage c ON c.constraint_name=r.unique_constraint_name AND c.constraint_schema=r.unique_constraint_schema WHERE k.table_schema=current_schema() AND k.table_name=$1`, name)
  }
  const families: Record<PluginTable['columns'][number]['type'], RegExp> = {
    string: /char|text/i,
    text: /text/i,
    json: /text/i,
    integer: /^(integer|int|int4|smallint|tinyint)$/i,
    bigint: /^bigint|int8$/i,
    boolean: /boolean|tinyint|integer/i,
    datetime: /timestamp|datetime|text/i,
    binary: /blob|bytea/i,
  }
  const canonical = (value: unknown) => JSON.stringify(value)
  const expectedIndexes = [...new Set(descriptor.indexes.map(i => canonical({ columns: i.columns, unique: i.unique })))].sort()
  const actualIndexes = [
    ...new Set(indexes.filter(index => !(p === 'mysql' && !index.unique && index.columns.length === 1 &&
      foreign.some(ref => ref.source === index.columns[0]) &&
      !expectedIndexes.includes(canonical(index)))).map(canonical))
  ].sort()
  const expectedForeign = descriptor.columns
    .filter(c => c.references)
    .map(c => canonical({
      source: c.name,
      target: c.references!.coreCollection ? CORE_TABLES[c.references!.coreCollection] : names[c.references!.table],
      column: c.references!.column,
      rule: c.references!.onDelete,
    }))
    .sort()
  const actualForeign = foreign.map(canonical).sort()
  if (columns.length !== descriptor.columns.length ||
    descriptor.columns.some(c => !columns.some(r => r.name === c.name && families[c.type].test(r.type) && (r.nullable === 'YES') === c.nullable)) ||
    canonical(primary) !== canonical(descriptor.columns.filter(c => c.primary).map(c => c.name)) ||
    canonical(expectedIndexes) !== canonical(actualIndexes) ||
    canonical(expectedForeign) !== canonical(actualForeign)) {
    throw new HttpError(
      `Plugin schema differs from portable descriptor: ${name}`,
      409,
      409,
      { columns, primary, expectedIndexes, actualIndexes, expectedForeign, actualForeign }
    )
  }
  const triggers = await prisma.$queryRawUnsafe<unknown[]>(
    p === 'sqlite'
      ? "SELECT name FROM sqlite_master WHERE type='trigger' AND tbl_name=?"
      : p === 'mysql'
        ? 'SELECT TRIGGER_NAME FROM information_schema.TRIGGERS WHERE TRIGGER_SCHEMA=DATABASE() AND EVENT_OBJECT_TABLE=?'
        : 'SELECT g.tgname FROM pg_trigger g JOIN pg_class t ON g.tgrelid=t.oid JOIN pg_namespace n ON t.relnamespace=n.oid WHERE n.nspname=current_schema() AND t.relname=$1 AND NOT g.tgisinternal',
    name
  )
  if (triggers.length) throw new HttpError('Plugin triggers are unsupported in portable protocol v1', 409)
}

/**
 * 按外键依赖返回父表在前的顺序，用于创建和导入；删除时需反向遍历。
 * @param tables 同批次表描述；混合多个插件时需带 pluginId，避免同名逻辑表相互干扰。
 */
export function orderedPluginTables<T extends { name: string; descriptor: PluginTable; pluginId?: string }>(tables: T[]) {
  const remaining = [...tables]
  const result: typeof tables = []
  while (remaining.length) {
    const next = remaining.findIndex(t => t.descriptor.columns.every(c => !c.references || c.references.coreCollection ||
      !remaining.some(r => r.descriptor.name === c.references!.table &&
        (!r.pluginId || !t.pluginId || r.pluginId === t.pluginId))))
    if (next < 0) throw new HttpError('Cyclic plugin foreign keys are unsupported in protocol v1', 400)
    result.push(...remaining.splice(next, 1))
  }
  return result
}

export async function dropOwnedTables(tables: { name: string; descriptor: PluginTable }[]) {
  // A failed migration can leave a different FK graph than either manifest.
  // Inspect actual relationships instead of trusting the target/saved order.
  const remaining: { name: string; parents: string[] }[] = []
  const ordered: string[] = []
  const provider = configuredDatabaseProvider()
  for (const table of tables) {
    if (!remaining.some(t => t.name === table.name) && await tableExists(table.name)) {
      const rows = await prisma.$queryRawUnsafe<Record<string, unknown>[]>(provider === 'sqlite'
        ? `PRAGMA foreign_key_list(${quoteIdentifier(table.name)})`
        : provider === 'mysql'
          ? 'SELECT CAST(REFERENCED_TABLE_NAME AS CHAR) AS target FROM information_schema.KEY_COLUMN_USAGE WHERE TABLE_SCHEMA=DATABASE() AND TABLE_NAME=? AND REFERENCED_TABLE_NAME IS NOT NULL'
          : "SELECT parent.relname AS target FROM pg_constraint fk JOIN pg_class child ON child.oid=fk.conrelid JOIN pg_class parent ON parent.oid=fk.confrelid JOIN pg_namespace ns ON child.relnamespace=ns.oid WHERE fk.contype='f' AND ns.nspname=current_schema() AND child.relname=$1", ...(provider === 'sqlite' ? [] : [table.name]))
      remaining.push({
        name: table.name,
        parents: rows.map(row => String(provider === 'sqlite' ? row.table : row.target)),
      })
    }
  }
  while (remaining.length) {
    const index = remaining.findIndex(table => table.parents.every(name => !remaining.some(parent => parent.name === name)))
    if (index < 0) {
      throw new HttpError('Actual plugin foreign keys contain an unsupported cycle; manual recovery required', 409)
    }
    ordered.push(...remaining.splice(index, 1).map(table => table.name))
  }
  for (const name of ordered.reverse()) await schemaDatabase().schema.dropTable(name).execute()
}

export function portableRow(row: Record<string, unknown>) {
  return Object.fromEntries(Object.entries(row).map(([key, value]) => [
    key,
    typeof value === 'bigint'
      ? String(value)
      : value instanceof Date
        ? value.toISOString()
        : value instanceof Uint8Array ? { $binary: Buffer.from(value).toString('base64') } : value
  ]))
}

export async function insertPortableRow(
  reader: PluginTransaction,
  name: string,
  descriptor: PluginTable,
  row: Record<string, unknown>
) {
  const cols = descriptor.columns.filter(c => Object.hasOwn(row, c.name))
  if (!cols.length) throw new HttpError('Empty plugin backup row', 400)
  const params = cols.map(c => {
    const v = row[c.name]
    if (v == null) return null
    if (c.type === 'binary') return Buffer.from((v as { $binary: string }).$binary, 'base64')
    if (c.type === 'datetime') return configuredDatabaseProvider() === 'sqlite' ? String(v) : new Date(String(v))
    if (c.type === 'integer') return Number(v)
    if (c.type === 'bigint') return BigInt(String(v))
    if (c.type === 'boolean') return configuredDatabaseProvider() === 'sqlite' ? Number(v) : !!v
    return v
  })
  await reader.$executeRawUnsafe(
    `INSERT INTO ${quoteIdentifier(name)} (${cols.map(c => quoteIdentifier(c.name)).join(',')}) VALUES (${cols.map((_, i) => placeholder(i + 1)).join(',')})`,
    ...params
  )
}

export async function* readOwnedRows(reader: PluginTransaction, name: string, descriptor: PluginTable) {
  const pk = descriptor.columns.find(c => c.primary)!.name
  let after: unknown
  for (; ;) {
    const rows = await reader.$queryRawUnsafe<Record<string, unknown>[]>(
      `SELECT * FROM ${quoteIdentifier(name)}${after === undefined ? '' : ` WHERE ${quoteIdentifier(pk)} > ${placeholder(1)}`} ORDER BY ${quoteIdentifier(pk)} ASC LIMIT 100`,
      ...(after === undefined ? [] : [after])
    )
    if (!rows.length) break
    for (const row of rows) yield portableRow(row)
    after = rows.at(-1)![pk]
  }
}

/**
 * 将显式事务绑定到单次插件调用，调用结束后关闭实例并回滚未完成事务。
 * 事务句柄不能跨调用复用，维护锁会一直保留到事务真正结束。
 */
export class PluginTransactions {
  private closed = false

  /** @param lock 可选的维护锁获取器，返回释放函数；后台调用在开启事务前获取该锁。 */
  constructor(private readonly lock?: () => Promise<() => void>) { }

  get active() {
    return this.transactions.size > 0
  }
  private transactions = new Map<string, { tx: PluginTransaction; finish: (commit: boolean) => void; done: Promise<unknown> }>()

  /** 开启可串行化写事务；仅在事务连接已就绪后返回本次调用内有效的句柄。 */
  async begin() {
    if (this.closed) throw new HttpError('Plugin invocation has closed', 409)
    const release = await this.lock?.()
    if (this.closed) {
      release?.()
      throw new HttpError('Plugin invocation has closed', 409)
    }
    const id = randomUUID()
    let ready!: () => void
    let fail!: (error: unknown) => void
    const opened = new Promise<void>((resolve, reject) => {
      ready = resolve
      fail = reject
    })
    const done = unitOfWork
      .execute(async tx => {
        const commit = await new Promise<boolean>(finish => {
          this.transactions.set(id, { tx, finish, done })
          if (this.closed) {
            finish(false)
          }
          ready()
        })
        if (!commit) throw new Error('PLUGIN_TRANSACTION_ROLLED_BACK')
      }, { mode: 'write', isolationLevel: 'Serializable', timeout: 15_000, maxWait: 5000 })
      .catch(error => {
        fail(error)
        throw error
      })
      .finally(() => {
        this.transactions.delete(id)
        release?.()
      })
    // A killed worker must not leave an unobserved rejecting transaction promise.
    void done.catch(() => undefined)
    await opened
    return id
  }

  get(id?: string) {
    const tx = id && this.transactions.get(id)
    if (id && !tx) {
      throw new HttpError('Plugin transaction has expired', 409)
    }
    return tx ? tx.tx : undefined
  }

  /**
   * 结束指定事务并等待数据库完成处理。
   * @param commit 为 true 时提交并向调用者传播失败；为 false 时回滚并忽略事务结束异常。
   */
  async end(id: string, commit: boolean) {
    const item = this.transactions.get(id)
    if (!item) {
      throw new HttpError('Plugin transaction has expired', 409)
    }
    item.finish(commit)
    try {
      await item.done
    } catch (error) {
      if (commit) {
        throw error
      }
    }
  }

  async abortAll() {
    this.closed = true
    await Promise.all([...this.transactions.keys()].map(id => this.end(id, false).catch(() => undefined)))
  }
}

/**
 * 执行已通过归属检查的查询；有显式事务时复用，否则按 SQL 类型创建工作单元。
 * @param tx 当前调用的事务连接；DDL 不允许在显式事务中执行。
 * @param ddl 仅受管迁移阶段可启用，允许结构变更语句走独立执行路径。
 * @param assertActive 为隐式事务提供存活检查，在获得连接后及执行结束前调用。
 */
export async function runPluginQuery(
  input: { sql: string; parameters: unknown[]; kind?: string },
  tx?: PluginTransaction,
  ddl = false,
  assertActive?: () => void
) {
  if (/^\s*(create|alter|drop|truncate)\b/i.test(input.sql)) {
    if (!ddl || tx) throw new HttpError('Plugin DDL is allowed only during managed migrations', 403)
    return {
      rows: [],
      numAffectedRows: BigInt(await prisma.$executeRawUnsafe(input.sql, ...rawParameters(input.parameters))),
    }
  }
  if (tx) return executePluginSql(tx, input)
  return unitOfWork.execute(
    async reader => {
      assertActive?.()
      const result = await executePluginSql(reader, input)
      assertActive?.()
      return result
    },
    { mode: /^\s*select\b/i.test(input.sql) ? 'read' : 'write', timeout: 10000 }
  )
}

export async function resetPluginSequence(tx: PluginTransaction, name: string, descriptor: PluginTable) {
  const column = descriptor.columns.find(c => c.generated)
  if (placeholder(1) !== '$1' || !column) return
  await tx.$queryRawUnsafe(
    `SELECT setval(pg_get_serial_sequence($1::text, $2::text), COALESCE((SELECT MAX(${quoteIdentifier(column.name)}) FROM ${quoteIdentifier(name)}), 0) + 1, false)`,
    name,
    column.name
  )
}
