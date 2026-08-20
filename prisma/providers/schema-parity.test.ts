import { readFileSync } from 'node:fs'
import { resolve } from 'node:path'
import { describe, expect, it } from 'vitest'

const providers = ['postgresql', 'mysql', 'sqlite'] as const
const expectedTables = {
  Session: 'auth_session',
  User: 'auth_user',
  PointTransaction: 'points_transaction',
  GiftCardBatch: 'points_gift_card_batch',
  GiftCard: 'points_gift_card',
  Project: 'collections_project',
  ProjectMenu: 'collections_project_menu',
  ProjectHome: 'collections_project_home',
  ProjectVersion: 'collections_project_version',
  Category: 'collections_category',
  NoteInfo: 'docs_note_info',
  NoteContent: 'docs_note_content',
  FileManagement: 'files_file_management',
  Contract: 'contract',
  ContractAdminAudit: 'contract_admin_audit',
  ContractCredential: 'contract_credential',
  ContractCredentialAttempt: 'contract_credential_attempt',
  SystemConfig: 'system_config',
  SystemHomepage: 'system_homepage',
  SystemInstallation: 'system_installation',
  ReleaseCredential: 'release_credential',
  ReleaseCredentialAttempt: 'release_credential_attempt',
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

function readWeb2Migration(provider: (typeof providers)[number]) {
  return readFileSync(
    resolve(
      process.cwd(),
      `prisma/providers/${provider}/migrations/20260721000000_web2_identity_points/migration.sql`,
    ),
    'utf8',
  )
}

function readReleaseMigration(provider: (typeof providers)[number]) {
  return readFileSync(
    resolve(
      process.cwd(),
      `prisma/providers/${provider}/migrations/20260812000000_project_version_releases/migration.sql`,
    ),
    'utf8',
  )
}

function readNoteContentEvidenceMigration(provider: (typeof providers)[number]) {
  return readFileSync(
    resolve(
      process.cwd(),
      `prisma/providers/${provider}/migrations/20260820000000_note_content_evidence/migration.sql`,
    ),
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
    expect(models.get('User')).toContain('role String @default("USER")')
    expect(models.get('User')).toContain('passwordConfigured Boolean @default(true) @map("password_configured")')
    expect(models.get('User')).toContain('pointsBalance Int @default(0) @map("points_balance")')
    expect(models.get('User')).toContain('walletAddress String? @unique')
    expect(models.get('PointTransaction')).toContain('balanceAfter Int @map("balance_after")')
    expect(models.get('GiftCard')).toContain('codeHash String @unique')
    expect(models.get('NoteInfo')).toContain('contentRevision Int @default(0) @map("content_revision")')
    expect(models.get('NoteInfo')).toContain('authorId Int? @map("author_id")')
    expect(models.get('ProjectVersion')).toContain('documentRevision Int @default(0) @map("document_revision")')
    expect(models.get('ProjectVersion')).toContain('releaseId String? @unique')
    expect(models.get('ProjectVersion')).toContain('releaseHash String? @unique')
    expect(models.get('ProjectVersion')).toContain('manifestVersion Int? @map("manifest_version")')
    expect(models.get('ProjectVersion')).toContain('publishedAt DateTime? @map("published_at")')
    expect(models.get('NoteContent')).toContain('evidenceId String? @unique')
    expect(models.get('ReleaseCredential')).toContain('projectVersionId Int @map("project_version_id")')
    expect(models.get('ReleaseCredential')).toContain('noteContentId Int? @map("note_content_id")')
    expect(models.get('ReleaseCredential')).toContain('subjectType String @default("PROJECT_VERSION")')
    expect(models.get('ReleaseCredential')).toContain('subjectId String @map("subject_id")')
    expect(models.get('ReleaseCredential')).toContain('subjectHash String @map("subject_hash")')
    expect(models.get('ReleaseCredential')).toContain('@@unique([subjectType, subjectId, network]')
    expect(models.get('ReleaseCredential')).toContain('transactionSignature String? @unique')
    expect(models.get('ReleaseCredentialAttempt')).toContain('lastValidBlockHeight BigInt @map("last_valid_block_height")')
    expect(models.get('Contract')).toContain('contractId String @unique')
    expect(models.get('Contract')).toContain('bodyHash String @map("body_hash")')
    expect(models.get('Contract')).toContain('partyCommitment String @map("party_commitment")')
    expect(models.get('ContractCredential')).toContain('contractId Int @map("contract_id")')
    expect(models.get('ContractAdminAudit')).toContain('actorUserId Int @map("actor_user_id")')
    expect(models.get('ContractCredentialAttempt')).toContain('lastValidBlockHeight BigInt @map("last_valid_block_height")')
    expect(models.has('SystemInstallation')).toBe(true)
    expect(models.has('RuntimeLock')).toBe(false)
  })

  it.each(providers)('%s uses portable Int identity keys and reserves BigInt for business values', (provider) => {
    const models = modelBlocks(readSchema(provider))
    const autoIncrementModels = [
      'User',
      'PointTransaction',
      'GiftCardBatch',
      'GiftCard',
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
      'Contract',
      'ContractAdminAudit',
      'ContractCredential',
      'ContractCredentialAttempt',
      'ReleaseCredential',
      'ReleaseCredentialAttempt',
    ]

    for (const model of autoIncrementModels) {
      expect(models.get(model)).toMatch(/(?:^| )id Int @id @default\(autoincrement\(\)\)/)
    }

    expect(models.get('ProjectMenu')).toContain('projectId Int @map("project_id")')
    expect(models.get('ProjectMenu')).toContain('parentId Int? @map("parent_id")')
    expect(models.get('FileManagement')).toContain('fileSize BigInt @map("file_size")')
    expect(models.get('ReleaseCredential')).toContain('slot BigInt?')
    expect(models.get('ReleaseCredential')).toContain('feeLamports BigInt? @map("fee_lamports")')
  })

  it.each(providers)('%s keeps the historical initial migration and provider lock metadata', (provider) => {
    const migration = readInitialMigration(provider)
    const migrationLock = readFileSync(
      resolve(process.cwd(), `prisma/providers/${provider}/migrations/migration_lock.toml`),
      'utf8',
    )

    expect(migration).toContain('solana-tree-priority:mainnet')
    expect(migration).toContain('solana-tree-priority:devnet')
    expect(migrationLock).toContain(`provider = "${provider}"`)
  })

  it.each(providers)('%s migrates Web2 identity, points, gift cards, and article credentials', (provider) => {
    const migration = readWeb2Migration(provider)

    expect(migration).toContain('points_transaction')
    expect(migration).toContain('points_gift_card_batch')
    expect(migration).toContain('points_gift_card')
    expect(migration).toContain('wallet_address')
    expect(migration).toContain('author_id')
    expect(migration).toContain('note_info_id')
    expect(migration).toContain('copyright_owner_id')
  })

  it.each(providers)('%s migrates historical versions to immutable release-ready drafts', (provider) => {
    const migration = readReleaseMigration(provider)

    expect(migration).toContain('document_revision')
    expect(migration).toContain('release_id')
    expect(migration).toContain('release_hash')
    expect(migration).toContain('manifest_version')
    expect(migration).toContain('published_at')
    expect(migration).toMatch(/SET\s+[`"]status[`"]\s*=\s*0/i)
  })

  it.each(providers)('%s migrates one evidence ledger to stable note-content subjects', (provider) => {
    const migration = readNoteContentEvidenceMigration(provider)

    expect(migration).toContain('evidence_id')
    expect(migration).toContain('note_content_id')
    expect(migration).toContain('subject_type')
    expect(migration).toContain('subject_id')
    expect(migration).toContain('subject_hash')
    expect(migration).toContain('subject_manifest_version')
    expect(migration).toContain('uq_release_credential_subject_network')
    expect(migration).not.toContain('CREATE UNIQUE INDEX "uq_release_credential_version_network"')
  })
})
