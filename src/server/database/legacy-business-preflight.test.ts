import { readFileSync, readdirSync } from 'node:fs'
import Database from 'better-sqlite3'
import { describe, expect, it, vi } from 'vitest'
import { clearRetiredHostTables, RETIRED_HOST_TABLES } from './legacy-business-preflight'

const root = 'prisma/providers/sqlite/migrations'
const cleanup = '20261023000000_remove_empty_host_commissions'
const sql = readFileSync(`${root}/${cleanup}/migration.sql`, 'utf8')
function clientFor(db: Database.Database) {
  const tx = { $executeRawUnsafe: vi.fn(async (query: string) => db.prepare(query).run().changes) }
  return {
    $queryRawUnsafe: vi.fn(async (query: string) => db.prepare(query).all()),
    $transaction: vi.fn(async (operation: (transaction: typeof tx) => Promise<void>) => {
      db.exec('BEGIN IMMEDIATE')
      try { await operation(tx); db.exec('COMMIT') }
      catch (error) { db.exec('ROLLBACK'); throw error }
    }),
  } as unknown as Parameters<typeof clearRetiredHostTables>[0]
}
function previousSchema() {
  const db = new Database(':memory:')
  db.pragma('foreign_keys=ON')
  for (const migration of readdirSync(root).filter(name => /^\d/.test(name) && name < cleanup).sort()) {
    db.exec(readFileSync(`${root}/${migration}/migration.sql`, 'utf8'))
  }
  return db
}

describe('retired host business preflight', () => {
  it('accepts fresh databases, empty legacy tables and already upgraded schemas', async () => {
    const fresh = new Database(':memory:'), existing = previousSchema()
    try {
      const freshClient = clientFor(fresh)
      await expect(clearRetiredHostTables(freshClient, 'sqlite')).resolves.toBeUndefined()
      expect(freshClient.$transaction).not.toHaveBeenCalled()
      await expect(clearRetiredHostTables(clientFor(existing), 'sqlite')).resolves.toBeUndefined()
      const before = existing.prepare("SELECT name FROM sqlite_master WHERE type='table' ORDER BY name").all() as { name: string }[]
      existing.exec(sql)
      const after = existing.prepare("SELECT name FROM sqlite_master WHERE type='table' ORDER BY name").all()
      expect(after).toEqual(before.filter(row => !(RETIRED_HOST_TABLES as readonly string[]).includes(row.name)))
      expect(existing.pragma('foreign_key_check')).toEqual([])
      await expect(clearRetiredHostTables(clientFor(existing), 'sqlite')).resolves.toBeUndefined()
    } finally { fresh.close(); existing.close() }
  })

  it.each(RETIRED_HOST_TABLES)('clears rows in %s so the unchanged guarded migration succeeds', async occupied => {
    const db = new Database(':memory:')
    try {
      for (const table of RETIRED_HOST_TABLES) db.exec(`CREATE TABLE "${table}" (id INTEGER PRIMARY KEY)`)
      db.exec(`INSERT INTO "${occupied}" VALUES (1)`)
      // Direct SQL deployment still requires empty tables; runtime cleanup runs first.
      expect(() => db.exec(sql)).toThrow(/CHECK constraint failed/)
      expect(db.prepare(`SELECT id FROM "${occupied}"`).get()).toEqual({ id: 1 })
      expect(db.prepare("SELECT name FROM sqlite_master WHERE type='table'").all()).toHaveLength(RETIRED_HOST_TABLES.length)
      db.exec('ROLLBACK')
      await clearRetiredHostTables(clientFor(db), 'sqlite')
      expect(db.prepare(`SELECT id FROM "${occupied}"`).all()).toEqual([])
      db.exec(sql)
      expect(db.prepare("SELECT name FROM sqlite_master WHERE type='table'").all()).toEqual([])
    } finally { db.close() }
  })

  it.each(['mysql', 'postgresql'] as const)('queries %s catalog and quotes only fixed table names', async provider => {
    const query = vi.fn().mockResolvedValue([{ name: 'contract' }, { name: 'unrelated' }])
    const execute = vi.fn().mockResolvedValue(1)
    const transaction = vi.fn(async (operation: (tx: { $executeRawUnsafe: typeof execute }) => Promise<void>) => operation({ $executeRawUnsafe: execute }))
    await clearRetiredHostTables({ $queryRawUnsafe: query, $transaction: transaction } as unknown as Parameters<typeof clearRetiredHostTables>[0], provider)
    expect(query).toHaveBeenCalledTimes(1)
    expect(execute).toHaveBeenCalledExactlyOnceWith(provider === 'mysql' ? 'DELETE FROM `contract`' : 'DELETE FROM "contract"')
  })

  it('fails closed on catalog or permission errors', async () => {
    const query = vi.fn().mockRejectedValue(new Error('catalog unavailable'))
    const transaction = vi.fn()
    await expect(clearRetiredHostTables({ $queryRawUnsafe: query, $transaction: transaction }, 'sqlite')).rejects.toThrow('catalog unavailable')
    expect(transaction).not.toHaveBeenCalled()
  })

  it('rolls back earlier deletions when a non-retired table still references a retired row', async () => {
    const db = new Database(':memory:')
    try {
      db.pragma('foreign_keys=ON')
      db.exec(`
        CREATE TABLE contract_admin_audit (id INTEGER PRIMARY KEY);
        CREATE TABLE contract (id INTEGER PRIMARY KEY);
        CREATE TABLE unrelated (id INTEGER PRIMARY KEY, contract_id INTEGER REFERENCES contract(id) ON DELETE RESTRICT);
        INSERT INTO contract_admin_audit VALUES (1);
        INSERT INTO contract VALUES (1);
        INSERT INTO unrelated VALUES (1, 1);
      `)
      await expect(clearRetiredHostTables(clientFor(db), 'sqlite')).rejects.toThrow(/FOREIGN KEY/)
      for (const table of ['contract_admin_audit', 'contract', 'unrelated']) {
        expect(db.prepare(`SELECT id FROM "${table}"`).all()).toEqual([{ id: 1 }])
      }
    } finally { db.close() }
  })

  it.each(['sqlite', 'mysql', 'postgresql'])('%s cleanup drops precisely the retired tables without disabling constraints', provider => {
    const migration = readFileSync(`prisma/providers/${provider}/migrations/${cleanup}/migration.sql`, 'utf8')
    const dropped = [...migration.matchAll(/^DROP TABLE ["`]([^"`]+)["`];/gm)].map(match => match[1]).filter(name => name !== '_empty_host_business_guard')
    expect(dropped).toEqual(RETIRED_HOST_TABLES)
    expect(migration).not.toMatch(/FOREIGN_KEY_CHECKS|foreign_keys\s*=\s*OFF|CASCADE|DELETE FROM/i)
    const firstDrop = migration.indexOf('DROP TABLE')
    for (const name of RETIRED_HOST_TABLES) expect(migration.slice(0, firstDrop)).toContain(`FROM ${provider === 'mysql' ? '`' : '"'}${name}`)
  })
})
