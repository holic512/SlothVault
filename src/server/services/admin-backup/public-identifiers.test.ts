import { randomUUID } from 'node:crypto'
import { mkdtempSync, rmSync } from 'node:fs'
import { tmpdir } from 'node:os'
import { join } from 'node:path'
import { describe, expect, it } from 'vitest'
import { requireBackupCompatibility } from './compatibility'
import { DATABASE_BACKUP_VERSION } from './constants'
import { parseBackupRow } from './database-export'
import { parseDatabaseImportPayload } from './database-validation'
import { prePublicIdDataSchema, publicIdentityCollections } from './legacy-v2-20'
import { RecordStore } from './record-store'

const timestamp = '2026-10-21T00:00:00Z'
function legacyData(version = '2.20.0') {
  const data = prePublicIdDataSchema.parse({
    projects: [{ id: '1', projectName: 'Project', avatar: null, weight: 0, status: 1, requireAuth: false, readAccessMode: 'PUBLIC', downloadAccessMode: 'FOLLOW_READ', readMembershipLevelIds: [], downloadMembershipLevelIds: [], createdAt: timestamp, updatedAt: timestamp, isDeleted: false }],
    projectVersions: [{ id: '2', projectId: '1', version: '1.0', description: null, weight: 0, status: 0, createdAt: timestamp, updatedAt: timestamp, isDeleted: false }],
    categories: [{ id: '3', projectVersionId: '2', categoryName: 'Guide', weight: 0, status: 1, createdAt: timestamp, updatedAt: timestamp, isDeleted: false }],
    noteInfos: [{ id: '4', categoryId: '3', attributionJson: '{}', noteTitle: 'Guide', weight: 0, status: 1, createdAt: timestamp, updatedAt: timestamp, isDeleted: false }],
    noteContents: [{ id: '6', noteInfoId: '4', content: '[Old link](/project/1/v/2/docs/4)\n', versionNote: null, isPrimary: true, status: 1, createdAt: timestamp, updatedAt: timestamp, isDeleted: false }],
    articles: [{ id: '5', title: 'Article', summary: null, cover: null, content: '# Source bytes', status: 0, allowedMembershipLevelIds: [], publishedAt: null, createdAt: timestamp, updatedAt: timestamp, isDeleted: false }],
    projectMenus: [{ id: '7', projectId: '1', parentId: null, label: 'Guide', icon: 'github', url: null, isExternal: false, weight: 0, status: 1, createdAt: timestamp, updatedAt: timestamp, isDeleted: false }],
    projectHomes: [], fileManagements: [], systemConfigs: [], systemHomepages: [],
  }) as Record<string, Array<Record<string, unknown>>>
  if (version <= '2.18.0') delete data.projectMenus[0].icon
  if (version <= '2.15.0') delete data.projectVersions[0].documentationStateJson
  if (version <= '2.14.0') delete data.userWallets
  if (version === '2.13.0') { delete data.userDeletionRecords; delete data.noteInfos[0].attributionJson }
  if (version <= '2.16.0') for (const key of Object.keys(data)) if (key.startsWith('plugin')) delete data[key]
  return data
}

describe('public identities in portable backups', () => {
  it.each(['2.13.0', '2.14.0', '2.15.0', '2.16.0', '2.17.0', '2.18.0', '2.19.0', '2.20.0'])('converts strict %s JSON and NDJSON sources without changing source bytes', version => {
    const source = legacyData(version), original = JSON.stringify(source)
    const converted = parseDatabaseImportPayload({ version, mode: 'overwrite', data: source })
    expect(converted.version).toBe(DATABASE_BACKUP_VERSION)
    for (const key of publicIdentityCollections) {
      expect(converted.data[key][0].publicId).toMatch(/^[0-9a-f]{8}-[0-9a-f]{4}-4[0-9a-f]{3}-[89ab][0-9a-f]{3}-[0-9a-f]{12}$/)
      expect(converted.data[key][0].legacyUrlId).toBe(source[key][0].id)
    }
    expect(converted.data.noteContents[0].content).toBe(source.noteContents[0].content)
    expect(converted.data.projectMenus[0].icon).toBe(version <= '2.18.0' ? null : 'github')
    expect(JSON.stringify(source)).toBe(original)
    const adapter = requireBackupCompatibility({ formatVersion: 2, databaseVersion: version })
    const directory = mkdtempSync(join(tmpdir(), 'sv-public-id-backup-')), store = new RecordStore(join(directory, 'index.sqlite'))
    try {
      for (const [key, rows] of Object.entries(source)) for (const row of rows) store.put(key, adapter.parseRow(key, row))
      const payload = adapter.toCurrentPayload(store)
      for (const key of publicIdentityCollections) {
        const identity = payload.data[key][0]
        expect(identity.legacyUrlId).toBe(source[key][0].id)
        expect(parseBackupRow(key, identity)).toMatchObject({ publicId: identity.publicId })
        expect(() => adapter.parseRow(key, { ...source[key][0], publicId: randomUUID(), legacyUrlId: null })).toThrow()
      }
      expect(payload.data.projectMenus[0].icon).toBe(version <= '2.18.0' ? null : 'github')
      expect(payload.data.noteContents[0].content).toBe(source.noteContents[0].content)
    } finally { store.close(); rmSync(directory, { recursive: true, force: true }) }
    expect(() => parseDatabaseImportPayload({ version, mode: 'overwrite', data: { ...source, projects: [{ ...source.projects[0], publicId: randomUUID(), legacyUrlId: null }] } })).toThrow()
  })

  it.each(publicIdentityCollections)('requires unique, canonical current public identities in %s', key => {
    const current = () => parseDatabaseImportPayload({ version: '2.20.0', mode: 'overwrite', data: legacyData() })
    const missing = current(); Reflect.deleteProperty(missing.data[key][0], 'publicId')
    expect(() => parseDatabaseImportPayload(missing)).toThrow()
    const missingAlias = current(); Reflect.deleteProperty(missingAlias.data[key][0], 'legacyUrlId')
    expect(() => parseDatabaseImportPayload(missingAlias)).toThrow()
    for (const publicId of ['1', randomUUID().toUpperCase(), '00000000-0000-7000-8000-000000000000']) {
      const malformed = current(); malformed.data[key][0].publicId = publicId
      expect(() => parseDatabaseImportPayload(malformed)).toThrow()
    }
    const duplicate = current(); duplicate.data[key].push({ ...duplicate.data[key][0], id: '99' } as never)
    expect(() => parseDatabaseImportPayload(duplicate)).toThrow(/publicId/)
    duplicate.data[key][1].publicId = randomUUID()
    expect(() => parseDatabaseImportPayload(duplicate)).toThrow(/legacyUrlId/)
    duplicate.data[key][0].legacyUrlId = null; duplicate.data[key][1].legacyUrlId = null
    expect(() => parseDatabaseImportPayload(duplicate)).not.toThrow()
  })
})
