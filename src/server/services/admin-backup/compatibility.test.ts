import { describe, expect, it } from 'vitest'
import { backupCompatibility, requireBackupCompatibility } from './compatibility'
import { DATABASE_BACKUP_VERSION } from './constants'

describe('portable backup version compatibility', () => {
  it('admits the current data contract independently of app releases and database revisions', () => {
    const source = { formatVersion: 2, databaseVersion: DATABASE_BACKUP_VERSION, appVersion: '1.0.0', schemaRevision: 1 }
    expect(backupCompatibility(source)).toMatchObject({ status: 'current', reason: null, sourceVersion: DATABASE_BACKUP_VERSION, targetVersion: DATABASE_BACKUP_VERSION })
    expect(requireBackupCompatibility(source).collectionKeys).toContain('users')
  })
  it('registers a strict source schema for 2.13.0 before converting attribution', () => {
    const adapter = requireBackupCompatibility({ formatVersion: 2, databaseVersion: '2.13.0' })
    expect(backupCompatibility({ formatVersion: 2, databaseVersion: '2.13.0' }).status).toBe('convertible')
    expect(adapter.collectionKeys).not.toContain('userDeletionRecords')
    const row = { id: '1', name: 'Old', points: 1, quantity: 1, status: 1, createdById: '2', expiresAt: null, createdAt: '2026-10-13T00:00:00Z', updatedAt: '2026-10-13T00:00:00Z' }
    expect(adapter.parseRow('giftCardBatches', row)).toEqual(row)
    expect(() => adapter.parseRow('giftCardBatches', { ...row, createdById: null })).toThrow()
    expect(() => adapter.parseRow('giftCardBatches', { ...row, attributionJson: '{}' })).toThrow()
  })
  it.each(['2.12.0', '2.15.0', 'unknown', ''])('requires an explicit conversion rule for data version %s', (databaseVersion) => {
    const source = { formatVersion: 2, databaseVersion }
    expect(backupCompatibility(source)).toMatchObject({ status: 'unsupported', reason: 'data-version', sourceVersion: databaseVersion })
    expect(() => requireBackupCompatibility(source)).toThrow('Unsupported backup')
  })
  it('distinguishes an unsupported archive format from an unsupported data version', () => {
    expect(backupCompatibility({ formatVersion: 1, databaseVersion: DATABASE_BACKUP_VERSION })).toMatchObject({ status: 'unsupported', reason: 'format' })
  })
})
