import { readFileSync, readdirSync } from 'node:fs'
import Database from 'better-sqlite3'
import { describe, expect, it, vi } from 'vitest'
import { assertRetiredHostTablesEmpty, RETIRED_HOST_TABLES } from './legacy-business-preflight'

const root = 'prisma/providers/sqlite/migrations'
const cleanup = '20261023000000_remove_empty_host_commissions'
const sql = readFileSync(`${root}/${cleanup}/migration.sql`, 'utf8')
function reader(db: Database.Database) {
  return { $queryRawUnsafe: vi.fn(async (query: string) => db.prepare(query).all()) } as unknown as Parameters<typeof assertRetiredHostTablesEmpty>[0]
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
      await expect(assertRetiredHostTablesEmpty(reader(fresh), 'sqlite')).resolves.toBeUndefined()
      await expect(assertRetiredHostTablesEmpty(reader(existing), 'sqlite')).resolves.toBeUndefined()
      const before = existing.prepare("SELECT name FROM sqlite_master WHERE type='table' ORDER BY name").all() as { name: string }[]
      existing.exec(sql)
      const after = existing.prepare("SELECT name FROM sqlite_master WHERE type='table' ORDER BY name").all()
      expect(after).toEqual(before.filter(row => !(RETIRED_HOST_TABLES as readonly string[]).includes(row.name)))
      expect(existing.pragma('foreign_key_check')).toEqual([])
      await expect(assertRetiredHostTablesEmpty(reader(existing), 'sqlite')).resolves.toBeUndefined()
    } finally { fresh.close(); existing.close() }
  })

  it.each(RETIRED_HOST_TABLES)('rejects rows in %s before migration and never drops earlier empty tables', async occupied => {
    const db = new Database(':memory:')
    try {
      for (const table of RETIRED_HOST_TABLES) db.exec(`CREATE TABLE "${table}" (id INTEGER PRIMARY KEY)`)
      db.exec(`INSERT INTO "${occupied}" VALUES (1)`)
      const client = reader(db)
      await expect(assertRetiredHostTablesEmpty(client, 'sqlite')).rejects.toThrow(occupied)
      expect(client.$queryRawUnsafe).not.toHaveBeenCalledWith(expect.stringMatching(/DROP|DELETE|UPDATE|INSERT/))
      // Defense in depth: bypassing the host preflight still cannot drop any table.
      expect(() => db.exec(sql)).toThrow(/CHECK constraint failed/)
      expect(db.prepare(`SELECT id FROM "${occupied}"`).get()).toEqual({ id: 1 })
      expect(db.prepare("SELECT name FROM sqlite_master WHERE type='table'").all()).toHaveLength(RETIRED_HOST_TABLES.length)
      db.exec('ROLLBACK')
    } finally { db.close() }
  })

  it.each(['mysql', 'postgresql'] as const)('queries %s catalog and quotes only fixed table names', async provider => {
    const query = vi.fn().mockResolvedValueOnce([{ name: 'contract' }, { name: 'unrelated' }]).mockResolvedValueOnce([{ value: 1 }])
    await expect(assertRetiredHostTablesEmpty({ $queryRawUnsafe: query }, provider)).rejects.toThrow('contract')
    expect(query).toHaveBeenCalledTimes(2)
    expect(query.mock.calls[1][0]).toBe(provider === 'mysql' ? 'SELECT 1 FROM `contract` LIMIT 1' : 'SELECT 1 FROM "contract" LIMIT 1')
  })

  it('fails closed on catalog or permission errors', async () => {
    const query = vi.fn().mockRejectedValue(new Error('catalog unavailable'))
    await expect(assertRetiredHostTablesEmpty({ $queryRawUnsafe: query }, 'sqlite')).rejects.toThrow('catalog unavailable')
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
