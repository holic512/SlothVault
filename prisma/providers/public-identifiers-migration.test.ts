import { randomUUID } from 'node:crypto'
import { readFileSync, readdirSync } from 'node:fs'
import Database from 'better-sqlite3'
import { describe, expect, it } from 'vitest'
import { publicContentIdPattern } from '../../src/lib/public-content-id'

const migration = '20261030000000_public_content_identifiers'
const tables = ['collections_project', 'collections_project_version', 'docs_note_info', 'blog_article']

describe('public identifier migrations', () => {
  it('backfills SQLite without changing keys, relations, sequences, source bytes or timestamps', () => {
    const db = new Database(':memory:')
    try {
      db.pragma('foreign_keys=ON')
      for (const name of readdirSync('prisma/providers/sqlite/migrations').filter(name => /^\d/.test(name) && name < migration).sort()) db.exec(readFileSync(`prisma/providers/sqlite/migrations/${name}/migration.sql`, 'utf8'))
      db.exec(`INSERT INTO collections_project (id,project_name,weight,status,updated_at) VALUES (41,'Existing',0,1,'2026-10-01');
        INSERT INTO collections_project_version (id,project_id,version,weight,status,updated_at) VALUES (42,41,'1',0,1,'2026-10-01');
        INSERT INTO collections_category (id,project_version_id,category_name,weight,status,updated_at) VALUES (43,42,'Guide',0,1,'2026-10-01');
        INSERT INTO docs_note_info (id,category_id,note_title,weight,status,updated_at) VALUES (44,43,'Note',0,1,'2026-10-01');
        INSERT INTO docs_note_content (id,note_info_id,content,status,updated_at) VALUES (45,44,'[Original](/project/41/v/42/docs/44)',1,'2026-10-01');
        INSERT INTO blog_article (id,title,content,updated_at) VALUES (46,'Article','Original','2026-10-01');
        INSERT INTO collections_project (id,project_name,weight,status,updated_at) VALUES (99,'Removed',0,1,'2026-10-01');
        DELETE FROM collections_project WHERE id=99;`)
      const before = new Map(tables.map(table => [table, db.prepare(`SELECT * FROM ${table}`).all() as Record<string, unknown>[]]))
      db.exec(readFileSync(`prisma/providers/sqlite/migrations/${migration}/migration.sql`, 'utf8'))
      for (const table of tables) {
        const rows = db.prepare(`SELECT * FROM ${table}`).all() as Record<string, unknown>[]
        expect(rows.map(({ public_id, legacy_url_id, ...row }) => {
          expect(publicContentIdPattern.test(String(public_id))).toBe(true)
          expect(legacy_url_id).toBe(row.id)
          return row
        })).toEqual(before.get(table))
        const publicId = rows[0].public_id
        expect(() => db.prepare(`UPDATE ${table} SET public_id=NULL`).run()).toThrow()
        expect(db.prepare(`SELECT public_id FROM ${table}`).get()).toEqual({ public_id: publicId })
      }
      expect(db.prepare('SELECT content FROM docs_note_content WHERE id=45').get()).toEqual({ content: '[Original](/project/41/v/42/docs/44)' })
      db.prepare('INSERT INTO collections_project (public_id,project_name,weight,status,updated_at) VALUES (?, ?, 0, 1, ?)').run(randomUUID(), 'New', '2026-10-30')
      expect(db.prepare('SELECT id,legacy_url_id FROM collections_project WHERE project_name=?').get('New')).toEqual({ id: 100, legacy_url_id: null })
      expect(() => db.prepare('UPDATE collections_project SET public_id=? WHERE id=100').run((db.prepare('SELECT public_id FROM collections_project WHERE id=41').get() as { public_id: string }).public_id)).toThrow()
      expect(db.pragma('foreign_key_check')).toEqual([])
    } finally { db.close() }
  })

  it.each(['sqlite', 'mysql', 'postgresql'])('keeps %s schemas and migrations aligned for all four identities', provider => {
    const schema = readFileSync(`prisma/providers/${provider}/schema.prisma`, 'utf8')
    const sql = readFileSync(`prisma/providers/${provider}/migrations/${migration}/migration.sql`, 'utf8')
    for (const model of ['Project', 'ProjectVersion', 'NoteInfo', 'Article']) {
      const block = schema.match(new RegExp(`model ${model} \\{([\\s\\S]*?)\\n\\}`))![1]
      expect(block).toContain('publicId String @default(uuid(4)) @unique(')
      expect(block).toContain('legacyUrlId Int? @unique(')
    }
    for (const table of tables) {
      expect(sql).toContain(`uq_${table}_public_id`)
      expect(sql).toContain(`uq_${table}_legacy_url_id`)
    }
  })
})
