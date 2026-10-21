import { readFileSync, readdirSync } from 'node:fs'
import Database from 'better-sqlite3'
import { describe, expect, it } from 'vitest'

const migration = '20261021000000_project_menu_icons'

describe('nullable project menu icon migration', () => {
  it.each(['postgresql', 'mysql', 'sqlite'])('%s adds a nullable column without rewriting historical migrations', provider => {
    const sql = readFileSync(`prisma/providers/${provider}/migrations/${migration}/migration.sql`, 'utf8')
    expect(sql).toMatch(/ALTER TABLE ["`]collections_project_menu["`] ADD COLUMN ["`]icon["`]/)
    expect(sql).not.toMatch(/NOT NULL|DROP|DELETE|TRUNCATE|UPDATE/i)
    expect(readFileSync(`prisma/providers/${provider}/schema.prisma`, 'utf8')).toMatch(/icon\s+String\?/)
  })

  it('preserves existing parent/child records and defaults old and new menus to automatic icons', () => {
    const db = new Database(':memory:')
    try {
      db.pragma('foreign_keys=ON')
      for (const name of readdirSync('prisma/providers/sqlite/migrations').filter(name => /^\d/.test(name) && name < migration).sort()) {
        db.exec(readFileSync(`prisma/providers/sqlite/migrations/${name}/migration.sql`, 'utf8'))
      }
      db.exec(`INSERT INTO collections_project(project_name,weight,status) VALUES('Existing',0,1);
        INSERT INTO collections_project_menu(project_id,label) VALUES(1,'Root');
        INSERT INTO collections_project_menu(project_id,parent_id,label) VALUES(1,1,'Child');`)
      db.exec(readFileSync(`prisma/providers/sqlite/migrations/${migration}/migration.sql`, 'utf8'))
      expect(db.prepare('SELECT id,parent_id,icon FROM collections_project_menu ORDER BY id').all()).toEqual([
        { id: 1, parent_id: null, icon: null }, { id: 2, parent_id: 1, icon: null },
      ])
      db.exec("INSERT INTO collections_project_menu(project_id,label) VALUES(1,'New'); UPDATE collections_project_menu SET icon='none' WHERE id=2")
      expect(db.prepare('SELECT icon FROM collections_project_menu ORDER BY id').all()).toEqual([{ icon: null }, { icon: 'none' }, { icon: null }])
      expect(db.pragma('foreign_key_check')).toEqual([])
    } finally { db.close() }
  })
})
