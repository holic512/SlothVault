import { readFileSync, readdirSync } from 'node:fs'
import Database from 'better-sqlite3'
import { describe, expect, it } from 'vitest'
const migrationName = '20261013120000_personal_wallet_credentials'
describe('personal wallet migrations', () => {
  it.each(['postgresql', 'mysql', 'sqlite'])('%s retains the legacy column and copies all bindings', provider => {
    const sql = readFileSync(`prisma/providers/${provider}/migrations/${migrationName}/migration.sql`, 'utf8')
    expect(sql).toContain('auth_user_wallet'); expect(sql).toContain('credentials_revision'); expect(sql).toContain('ON DELETE CASCADE'); expect(sql).not.toMatch(/DROP\s+(TABLE|COLUMN)/i)
    if (provider === 'mysql') expect(sql).toContain('COLLATE ascii_bin')
  })
  it('backfills populated SQLite databases, keeps case-sensitive uniqueness and cascades deletion', () => {
    const db = new Database(':memory:')
    try {
      db.pragma('foreign_keys=ON')
      for (const name of readdirSync('prisma/providers/sqlite/migrations').filter(name => /^\d/.test(name) && name < migrationName).sort()) db.exec(readFileSync(`prisma/providers/sqlite/migrations/${name}/migration.sql`, 'utf8'))
      db.exec(`INSERT INTO auth_user(username,password,wallet_address) VALUES('first','hash','AbCd'),('second','hash','aBcD'),('password_only','hash',NULL);`)
      db.exec(readFileSync(`prisma/providers/sqlite/migrations/${migrationName}/migration.sql`, 'utf8'))
      expect(db.prepare('SELECT address FROM auth_user_wallet ORDER BY id').all()).toEqual([{ address: 'AbCd' }, { address: 'aBcD' }])
      expect(() => db.exec("INSERT INTO auth_user_wallet(user_id,address) VALUES(3,'AbCd')")).toThrow()
      db.exec('DELETE FROM auth_user WHERE id=1')
      expect(db.prepare('SELECT count(*) AS n FROM auth_user_wallet').get()).toEqual({ n: 1 })
      expect(db.pragma('foreign_key_check')).toEqual([])
    } finally { db.close() }
  })
})
