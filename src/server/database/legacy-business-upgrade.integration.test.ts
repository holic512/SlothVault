import { createHash, randomUUID } from 'node:crypto'
import { readFileSync, readdirSync } from 'node:fs'
import Database from 'better-sqlite3'
import { describe, expect, it } from 'vitest'
import { ensureAppDataDirectories } from '@/server/config/app-data'
import { sqliteDatabaseFilePath } from './connection-url'
import { upgradeConfiguredDatabaseSchema } from './migrations'
import { RETIRED_HOST_TABLES } from './legacy-business-preflight'
import { CURRENT_SCHEMA_REVISION } from './schema-version'

const root = 'prisma/providers/sqlite/migrations'
const cleanup = '20261023000000_remove_empty_host_commissions'

// Seed one connected record per legacy table using its actual required columns
// and foreign keys, including optional links between retired business records.
function seedRow(db: Database.Database, table: string) {
  if (db.prepare(`SELECT 1 FROM "${table}" WHERE id = 1`).get()) return
  const columns = db.pragma(`table_info("${table}")`) as Array<{ name: string; type: string; notnull: number; dflt_value: unknown; pk: number }>
  const references = db.pragma(`foreign_key_list("${table}")`) as Array<{ from: string; table: string }>
  const values: Record<string, string | number> = { id: 1 }
  for (const column of columns) {
    const reference = references.find(ref => ref.from === column.name)
    if (reference && (column.notnull || (RETIRED_HOST_TABLES as readonly string[]).includes(reference.table))) {
      seedRow(db, reference.table)
      values[column.name] = 1
    } else if (!column.pk && column.notnull && column.dflt_value === null) {
      values[column.name] = /INT|BOOL/i.test(column.type) ? 1 : `fixture-${column.name}`
    }
  }
  const names = Object.keys(values)
  db.prepare(`INSERT INTO "${table}" (${names.map(name => `"${name}"`).join(',')}) VALUES (${names.map(() => '?').join(',')})`).run(...Object.values(values))
}

describe('populated retired host database upgrade', { timeout: 120_000 }, () => {
  it('clears connected legacy data, deploys original migrations and preserves live data on repeated startup', async () => {
    ensureAppDataDirectories()
    const file = sqliteDatabaseFilePath()
    const fixture = new Database(file)
    let preserved: Record<string, unknown[]>
    try {
      fixture.pragma('foreign_keys=ON')
      fixture.exec(`CREATE TABLE _prisma_migrations (
        id TEXT PRIMARY KEY, checksum TEXT NOT NULL, finished_at DATETIME,
        migration_name TEXT NOT NULL, logs TEXT, rolled_back_at DATETIME,
        started_at DATETIME NOT NULL DEFAULT CURRENT_TIMESTAMP, applied_steps_count INTEGER NOT NULL DEFAULT 0
      )`)
      for (const migration of readdirSync(root).filter(name => /^\d/.test(name) && name < cleanup).sort()) {
        const sql = readFileSync(`${root}/${migration}/migration.sql`, 'utf8')
        fixture.exec(sql)
        fixture.prepare('INSERT INTO _prisma_migrations (id, checksum, migration_name, finished_at, applied_steps_count) VALUES (?, ?, ?, CURRENT_TIMESTAMP, 1)')
          .run(randomUUID(), createHash('sha256').update(sql).digest('hex'), migration)
      }
      fixture.prepare('INSERT INTO system_installation (id, provider, status, schema_revision, installation_id) VALUES (1, ?, ?, ?, ?)')
        .run('sqlite', 'INSTALLED', CURRENT_SCHEMA_REVISION - 1, randomUUID())
      for (const table of RETIRED_HOST_TABLES) seedRow(fixture, table)
      for (const table of ['points_transaction', 'plugin_installation', 'plugin_point_receipt']) seedRow(fixture, table)
      expect(fixture.pragma('foreign_key_check')).toEqual([])
      const tables = fixture.prepare("SELECT name FROM sqlite_master WHERE type='table'").all() as { name: string }[]
      preserved = Object.fromEntries(tables
        .filter(({ name }) => !(RETIRED_HOST_TABLES as readonly string[]).includes(name) && !['_prisma_migrations', 'sqlite_sequence', 'system_installation'].includes(name))
        .map(({ name }) => [name, fixture.prepare(`SELECT * FROM "${name}"`).all()]))
    } finally { fixture.close() }

    await upgradeConfiguredDatabaseSchema({ provider: 'sqlite', config: {} })
    await upgradeConfiguredDatabaseSchema({ provider: 'sqlite', config: {} })

    const upgraded = new Database(file)
    try {
      for (const [table, rows] of Object.entries(preserved)) {
        expect(upgraded.prepare(`SELECT * FROM "${table}"`).all(), table).toEqual(rows)
      }
      const tables = upgraded.prepare("SELECT name FROM sqlite_master WHERE type='table'").all() as { name: string }[]
      expect(tables.some(({ name }) => (RETIRED_HOST_TABLES as readonly string[]).includes(name))).toBe(false)
      expect(upgraded.prepare('SELECT schema_revision FROM system_installation WHERE id=1').get()).toEqual({ schema_revision: CURRENT_SCHEMA_REVISION })
      expect(upgraded.prepare('SELECT checksum, applied_steps_count FROM _prisma_migrations WHERE migration_name=?').get(cleanup)).toEqual({
        checksum: createHash('sha256').update(readFileSync(`${root}/${cleanup}/migration.sql`)).digest('hex'),
        applied_steps_count: 1,
      })
      expect(upgraded.pragma('foreign_key_check')).toEqual([])
    } finally { upgraded.close() }
  })
})
