/**
 * @file reset-commission-test-data.mjs
 * @project SlothVault
 * @module Explicit Commission Test Data Rebuild
 * @description Backs up and rebuilds explicitly selected legacy SQLite test commissions as new workflow drafts.
 * @logic Refuse a running app, require exact IDs, retain contracts and files, back up before a bounded transaction, and never run from startup.
 * @dependencies better-sqlite3, node filesystem and crypto
 * @index_tags commissions,backup,reset,one-shot,sqlite
 * @author holic512
 */
import Database from 'better-sqlite3'
import { createHash, randomUUID } from 'node:crypto'
import { chmodSync, copyFileSync, existsSync, mkdirSync, readFileSync, realpathSync, writeFileSync } from 'node:fs'
import { dirname, isAbsolute, relative, resolve, sep } from 'node:path'
import { pathToFileURL } from 'node:url'

export async function rebuildCommissionTestData({ dataRoot, commissionIds, templateIds, execute = false }) {
  if (!commissionIds.length || [...commissionIds, ...templateIds].some((id) => !Number.isSafeInteger(id) || id < 1)) throw new Error('Explicit positive commission/template IDs are required')
  if (new Set(commissionIds).size !== commissionIds.length || new Set(templateIds).size !== templateIds.length) throw new Error('IDs must not repeat')
  const root = resolve(dataRoot), databasePath = resolve(root, 'database/slothvault.db')
  const lock = `${databasePath}.instance.lock`
  if (execute && existsSync(lock)) {
    const { pid } = JSON.parse(readFileSync(lock, 'utf8'))
    if (!Number.isSafeInteger(pid) || pid < 1) throw new Error('Invalid app instance lock')
    try { process.kill(pid, 0); throw new Error('Stop the running application before rebuilding test data') } catch (error) { if (error.code !== 'ESRCH') throw error }
  }
  const db = new Database(databasePath, { readonly: !execute })
  db.pragma('foreign_keys = ON')
  const placeholders = (ids) => ids.map(() => '?').join(',')
  const commissions = () => db.prepare(`SELECT * FROM commission WHERE id IN (${placeholders(commissionIds)}) ORDER BY id`).all(...commissionIds)
  const selected = commissions()
  try {
    if (selected.length !== commissionIds.length || selected.some((row) => row.workflow_version !== 1)) throw new Error('Selection must contain only existing legacy test commissions; completed resets cannot be repeated')
    if (db.prepare(`SELECT count(*) n FROM contract WHERE commission_id IN (${placeholders(commissionIds)})`).get(...commissionIds).n) throw new Error('Selected commissions contain contracts; preserve them as read-only history')
    for (const table of ['commission_submission', 'commission_agreement', 'commission_invitation']) {
      if (db.prepare(`SELECT count(*) n FROM ${table} WHERE commission_id IN (${placeholders(commissionIds)})`).get(...commissionIds).n) throw new Error('Selection contains new workflow data')
    }
    for (const id of templateIds) {
      if (!db.prepare('SELECT id FROM commission_contract_template WHERE id=?').get(id)) throw new Error('Selected template does not exist')
      if (db.prepare("SELECT count(*) n FROM commission_contract_template_version WHERE template_id=? AND format <> 'LEGACY'").get(id).n || db.prepare('SELECT count(*) n FROM contract c JOIN commission_contract_template_version v ON v.id=c.template_version_id WHERE v.template_id=?').get(id).n) throw new Error('Selected template has current versions or retained contracts')
    }
    const selectionHash = createHash('sha256').update(JSON.stringify(selected)).digest('hex')
    if (!execute) return { dryRun: true, commissionIds, templateIds, selectionHash, action: 'Back up, remove only selected legacy records, recreate commission drafts; retain all file metadata and bytes' }
    const backup = resolve(root, 'backups', `commission-rebuild-${new Date().toISOString().replaceAll(':', '-')}-${randomUUID().slice(0, 8)}`)
    mkdirSync(backup, { recursive: true, mode: 0o700 })
    await db.backup(resolve(backup, 'database.sqlite'))
    chmodSync(resolve(backup, 'database.sqlite'), 0o600)
    const attachments = db.prepare(`SELECT f.* FROM files_file_management f JOIN commission_file cf ON cf.file_id=f.id WHERE cf.commission_id IN (${placeholders(commissionIds)})`).all(...commissionIds)
    for (const file of attachments) {
      const path = realpathSync(resolve(root, file.file_path)), rel = relative(realpathSync(root), path)
      if (isAbsolute(rel) || rel === '..' || rel.startsWith(`..${sep}`) || !rel.startsWith(`uploads${sep}`)) throw new Error('Attachment path escapes private uploads')
      const destination = resolve(backup, rel)
      mkdirSync(dirname(destination), { recursive: true, mode: 0o700 }); copyFileSync(path, destination); chmodSync(destination, 0o600)
    }
    const manifest = { protocol: 'slothvault.commission-test-rebuild', version: 1, commissionIds, templateIds, selectionHash, createdAt: new Date().toISOString(), status: 'BACKED_UP', createdIds: [] }
    const persist = () => writeFileSync(resolve(backup, 'manifest.json'), JSON.stringify(manifest, null, 2), { mode: 0o600 })
    persist()
    db.transaction(() => {
      if (createHash('sha256').update(JSON.stringify(commissions())).digest('hex') !== selectionHash) throw new Error('Selection changed after backup')
      db.prepare(`DELETE FROM commission_delivery_item WHERE delivery_id IN (SELECT id FROM commission_delivery WHERE commission_id IN (${placeholders(commissionIds)}))`).run(...commissionIds)
      for (const table of ['commission_acceptance', 'commission_issue', 'commission_payment', 'commission_change', 'commission_delivery', 'commission_file', 'commission_payment_plan', 'commission_milestone', 'commission_event']) db.prepare(`DELETE FROM ${table} WHERE commission_id IN (${placeholders(commissionIds)})`).run(...commissionIds)
      db.prepare(`DELETE FROM commission WHERE id IN (${placeholders(commissionIds)})`).run(...commissionIds)
      for (const id of templateIds) { db.prepare('DELETE FROM commission_contract_template_version WHERE template_id=?').run(id); db.prepare('DELETE FROM commission_contract_template WHERE id=?').run(id) }
      for (const row of selected) {
        const result = db.prepare("INSERT INTO commission (commission_id,subject_user_id,title,purpose,requirements,stage,workflow_version,maintenance_days) VALUES (?,?,?,'',?,'DRAFT',2,15)").run(`SV-${randomUUID()}`, row.subject_user_id, row.title, row.requirements)
        manifest.createdIds.push(Number(result.lastInsertRowid))
      }
      if (db.pragma('foreign_key_check').length) throw new Error('Foreign key verification failed')
    }).immediate()
    manifest.status = 'COMPLETE'; persist()
    return { backup, removedIds: commissionIds, createdDraftIds: manifest.createdIds, removedTemplateIds: templateIds }
  } finally { db.close() }
}
if (process.argv[1] && import.meta.url === pathToFileURL(resolve(process.argv[1])).href) {
  const args = process.argv.slice(2)
  const value = (key) => args.find((arg) => arg.startsWith(`${key}=`))?.slice(key.length + 1)
  const ids = (key) => value(key)?.split(',').map(Number) || []
  console.log(JSON.stringify(await rebuildCommissionTestData({ dataRoot: value('--data-root') || 'data', commissionIds: ids('--commissions'), templateIds: ids('--templates'), execute: args.includes('--execute') }), null, 2))
}
