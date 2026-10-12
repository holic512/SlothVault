import { canonicalReleaseManifest, releaseManifestHash } from './release-manifest'
import { describe, expect, it } from 'vitest'

import type { BackupData } from './admin-backup/database-schema'
import { parseDatabaseImportPayload as parse } from './admin-backup/database-validation'
import { DATABASE_BACKUP_VERSION } from './admin-backup/constants'
const parseDatabaseImportPayload = (input: { data: unknown; version?: string; mode?: string }) => parse({ ...input, version: DATABASE_BACKUP_VERSION, mode: 'overwrite' })

const timestamp = '2026-07-19T00:00:00.000Z'

function emptyBackup(): BackupData {
  return {
    commissionInvitations: [], commissionAgreements: [], commissionSubmissions: [], commissionProofAttempts: [],
    commissionTemplates: [], commissionTemplateVersions: [], commissionSettings: [], commissions: [], commissionMilestones: [], commissionPlans: [], commissionFiles: [], commissionChanges: [], commissionDeliveries: [], commissionDeliveryItems: [], commissionPayments: [], commissionIssues: [], commissionAcceptances: [], commissionEvents: [],
    users: [],
    pointTransactions: [],
    giftCardBatches: [],
    giftCards: [],
    membershipLevels: [],
    membershipGrants: [],
    articles: [],
    projects: [
      {
        id: '1',
        projectName: 'project',
        avatar: null,
        weight: 0,
        status: 1,
        requireAuth: false,
        readAccessMode: 'PUBLIC',
        downloadAccessMode: 'FOLLOW_READ',
        readMembershipLevelIds: [],
        downloadMembershipLevelIds: [],
        createdAt: timestamp,
        updatedAt: timestamp,
        isDeleted: false,
      },
    ],
    projectVersions: [],
    categories: [],
    projectMenus: [],
    projectHomes: [],
    noteInfos: [],
    noteContents: [],
    fileManagements: [],
    fileReferences: [],
    systemConfigs: [],
    systemHomepages: [],
    contracts: [],
    contractAdminAudits: [],
    contractCredentials: [],
    contractCredentialAttempts: [],
    releaseCredentials: [],
    releaseCredentialAttempts: [],
  }
}

describe('database backup system branding validation', () => {
  it('retains a system-logo path independently of file record IDs', () => {
    const data = emptyBackup()
    const filePath = 'uploads/system-logo/6e2c5774-3a95-4c34-8ac2-17dc8d7df5cf.png'
    data.fileManagements.push({
      id: '91',
      originalName: 'logo.png',
      fileName: '6e2c5774-3a95-4c34-8ac2-17dc8d7df5cf.png',
      filePath,
      fileSize: '1200',
      businessType: 'SystemLogo',
      status: 1,
      createTime: timestamp,
    })
    data.systemConfigs.push({
      id: '92',
      configKey: 'SYSTEM_LOGO_FILE_PATH',
      configValue: filePath,
      description: 'Optional managed system logo',
      createdAt: timestamp,
      updatedAt: timestamp,
    })

    const parsed = parseDatabaseImportPayload({ data, mode: 'insert' }).data
    expect(parsed.systemConfigs[0].configValue).toBe(parsed.fileManagements[0].filePath)
  })
})

describe('database backup independent article validation', () => {
  it('accepts visible and withdrawn 2.6 articles while rejecting an incomplete publication state', () => {
    const data = emptyBackup()
    data.articles.push({
      id: '40',
      title: 'Independent article',
      summary: null,
      cover: null,
      content: '# Body',
      status: 1,
      requiredMembershipLevelId: null,
    allowedMembershipLevelIds: [],
      publishedAt: timestamp,
      createdAt: timestamp,
      updatedAt: timestamp,
      isDeleted: false,
    })
    expect(parseDatabaseImportPayload({ data, version: '2.6.0' }).data.articles).toHaveLength(1)

    data.articles[0].publishedAt = null
    expect(() => parseDatabaseImportPayload({ data, version: '2.6.0' })).toThrow(/published article/)
  })

  it('rejects article covers outside the managed article-cover directory', () => {
    const data = emptyBackup()
    data.articles.push({
      id: '41',
      title: 'Unsafe cover',
      summary: null,
      cover: 'https://example.com/cover.png',
      content: '# Body',
      status: 0,
      requiredMembershipLevelId: null,
    allowedMembershipLevelIds: [],
      publishedAt: null,
      createdAt: timestamp,
      updatedAt: timestamp,
      isDeleted: false,
    })

    expect(() => parseDatabaseImportPayload({ data, version: '2.6.0' })).toThrow(/article-cover/)
  })
})

