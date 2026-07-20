import { readFileSync } from 'node:fs'
import { resolve } from 'node:path'
import { describe, expect, it } from 'vitest'

const providers = ['postgresql', 'mysql', 'sqlite'] as const
const expectedTables = {
  Session: 'auth_session',
  User: 'auth_user',
  Project: 'collections_project',
  ProjectMenu: 'collections_project_menu',
  ProjectHome: 'collections_project_home',
  ProjectVersion: 'collections_project_version',
  Category: 'collections_category',
  NoteInfo: 'docs_note_info',
  NoteContent: 'docs_note_content',
  FileManagement: 'files_file_management',
  SystemConfig: 'system_config',
  SystemHomepage: 'system_homepage',
  SystemInstallation: 'system_installation',
  RuntimeLock: 'system_runtime_lock',
  MerkleTree: 'solana_merkle_tree',
  CompressedNft: 'solana_compressed_nft',
} as const

function readSchema(provider: (typeof providers)[number]) {
  return readFileSync(resolve(process.cwd(), `prisma/providers/${provider}/schema.prisma`), 'utf8')
}

function readInitialMigration(provider: (typeof providers)[number]) {
  return readFileSync(
    resolve(process.cwd(), `prisma/providers/${provider}/migrations/20260719000000_initial/migration.sql`),
    'utf8',
  )
}

function modelBlocks(schema: string) {
  return new Map(
    [...schema.matchAll(/model\s+(\w+)\s*\{([\s\S]*?)\n\}/g)].map((match) => [
      match[1],
      match[2]
        .replace(/@db\.\w+(?:\([^)]*\))?/g, '')
        .replace(/\s+/g, ' ')
        .trim(),
    ]),
  )
}

describe('provider schema parity', () => {
  it('keeps the same logical Prisma models and fields for every provider', () => {
    const reference = modelBlocks(readSchema('postgresql'))

    expect([...reference.keys()]).toEqual(Object.keys(expectedTables))
    expect(modelBlocks(readSchema('mysql'))).toEqual(reference)
    expect(modelBlocks(readSchema('sqlite'))).toEqual(reference)
  })

  it.each(providers)('%s uses flat domain-prefixed table names', (provider) => {
    const schema = readSchema(provider)
    const models = modelBlocks(schema)

    expect(schema).not.toContain('@@schema(')
    for (const [model, table] of Object.entries(expectedTables)) {
      expect(models.get(model)).toContain(`@@map("${table}")`)
    }
  })

  it.each(providers)('%s exposes the portable concurrency and install fields', (provider) => {
    const models = modelBlocks(readSchema(provider))

    expect(models.get('Session')).toContain('id String @id userId Int')
    expect(models.get('Session')).not.toContain('id String @id @default')
    expect(models.get('NoteInfo')).toContain('contentRevision Int @default(0) @map("content_revision")')
    expect(models.get('MerkleTree')).toContain('remainingCapacity BigInt @default(0) @map("remaining_capacity")')
    expect(models.get('CompressedNft')).toContain('capacityReserved Boolean @default(false) @map("capacity_reserved")')
    expect(models.has('SystemInstallation')).toBe(true)
    expect(models.has('RuntimeLock')).toBe(true)
  })

  it.each(providers)('%s uses portable Int identity keys and reserves BigInt for business values', (provider) => {
    const models = modelBlocks(readSchema(provider))
    const autoIncrementModels = [
      'User',
      'Project',
      'ProjectMenu',
      'ProjectHome',
      'ProjectVersion',
      'Category',
      'NoteInfo',
      'NoteContent',
      'FileManagement',
      'SystemConfig',
      'SystemHomepage',
      'MerkleTree',
      'CompressedNft',
    ]

    for (const model of autoIncrementModels) {
      expect(models.get(model)).toMatch(/(?:^| )id Int @id @default\(autoincrement\(\)\)/)
    }

    expect(models.get('ProjectMenu')).toContain('projectId Int @map("project_id")')
    expect(models.get('ProjectMenu')).toContain('parentId Int? @map("parent_id")')
    expect(models.get('CompressedNft')).toContain('merkleTreeId Int @map("merkle_tree_id")')
    expect(models.get('CompressedNft')).toContain('projectId Int @map("project_id")')
    expect(models.get('FileManagement')).toContain('fileSize BigInt @map("file_size")')
    expect(models.get('MerkleTree')).toContain('maxCapacity BigInt @map("max_capacity")')
    expect(models.get('MerkleTree')).toContain('creationCost BigInt @map("creation_cost")')
    expect(models.get('CompressedNft')).toContain('lastValidBlockHeight BigInt? @map("last_valid_block_height")')
  })

  it.each(providers)('%s initial migration seeds provider-neutral priority locks', (provider) => {
    const migration = readInitialMigration(provider)
    const migrationLock = readFileSync(
      resolve(process.cwd(), `prisma/providers/${provider}/migrations/migration_lock.toml`),
      'utf8',
    )

    expect(migration).toContain('solana-tree-priority:mainnet')
    expect(migration).toContain('solana-tree-priority:devnet')
    expect(migrationLock).toContain(`provider = "${provider}"`)
  })
})
