import { readFileSync, readdirSync } from 'node:fs'
import Database from 'better-sqlite3'
import { describe, expect, it } from 'vitest'
const migration = '20261015000000_bounded_sessions'
describe('bounded session migrations', () => {
  it.each(['postgresql', 'mysql', 'sqlite'])('%s adds the same persistence flag and revokes existing sessions without deleting records', provider => {
    const sql = readFileSync(`prisma/providers/${provider}/migrations/${migration}/migration.sql`, 'utf8')
    expect(sql).toMatch(/ADD COLUMN ["`]persistent["`] BOOLEAN NOT NULL DEFAULT false/)
    expect(sql).toMatch(/UPDATE ["`]auth_session["`] SET ["`]revoked_at["`]/)
    expect(sql).not.toMatch(/DROP|DELETE|TRUNCATE/i)
    expect(readFileSync(`prisma/providers/${provider}/schema.prisma`, 'utf8')).toMatch(/persistent Boolean @default\(false\)/)
  })
  it('upgrades populated SQLite databases and does not re-revoke newly created sessions', () => {
    const db = new Database(':memory:')
    try {
      db.pragma('foreign_keys=ON')
      for (const name of readdirSync('prisma/providers/sqlite/migrations').filter(name => /^\d/.test(name) && name < migration).sort()) db.exec(readFileSync(`prisma/providers/sqlite/migrations/${name}/migration.sql`, 'utf8'))
      db.exec(`INSERT INTO auth_user(username,password) VALUES('owner','hash');
        INSERT INTO auth_session(id,user_id,token_hash,expires_at) VALUES('old',1,'old-hash','2099-01-01');
        INSERT INTO auth_session(id,user_id,token_hash,expires_at,revoked_at) VALUES('revoked',1,'revoked-hash','2099-01-01','2026-01-01');`)
      db.exec(readFileSync(`prisma/providers/sqlite/migrations/${migration}/migration.sql`, 'utf8'))
      const old = db.prepare("SELECT * FROM auth_session WHERE id='old'").get() as { persistent: number; revoked_at: string }
      expect(old.persistent).toBe(0)
      expect(old.revoked_at).toBeTruthy()
      expect(db.prepare("SELECT revoked_at FROM auth_session WHERE id='revoked'").get()).toEqual({ revoked_at: '2026-01-01' })
      db.exec("INSERT INTO auth_session(id,user_id,token_hash,expires_at) VALUES('new',1,'new-hash','2099-01-01')")
      expect(db.prepare("SELECT revoked_at,persistent FROM auth_session WHERE id='new'").get()).toEqual({ revoked_at: null, persistent: 0 })
      expect(db.prepare('SELECT count(*) AS count FROM auth_user').get()).toEqual({ count: 1 })
      expect(db.pragma('foreign_key_check')).toEqual([])
    } finally { db.close() }
  })
})
