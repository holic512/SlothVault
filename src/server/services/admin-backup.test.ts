import { describe, expect, it } from 'vitest'

import {
  type BackupData,
  parseDatabaseImportPayload,
} from '@/server/services/admin-backup'

const timestamp = '2026-07-19T00:00:00.000Z'

function backupWithReservation(options: {
  remainingCapacity?: string
  capacityReserved?: boolean
  cnftStatus?: -1 | 0 | 1
} = {}): BackupData {
  return {
    users: [],
    pointTransactions: [],
    giftCardBatches: [],
    giftCards: [],
    projects: [
      {
        id: '1',
        projectName: 'project',
        avatar: null,
        weight: 0,
        status: 1,
        requireAuth: false,
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
    systemConfigs: [],
    systemHomepages: [],
    contracts: [],
    contractAdminAudits: [],
    contractCredentials: [],
    contractCredentialAttempts: [],
    releaseCredentials: [],
    releaseCredentialAttempts: [],
    merkleTrees: [
      {
        id: '10',
        name: 'tree',
        treeAddress: 'tree-address',
        treeAuthority: 'tree-authority',
        encryptedKey: 'test-only',
        creatorAddress: 'creator-address',
        maxDepth: 4,
        maxBufferSize: 8,
        canopyDepth: 2,
        network: 'devnet',
        totalMinted: 2,
        maxCapacity: '10',
        ...(options.remainingCapacity === undefined
          ? {}
          : { remainingCapacity: options.remainingCapacity }),
        creationCost: '1',
        txSignature: null,
        priority: 1,
        status: 1,
        createdAt: timestamp,
        updatedAt: timestamp,
        isDeleted: false,
      },
    ],
    compressedNfts: [
      {
        id: '20',
        merkleTreeId: '10',
        projectId: '1',
        assetId: 'pending-test',
        leafIndex: -1,
        name: 'pending',
        symbol: null,
        description: null,
        metadataUri: null,
        imageCid: null,
        metadataCid: null,
        originalImageId: null,
        ownerAddress: 'owner-address',
        mintTxSignature: null,
        prepareExpiresAt: null,
        lastValidBlockHeight: null,
        ...(options.capacityReserved === undefined
          ? {}
          : { capacityReserved: options.capacityReserved }),
        status: options.cnftStatus ?? 0,
        createdAt: timestamp,
        updatedAt: timestamp,
      },
    ],
  }
}

describe('database backup legacy cNFT compatibility', () => {
  it('accepts legacy Tree/cNFT collections for explicit ignore handling', () => {
    const parsed = parseDatabaseImportPayload({
      data: backupWithReservation(),
      mode: 'insert',
    })
    expect(parsed.data.merkleTrees[0].remainingCapacity).toBeUndefined()
    expect(parsed.data.compressedNfts[0].capacityReserved).toBeUndefined()
  })

  it('does not apply removed Tree capacity rules to legacy data', () => {
    const parsed = parseDatabaseImportPayload({
      data: backupWithReservation({ remainingCapacity: '9', capacityReserved: false }),
    })
    expect(parsed.data.merkleTrees).toHaveLength(1)
    expect(parsed.data.compressedNfts).toHaveLength(1)
  })

  it('continues accepting legacy rows even when their historical allocation is inconsistent', () => {
    const data = backupWithReservation({ remainingCapacity: '0' })
    data.merkleTrees[0].maxCapacity = '1'
    data.merkleTrees[0].totalMinted = 1
    data.compressedNfts.push({
      ...data.compressedNfts[0],
      id: '21',
      assetId: 'pending-test-2',
    })

    expect(() => parseDatabaseImportPayload({ data, version: '2.1.0' })).not.toThrow()
  })
})

describe('database backup system branding compatibility', () => {
  it('retains a system-logo path independently of file record IDs', () => {
    const data = backupWithReservation()
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

describe('database backup release compatibility', () => {
  it('round-trips note-content evidence identity and validates its parent version', () => {
    const data = backupWithReservation()
    const evidenceId = '61785fd5-b940-48ae-9300-06c05dd49686'
    data.users.push({
      id: '7', username: 'admin', password: 'hash', passwordConfigured: true,
      email: null, displayName: null, avatar: null, bio: null, role: 'ADMIN',
      status: 1, pointsBalance: 0, walletAddress: null, lastLoginAt: null,
      createdAt: timestamp, updatedAt: timestamp,
    })
    data.projectVersions.push({
      id: '2', projectId: '1', version: 'published', description: null, weight: 1, status: 1,
      releaseId, releaseHash: 'a'.repeat(64), manifestVersion: 1, publishedAt: timestamp,
      createdAt: timestamp, updatedAt: timestamp, isDeleted: false,
    })
    data.categories.push({
      id: '3', projectVersionId: '2', categoryName: 'Guides', weight: 0, status: 1,
      createdAt: timestamp, updatedAt: timestamp, isDeleted: false,
    })
    data.noteInfos.push({
      id: '4', categoryId: '3', authorId: '7', noteTitle: 'Start', weight: 0, status: 1,
      createdAt: timestamp, updatedAt: timestamp, isDeleted: false,
    })
    data.noteContents.push({
      id: '5', noteInfoId: '4', evidenceId, content: '# Start', versionNote: 'v1',
      isPrimary: true, status: 1, createdAt: timestamp, updatedAt: timestamp, isDeleted: false,
    })
    data.releaseCredentials.push({
      id: '30', projectVersionId: '2', noteContentId: '5', issuerUserId: '7',
      subjectType: 'NOTE_CONTENT', subjectId: evidenceId, subjectHash: 'b'.repeat(64),
      subjectManifestVersion: 1, network: 'devnet', signerAddress: '11111111111111111111111111111111',
      memo: '{}', transactionSignature: null, status: 0, slot: null, blockTime: null,
      feeLamports: null, finalizedAt: null, lastVerifiedAt: null, createdAt: timestamp, updatedAt: timestamp,
    })

    const parsed = parseDatabaseImportPayload({ data, version: '2.5.0' })
    expect(parsed.data.noteContents[0].evidenceId).toBe(evidenceId)
    expect(parsed.data.releaseCredentials[0]).toMatchObject({
      subjectType: 'NOTE_CONTENT', subjectId: evidenceId, noteContentId: '5',
    })

    parsed.data.categories[0].projectVersionId = '999'
    expect(() => parseDatabaseImportPayload({ data: parsed.data, version: '2.5.0' })).toThrow(/projectVersionId/)
  })

  it('accepts a 2.2 credential and its attempt', () => {
    const data = backupWithReservation()
    data.users.push({
      id: '7', username: 'admin', password: 'hash', passwordConfigured: true,
      email: null, displayName: null, avatar: null, bio: null, role: 'ADMIN',
      status: 1, pointsBalance: 0, walletAddress: null, lastLoginAt: null,
      createdAt: timestamp, updatedAt: timestamp,
    })
    data.projectVersions.push({
      id: '2', projectId: '1', version: 'v2.2', description: null, weight: 1, status: 1,
      releaseId, releaseHash: 'a'.repeat(64), manifestVersion: 1, publishedAt: timestamp,
      createdAt: timestamp, updatedAt: timestamp, isDeleted: false,
    })
    data.releaseCredentials.push({
      id: '30', projectVersionId: '2', noteContentId: null, issuerUserId: '7',
      subjectType: 'PROJECT_VERSION', subjectId: null, subjectHash: null,
      subjectManifestVersion: null, network: 'devnet',
      signerAddress: '11111111111111111111111111111111', memo: '{}',
      transactionSignature: null, status: 0, slot: null, blockTime: null,
      feeLamports: null, finalizedAt: null, lastVerifiedAt: null,
      createdAt: timestamp, updatedAt: timestamp,
    })
    data.releaseCredentialAttempts.push({
      id: '31', credentialId: '30', issuerUserId: '7',
      signerAddress: '11111111111111111111111111111111', memo: '{}',
      messageHash: 'b'.repeat(64), recentBlockhash: '11111111111111111111111111111111',
      lastValidBlockHeight: '100', transactionSignature: null, status: 0,
      failureCode: null, failureMessage: null, expiresAt: timestamp,
      submittedAt: null, finalizedAt: null, createdAt: timestamp, updatedAt: timestamp,
    })
    expect(parseDatabaseImportPayload({ data, version: '2.2.0' }).data.releaseCredentialAttempts).toHaveLength(1)
  })

  it('forces legacy 2.0 project versions to drafts', () => {
    const data = backupWithReservation()
    data.projectVersions.push({
      id: '2',
      projectId: '1',
      version: 'legacy',
      description: null,
      weight: 1,
      status: 1,
      releaseId: null,
      releaseHash: null,
      manifestVersion: null,
      publishedAt: null,
      createdAt: timestamp,
      updatedAt: timestamp,
      isDeleted: false,
    })

    const parsed = parseDatabaseImportPayload({ data, version: '2.0.0' })
    expect(parsed.data.projectVersions[0]).toMatchObject({
      status: 0,
      releaseId: null,
      releaseHash: null,
      manifestVersion: null,
      publishedAt: null,
    })
  })

  it('rejects partial 2.1 release metadata', () => {
    const data = backupWithReservation()
    data.projectVersions.push({
      id: '2',
      projectId: '1',
      version: 'release',
      description: null,
      weight: 1,
      status: 1,
      releaseId: releaseId,
      releaseHash: null,
      manifestVersion: null,
      publishedAt: null,
      createdAt: timestamp,
      updatedAt: timestamp,
      isDeleted: false,
    })

    expect(() => parseDatabaseImportPayload({ data, version: '2.1.0' })).toThrow(
      'partial release metadata',
    )
  })
})

const releaseId = '550e8400-e29b-41d4-a716-446655440000'