describe('database backup membership validation', () => {
  it('accepts levels, grants, and member-only article references as one relation-closed snapshot', () => {
    const data = emptyBackup()
    data.users.push({
      id: '7', username: 'admin', password: 'hash', passwordConfigured: true,
      email: null, displayName: null, avatar: null, bio: null, role: 'ADMIN',
      status: 1, pointsBalance: 20, walletAddress: null, lastLoginAt: null,
      createdAt: timestamp, updatedAt: timestamp,
    })
    data.membershipLevels.push({
      id: '11', name: 'VIP', rank: 1, pricePoints: 10, validityDays: 30,
      status: 1, createdAt: timestamp, updatedAt: timestamp,
    })
    data.membershipGrants.push({
      id: '12', userId: '7', membershipLevelId: '11', source: 'POINT_PURCHASE',
      pointsCost: 10, grantedByUserId: null, grantedAt: timestamp,
      expiresAt: '2026-08-20T00:00:00.000Z', revokedAt: null, revokedByUserId: null,
    })
    data.articles.push({
      id: '13', title: 'Member article', summary: null, cover: null, content: '# Body',
      status: 1, requiredMembershipLevelId: '11', allowedMembershipLevelIds: [], publishedAt: timestamp,
      createdAt: timestamp, updatedAt: timestamp, isDeleted: false,
    })

    const parsed = parseDatabaseImportPayload({ data, version: '2.7.0' }).data
    expect(parsed.membershipGrants[0].membershipLevelId).toBe('11')
    expect(parsed.articles[0].requiredMembershipLevelId).toBe('11')

    parsed.membershipLevels.push({ ...parsed.membershipLevels[0], id: '14' })
    expect(() => parseDatabaseImportPayload({ data: parsed, version: '2.7.0' })).toThrow(/membershipLevel rank/)
  })
})

describe('database backup release validation', () => {
  it('round-trips note-content evidence identity and validates its parent version', () => {
    const data = emptyBackup()
    const evidenceId = '61785fd5-b940-48ae-9300-06c05dd49686'
    data.users.push({
      id: '7', username: 'admin', password: 'hash', passwordConfigured: true,
      email: null, displayName: null, avatar: null, bio: null, role: 'ADMIN',
      status: 1, pointsBalance: 0, walletAddress: null, lastLoginAt: null,
      createdAt: timestamp, updatedAt: timestamp,
    })
    data.projectVersions.push({
      id: '2', projectId: '1', version: 'published', description: null, weight: 1, status: 1,
      releaseId: 'b98bce11-168d-4d74-bfc0-975e083c3fe3', ...snapshot('published'), manifestVersion: 3, publishedAt: timestamp,
      createdAt: timestamp, updatedAt: timestamp, isDeleted: false,
    })
    data.categories.push({
      id: '3', projectVersionId: '2', categoryName: 'Guides', weight: 0, status: 1,
      createdAt: timestamp, updatedAt: timestamp, isDeleted: false,
    })
    data.noteInfos.push({
      id: '4', categoryId: '3', authorId: '7', noteTitle: 'Start', tags: [], weight: 0, status: 1,
      createdAt: timestamp, updatedAt: timestamp, isDeleted: false,
    })
    data.noteContents.push({
      id: '5', noteInfoId: '4', evidenceId, content: '# Start', versionNote: 'v1',
      isPrimary: true, status: 1, createdAt: timestamp, updatedAt: timestamp, isDeleted: false,
    })
    const parsed = parseDatabaseImportPayload({ data, version: '2.5.0' })
    expect(parsed.data.noteContents[0].evidenceId).toBe(evidenceId)
    expect(parsed.data.releaseCredentials).toEqual([])

    parsed.data.categories[0].projectVersionId = '999'
    expect(() => parseDatabaseImportPayload({ data: parsed.data, version: '2.5.0' })).toThrow(/projectVersionId/)
  })

})

describe('content manifest v3 backup contract', () => {
  it('allows repeated body hashes and keeps release IDs unique', () => {
    const data = emptyBackup()
    data.projectVersions = [1, 2].map(id => ({
      id: String(id), projectId: '1', version: `v${id}`, description: null, weight: 0,
      status: 1, releaseId: `550e8400-e29b-41d4-a716-44665544000${id}`,
      ...snapshot(`v${id}`), manifestVersion: 3, publishedAt: timestamp,
      createdAt: timestamp, updatedAt: timestamp, isDeleted: false,
    }))
    expect(parseDatabaseImportPayload({ data, version: '2.7.0' }).data.projectVersions).toHaveLength(2)
    data.projectVersions[1].releaseId = data.projectVersions[0].releaseId
    expect(() => parseDatabaseImportPayload({ data, version: '2.7.0' })).toThrow(/releaseId/)
  })
})

function snapshot(version: string) {
  const releaseManifestJson = canonicalReleaseManifest({ schema: 3, projectName: 'project', version, contentHash: 'a'.repeat(64) })
  return { releaseManifestJson, releaseHash: releaseManifestHash(releaseManifestJson) }
}

describe('current database format', () => {
  it('rejects old versions, insert operations, and omitted collections', () => {
    const data = emptyBackup()
    expect(() => parse({ data, mode: 'overwrite', version: '2.12.0' })).toThrow()
    expect(() => parse({ data, mode: 'insert', version: DATABASE_BACKUP_VERSION })).toThrow()
    Reflect.deleteProperty(data, 'commissionEvents')
    expect(() => parse({ data, mode: 'overwrite', version: DATABASE_BACKUP_VERSION })).toThrow(/missing a collection/)
  })
  it('requires explicit access policies rather than widening missing permissions', () => {
    const data = emptyBackup()
    Reflect.deleteProperty(data.projects[0], 'readAccessMode')
    expect(() => parseDatabaseImportPayload({ data })).toThrow(/access policy/)
  })
})
