import { describe, expect, it } from 'vitest'
import { backupCompatibility, requireBackupCompatibility } from './compatibility'
import { DATABASE_BACKUP_VERSION } from './constants'

describe('portable backup version compatibility', () => {
  it('admits the current data contract independently of app releases and database revisions', () => {
    const source = { formatVersion: 2, databaseVersion: DATABASE_BACKUP_VERSION, appVersion: '1.0.0', schemaRevision: 1 }
    expect(backupCompatibility(source)).toMatchObject({ status: 'current', reason: null, sourceVersion: DATABASE_BACKUP_VERSION, targetVersion: DATABASE_BACKUP_VERSION })
    expect(requireBackupCompatibility(source).collectionKeys).toContain('users')
  })
  it.each(['2.12.0', '2.14.0', 'unknown', ''])('requires an explicit conversion rule for data version %s', (databaseVersion) => {
    const source = { formatVersion: 2, databaseVersion }
    expect(backupCompatibility(source)).toMatchObject({ status: 'unsupported', reason: 'data-version', sourceVersion: databaseVersion })
    expect(() => requireBackupCompatibility(source)).toThrow('Unsupported backup')
  })
  it('distinguishes an unsupported archive format from an unsupported data version', () => {
    expect(backupCompatibility({ formatVersion: 1, databaseVersion: DATABASE_BACKUP_VERSION })).toMatchObject({ status: 'unsupported', reason: 'format' })
  })
})
