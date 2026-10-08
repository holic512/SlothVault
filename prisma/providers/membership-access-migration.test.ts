import { mkdtempSync, readFileSync, readdirSync, rmSync } from 'node:fs'
import { tmpdir } from 'node:os'
import { join, resolve } from 'node:path'
import Database from 'better-sqlite3'
import { describe, expect, it } from 'vitest'

describe('revision 9 SQLite upgrade', () => {
  it('snapshots old rank access while retaining IDs, disabled types, grants and exact body/hash values', () => {
    const directory = mkdtempSync(join(tmpdir(), 'sv-access-migration-'))
    const db = new Database(join(directory, 'upgrade.db'))
    try {
      db.pragma('foreign_keys = ON')
      const root = resolve('prisma/providers/sqlite/migrations')
      const revision9 = '20261008000000_parallel_membership_project_access'
      for (const migration of readdirSync(root).filter(name => /^\d/.test(name) && name < revision9).sort()) db.exec(readFileSync(join(root, migration, 'migration.sql'), 'utf8'))
      db.exec(`INSERT INTO membership_level (id, name, rank, price_points, status) VALUES (1,'A',1,10,1),(2,'B',2,20,1),(3,'C',3,30,0);
        INSERT INTO auth_user (id, username, password, role) VALUES (1,'member','hash','USER');
        INSERT INTO membership_grant (id,user_id,membership_level_id,source,granted_at,expires_at) VALUES (1,1,2,'POINT_PURCHASE','2026-01-01','2027-01-01');
        INSERT INTO collections_project (id,project_name,weight,status,require_auth) VALUES (1,'Legacy',0,1,1);
        INSERT INTO collections_project_version (id,project_id,version,weight,status,release_id,release_hash,manifest_version,published_at) VALUES (1,1,'v1',0,1,'unchanged-id','unchanged-hash',2,'2026-01-01');`)
      const markdown = '# Exact body\r\n[附件](/uploads/docs/a.zip)\n'
      db.prepare('INSERT INTO blog_article (id,title,content,status,required_membership_level_id,published_at) VALUES (1,?, ?,1,2,?)').run('Legacy', markdown, '2026-01-01')
      const grants = db.prepare('SELECT * FROM membership_grant').all()
      const release = db.prepare('SELECT * FROM collections_project_version').all()
      db.exec(readFileSync(join(root, revision9, 'migration.sql'), 'utf8'))
      expect(db.prepare('SELECT membership_level_id FROM article_membership WHERE article_id=1 ORDER BY membership_level_id').all()).toEqual([{ membership_level_id: 2 }, { membership_level_id: 3 }])
      expect(db.prepare('SELECT content FROM blog_article WHERE id=1').get()).toEqual({ content: markdown })
      expect(db.prepare('SELECT * FROM membership_grant').all()).toEqual(grants)
      expect(db.prepare('SELECT * FROM collections_project_version').all()).toEqual(release)
      expect(db.prepare('SELECT read_access_mode,download_access_mode FROM collections_project').get()).toEqual({ read_access_mode: 'PUBLIC', download_access_mode: 'FOLLOW_READ' })
      db.exec("UPDATE membership_level SET rank=10 WHERE id=1; INSERT INTO membership_level (id,name,rank,price_points) VALUES (4,'D',100,40)")
      expect(db.prepare('SELECT membership_level_id FROM article_membership ORDER BY membership_level_id').all()).toEqual([{ membership_level_id: 2 }, { membership_level_id: 3 }])
    } finally { db.close(); rmSync(directory, { recursive: true, force: true }) }
  })
})
