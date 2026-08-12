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

describe('database backup capacity validation', () => {
  it('accepts a legacy pending reservation without the new optional fields', () => {
    const parsed = parseDatabaseImportPayload({
      data: backupWithReservation(),
      mode: 'insert',
    })
    expect(parsed.data.merkleTrees[0].remainingCapacity).toBeUndefined()
    expect(parsed.data.compressedNfts[0].capacityReserved).toBeUndefined()
  })

  it('rejects an inconsistent explicit remaining capacity', () => {
    expect(() =>
      parseDatabaseImportPayload({
        data: backupWithReservation({ remainingCapacity: '9' }),
      }),
    ).toThrow('inconsistent remainingCapacity')
  })

  it('accepts authoritative remaining capacity when a pending lower leaf is already in sequence', () => {
    const parsed = parseDatabaseImportPayload({
      data: backupWithReservation({ remainingCapacity: '8' }),
    })
    expect(parsed.data.merkleTrees[0].remainingCapacity).toBe('8')
  })

  it('rejects a minting cNFT that no longer owns a reservation', () => {
    expect(() =>
      parseDatabaseImportPayload({
        data: backupWithReservation({ capacityReserved: false }),
      }),
    ).toThrow('MINTING without a capacity reservation')
  })

  it('rejects more pending reservations than the tree ever allocated', () => {
    const data = backupWithReservation({ remainingCapacity: '0' })
    data.merkleTrees[0].maxCapacity = '1'
    data.merkleTrees[0].totalMinted = 1
    data.compressedNfts.push({
      ...data.compressedNfts[0],
      id: '21',
      assetId: 'pending-test-2',
    })

    expect(() => parseDatabaseImportPayload({ data })).toThrow(
      'more reservations than allocated capacity',
    )
  })
})

describe('database backup release compatibility', () => {
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
