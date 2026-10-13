import { readFileSync, readdirSync } from 'node:fs'
import { resolve } from 'node:path'
import Database from 'better-sqlite3'
import { describe, expect, it } from 'vitest'
const migrationName = '20261013000000_site_account_deletion'
const migration = (provider: string) => readFileSync(resolve(`prisma/providers/${provider}/migrations/${migrationName}/migration.sql`), 'utf8')
describe('site-owned account attribution migrations', () => {
  it.each(['postgresql', 'mysql', 'sqlite'])('%s retains customer restrictions and independently stores deletion history', provider => {
    const sql = migration(provider)
    expect(sql).toContain('auth_user_deletion_record')
    expect(sql).toContain('attribution_json')
    expect(sql).toContain('ON DELETE SET NULL')
    expect(sql).not.toMatch(/UPDATE\s+["`]?contract["`]?\s+SET\s+["`]?(?:body|snapshot_json|contract_hash|party_commitment)/i)
    for (const col of ['evidence_file_id', 'delivery_id', 'attachment_file_id']) expect(sql).not.toMatch(new RegExp('FOREIGN KEY \\(["`]'+col+'["`]\\) REFERENCES ["`]auth_user'))
  })
  it('rejects orphaned legacy operator IDs without silently clearing historical data', () => {
    const db = new Database(':memory:')
    try {
      const root = 'prisma/providers/sqlite/migrations'
      for (const name of readdirSync(root).filter(name => /^\d/.test(name) && name < migrationName).sort()) db.exec(readFileSync(`${root}/${name}/migration.sql`, 'utf8'))
      db.exec(`INSERT INTO collections_project(id,project_name,weight,status) VALUES(1,'Project',0,1);
        INSERT INTO collections_project_version(id,project_id,version,weight,status) VALUES(1,1,'1',0,1);
        INSERT INTO collections_category(id,project_version_id,category_name,weight,status) VALUES(1,1,'Docs',0,1);
        INSERT INTO docs_note_info(id,category_id,author_id,note_title,weight,status) VALUES(1,1,999,'Original',0,1);`)
      expect(() => db.exec(migration('sqlite'))).toThrow('account_user_reference_must_exist')
      db.exec('ROLLBACK')
      expect(db.prepare('SELECT author_id,note_title FROM docs_note_info').get()).toEqual({ author_id: 999, note_title: 'Original' })
      expect(db.prepare("SELECT name FROM sqlite_master WHERE name='auth_user_deletion_record'").get()).toBeUndefined()
    } finally { db.close() }
  })
  it('upgrades retained SQLite data, preserves evidence bytes and makes only attribution nullable', () => {
    const db = new Database(':memory:')
    try {
      db.pragma('foreign_keys=ON')
      const root = 'prisma/providers/sqlite/migrations'
      for (const name of readdirSync(root).filter(name => /^\d/.test(name) && name < migrationName).sort()) db.exec(readFileSync(`${root}/${name}/migration.sql`, 'utf8'))
      db.exec(`INSERT INTO auth_user(id,username,password,role) VALUES(1,'owner','test','ADMIN'),(2,'temporary','test','ADMIN'),(3,'customer','test','USER');
        INSERT INTO contract(contract_id,issuer_user_id,subject_user_id,title,body,body_hash,party_commitment,snapshot_json,snapshot_hash) VALUES('retained',2,3,'Private','exact frozen body','bodyhash','commitment','{"frozen":true}','snapshothash');
        INSERT INTO points_gift_card_batch(name,points,quantity,created_by_id) VALUES('Batch',10,1,2);
        INSERT INTO points_transaction(user_id,amount,balance_after,type) VALUES(3,10,10,'CARD_REDEEM');`)
      const before = db.prepare('SELECT * FROM contract').get() as Record<string, unknown>
      db.exec(migration('sqlite'))
      expect(db.pragma('foreign_key_check')).toEqual([])
      expect(db.prepare('SELECT * FROM contract').get()).toEqual({ ...before, attribution_json: '{}' })
      for (const [table, column] of [['contract', 'issuer_user_id'], ['contract_admin_audit', 'actor_user_id'], ['commission_file', 'uploader_user_id'], ['commission_submission', 'actor_user_id'], ['commission_proof_attempt', 'issuer_user_id']]) {
        const fks = db.pragma(`foreign_key_list("${table}")`) as Array<{ from: string; table: string; on_delete: string }>
        expect(fks.find(fk => fk.from === column)).toMatchObject({ table: 'auth_user', on_delete: 'SET NULL' })
      }
      expect((db.pragma('foreign_key_list("commission_payment")') as Array<{ from: string; table: string }>).find(fk => fk.from === 'evidence_file_id')?.table).toBe('commission_file')
      db.prepare('DELETE FROM auth_user WHERE id=2').run()
      expect(db.prepare('SELECT issuer_user_id FROM contract').get()).toEqual({ issuer_user_id: null })
      expect(() => db.prepare('DELETE FROM auth_user WHERE id=3').run()).toThrow(/FOREIGN KEY/)
      expect(db.prepare('SELECT body,snapshot_json,snapshot_hash,party_commitment FROM contract').get()).toEqual({ body: before.body, snapshot_json: before.snapshot_json, snapshot_hash: before.snapshot_hash, party_commitment: before.party_commitment })
    } finally { db.close() }
  })
})
