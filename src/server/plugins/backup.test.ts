import { readFileSync } from 'node:fs'
import { describe, expect, it } from 'vitest'
import { z } from 'zod'
import { pluginManifestSchema } from '@slothvault/plugin-sdk/protocol'
import { pluginBackupShape, validatePluginBackup } from './backup'
import { physicalTableName } from './database'
const manifest = pluginManifestSchema.parse(JSON.parse(readFileSync('plugins/example/plugin.json', 'utf8')))
const now = '2026-10-16T00:00:00.000Z'
function fixture() {
  return { ...z.object(pluginBackupShape).parse({
    pluginInstallations: [{ id: '1', pluginId: manifest.id, version: manifest.version, digest: 'a'.repeat(64), manifestJson: JSON.stringify(manifest), configCiphertext: '', installed: true, enabled: false, generation: 1, source: null, error: null, createdAt: now, updatedAt: now }],
    pluginTables: manifest.tables.map((table, index) => ({ id: String(index+1), pluginId: manifest.id, name: physicalTableName(manifest.id, table), descriptorJson: JSON.stringify(table) })),
    pluginRows: [{ id: '1', pluginId: manifest.id, tableName: physicalTableName(manifest.id, manifest.tables[0]), rowJson: JSON.stringify({ id: 'first', value: 1 }) }],
  }), users: [{ id: '1' }] }
}
describe('portable plugin backup preflight', () => {
  it('accepts owned portable rows without loading plugin code', () => expect(() => validatePluginBackup(fixture())).not.toThrow())
  it('never silently omits rows in undeclared or foreign tables', () => {
    const data = fixture(); data.pluginRows.push({ ...data.pluginRows[0], id: '2', tableName: 'svp_unknown_table' })
    expect(() => validatePluginBackup(data)).toThrow('Unknown plugin table')
  })
  it('rejects duplicate primary keys and invalid scalar types before creating staging tables', () => {
    const duplicate = fixture(); duplicate.pluginRows.push({ ...duplicate.pluginRows[0], id: '2' })
    expect(() => validatePluginBackup(duplicate)).toThrow('Duplicate')
    const invalid = fixture(); invalid.pluginRows[0].rowJson = JSON.stringify({ id: 'first', value: false })
    expect(() => validatePluginBackup(invalid)).toThrow('Invalid portable')
  })
  it('preserves detached financial receipts but rejects dangling or duplicate ones', () => {
    const data = fixture()
    data.pluginPointReceipts.push({ id: '1', pluginId: manifest.id, sourceKey: 'stable', userId: null, amount: 1, balanceAfter: 1, createdAt: now })
    expect(() => validatePluginBackup(data)).not.toThrow()
    data.pluginPointReceipts[0].userId = '2'
    expect(() => validatePluginBackup(data)).toThrow('receipt')
    data.pluginPointReceipts[0].userId = '1'; data.pluginPointReceipts.push({ ...data.pluginPointReceipts[0], id: '2' })
    expect(() => validatePluginBackup(data)).toThrow('receipt')
  })
})
