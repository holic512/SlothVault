import { describe, expect, it } from 'vitest'
import Database from 'better-sqlite3'
import { mkdtempSync, mkdirSync, readdirSync, readFileSync, rmSync } from 'node:fs'
import { tmpdir } from 'node:os'
import { resolve } from 'node:path'
import { rebuildCommissionTestData } from './reset-commission-test-data.mjs'
describe('explicit commission test data rebuild', () => {
  it('backs up first, scopes deletion and recreates only selected legacy drafts', async () => {
    const root = mkdtempSync(resolve(tmpdir(), 'sv-commission-reset-'))
    mkdirSync(resolve(root, 'database'))
    const path = resolve(root, 'database/slothvault.db'), db = new Database(path)
    try {
      for (const dir of readdirSync('prisma/providers/sqlite/migrations').filter((v) => /^\d/.test(v)).sort()) db.exec(readFileSync(`prisma/providers/sqlite/migrations/${dir}/migration.sql`, 'utf8'))
      db.exec("INSERT INTO auth_user (id,username,password,role) VALUES(1,'test-user','test-only','USER'); INSERT INTO commission(id,commission_id,subject_user_id,title,purpose,requirements) VALUES(1,'old-1',1,'test','','requirements'),(2,'keep-2',1,'keep','','keep');")
      const result = await rebuildCommissionTestData({ dataRoot: root, commissionIds: [1], templateIds: [], execute: true })
      expect(db.prepare('SELECT count(*) n FROM auth_user').get().n).toBe(1)
      expect(db.prepare('SELECT commission_id FROM commission WHERE id=2').get().commission_id).toBe('keep-2')
      expect(db.prepare('SELECT stage,workflow_version,maintenance_days FROM commission WHERE id=?').get(result.createdDraftIds[0])).toEqual({ stage: 'DRAFT', workflow_version: 2, maintenance_days: 15 })
      const backup = new Database(resolve(result.backup, 'database.sqlite'), { readonly: true })
      expect(backup.prepare('SELECT commission_id FROM commission WHERE id=1').get().commission_id).toBe('old-1'); backup.close()
      await expect(rebuildCommissionTestData({ dataRoot: root, commissionIds: [1], templateIds: [], execute: true })).rejects.toThrow('existing legacy')
      db.exec("INSERT INTO contract(contract_id,issuer_user_id,subject_user_id,title,body,body_hash,party_commitment,commission_id) VALUES('history',1,1,'retain','body','hash','party',2)")
      await expect(rebuildCommissionTestData({ dataRoot: root, commissionIds: [2], templateIds: [], execute: true })).rejects.toThrow('read-only history')
    } finally { db.close(); rmSync(root, { recursive: true, force: true }) }
  })
})
