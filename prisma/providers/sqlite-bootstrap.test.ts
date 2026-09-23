import { mkdtempSync, readFileSync, rmSync } from 'node:fs'
import { tmpdir } from 'node:os'
import { join, resolve } from 'node:path'
import { PrismaBetterSqlite3 } from '@prisma/adapter-better-sqlite3'
import Database from 'better-sqlite3'
import { describe, expect, it } from 'vitest'
import { PrismaClient } from '../../generated/prisma-sqlite/client'

const sqliteMigrations = [
  '20260721000000_web2_identity_points',
  '20260812000000_project_version_releases',
  '20260813000000_release_transaction_evidence',
  '20260818000000_contract_evidence',
  '20260820000000_note_content_evidence',
  '20260820120000_independent_articles',
  '20260827000000_membership_article_access',
  '20260828000000_knowledge_package_import',
  '20260911000000_remove_knowledge_package_import',
  '20260923000000_content_trash',
]

function migrationSql(name: string) {
  return readFileSync(
    resolve(process.cwd(), `prisma/providers/sqlite/migrations/${name}/migration.sql`),
    'utf8',
  )
}

describe('SQLite provider bootstrap', () => {
  it('applies all migrations and autogenerates portable Int evidence IDs', async () => {
    const directory = mkdtempSync(join(tmpdir(), 'slothvault-sqlite-provider-'))
    const databasePath = join(directory, 'slothvault.db')
    const bootstrapDatabase = new Database(databasePath)
    let prisma: PrismaClient | undefined

    try {
      bootstrapDatabase.pragma('foreign_keys = ON')
      bootstrapDatabase.exec(
        readFileSync(
          resolve(
            process.cwd(),
            'prisma/providers/sqlite/migrations/20260719000000_initial/migration.sql',
          ),
          'utf8',
        ),
      )
      for (const migration of sqliteMigrations) {
        bootstrapDatabase.exec(migrationSql(migration))
      }
      bootstrapDatabase.close()

      prisma = new PrismaClient({
        adapter: new PrismaBetterSqlite3({ url: `file://${databasePath}`, timeout: 5_000 }),
      })

      const first = await prisma.project.create({ data: { projectName: 'first', weight: 0, status: 1 } })
      const second = await prisma.project.create({ data: { projectName: 'second', weight: 0, status: 1 } })
      expect(first.id).toBe(1)
      expect(second.id).toBe(2)

      const article = await prisma.article.create({
        data: { title: 'Independent article', content: '# Body' },
      })
      expect(article).toMatchObject({ id: 1, status: 0, publishedAt: null, isDeleted: false, deletedAt: null })

      const level = await prisma.membershipLevel.create({
        data: { name: 'VIP', rank: 1, pricePoints: 10, validityDays: 30 },
      })
      const member = await prisma.user.create({ data: { username: 'member', password: 'hash' } })
      const grant = await prisma.membershipGrant.create({
        data: { userId: member.id, membershipLevelId: level.id, source: 'ADMIN_GRANT' },
      })
      expect(grant.id).toBe(1)

      const admin = await prisma.user.create({ data: { username: 'admin', password: 'hash', role: 'ADMIN' } })
      const version = await prisma.projectVersion.create({ data: { projectId: first.id, version: 'v1', weight: 0, status: 0 } })
      const evidence = await prisma.releaseCredential.create({
        data: {
          projectVersionId: version.id,
          issuerUserId: admin.id,
          subjectType: 'PROJECT_VERSION',
          subjectId: '90f98878-b654-4ad3-8f61-7b849ef03d49',
          subjectHash: 'a'.repeat(64),
          subjectManifestVersion: 1,
          network: 'devnet',
          signerAddress: '11111111111111111111111111111111',
          memo: '{}',
          slot: 2n ** 40n,
        },
      })
      expect(evidence.id).toBeTypeOf('number')
      expect(evidence.slot).toBe(2n ** 40n)

      const subject = await prisma.user.create({ data: { username: 'subject', password: 'hash' } })
      const contract = await prisma.contract.create({
        data: {
          contractId: '6ed9ce9d-0ec6-44d3-9ed1-94dcab18fb3f',
          issuerUserId: admin.id,
          subjectUserId: subject.id,
          title: 'Evidence contract',
          body: 'Frozen body\n',
          bodyHash: 'a'.repeat(64),
          partyCommitment: 'b'.repeat(64),
        },
      })
      expect(contract.id).toBeTypeOf('number')
      const audit = await prisma.contractAdminAudit.create({
        data: { contractId: contract.id, actorUserId: admin.id, action: 'DRAFT_CREATED' },
      })
      expect(audit.id).toBeTypeOf('number')
    } finally {
      await prisma?.$disconnect()
      if (bootstrapDatabase.open) bootstrapDatabase.close()
      rmSync(directory, { recursive: true, force: true })
    }
  })

  it('upgrades historical project versions to release-ready drafts', () => {
    const directory = mkdtempSync(join(tmpdir(), 'slothvault-sqlite-release-migration-'))
    const databasePath = join(directory, 'slothvault.db')
    const database = new Database(databasePath)

    try {
      database.pragma('foreign_keys = ON')
      database.exec(
        readFileSync(
          resolve(
            process.cwd(),
            'prisma/providers/sqlite/migrations/20260719000000_initial/migration.sql',
          ),
          'utf8',
        ),
      )
      database.exec(
        `INSERT INTO "collections_project" ("project_name", "weight", "status") VALUES ('legacy', 0, 1);
         INSERT INTO "collections_project_version" ("project_id", "version", "weight", "status") VALUES (1, 'v1', 0, 1);`,
      )
      database.exec(
        readFileSync(
          resolve(
            process.cwd(),
            'prisma/providers/sqlite/migrations/20260812000000_project_version_releases/migration.sql',
          ),
          'utf8',
        ),
      )

      const version = database.prepare(
        'SELECT status, document_revision, release_id, release_hash, manifest_version, published_at FROM collections_project_version WHERE id = 1',
      ).get() as Record<string, unknown>
      expect(version).toEqual({
        status: 0,
        document_revision: 0,
        release_id: null,
        release_hash: null,
        manifest_version: null,
        published_at: null,
      })
      expect(
        database.prepare(
          "SELECT COUNT(*) AS count FROM sqlite_master WHERE type = 'index' AND name IN ('uq_collections_project_version_release_id', 'uq_collections_project_version_release_hash')",
        ).get(),
      ).toEqual({ count: 2 })
    } finally {
      database.close()
      rmSync(directory, { recursive: true, force: true })
    }
  })

  it('permanently removes knowledge package content without touching unrelated drafts', () => {
    const directory = mkdtempSync(join(tmpdir(), 'slothvault-sqlite-knowledge-package-removal-'))
    const databasePath = join(directory, 'slothvault.db')
    const database = new Database(databasePath)

    try {
      database.pragma('foreign_keys = ON')
      database.exec(readFileSync(resolve(process.cwd(), 'prisma/providers/sqlite/migrations/20260719000000_initial/migration.sql'), 'utf8'))
      for (const migration of sqliteMigrations.slice(0, -2)) {
        database.exec(migrationSql(migration))
      }

      database.exec(`
        INSERT INTO "auth_user" ("username", "password", "role") VALUES ('admin', 'hash', 'ADMIN');
        INSERT INTO "collections_project" ("project_name", "weight", "status") VALUES ('Knowledge cleanup', 0, 1);
        INSERT INTO "collections_project_version" ("project_id", "version", "weight", "status") VALUES
          (1, 'imported-project', 0, 0),
          (1, 'article-target', 0, 0),
          (1, 'manual-control', 0, 0);
        INSERT INTO "collections_category" ("project_version_id", "category_name", "weight", "status") VALUES
          (1, 'Project package category', 0, 1),
          (2, 'Existing article category', 0, 1),
          (3, 'Manual category', 0, 1);
        INSERT INTO "docs_note_info" ("category_id", "note_title", "weight", "status") VALUES
          (1, 'Project package article', 0, 1),
          (1, 'Later manual article', 0, 1),
          (2, 'Single package article', 0, 1),
          (2, 'Existing manual article', 0, 1),
          (3, 'Control article', 0, 1);
        INSERT INTO "docs_note_content" ("note_info_id", "content", "is_primary", "status") VALUES
          (1, '# Project package', 1, 1),
          (2, '# Later manual', 1, 1),
          (3, '# Single package', 1, 1),
          (4, '# Existing manual', 1, 1),
          (5, '# Control article', 1, 1);
        INSERT INTO "knowledge_package" ("project_version_id", "package_kind", "title", "schema_version", "package_hash", "manifest") VALUES
          (1, 'project', 'Project package', 1, 'aaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaa', '{}'),
          (2, 'article', 'Article package', 1, 'bbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbb', '{}');
        INSERT INTO "knowledge_article" ("package_id", "note_info_id", "external_id", "slug", "article_type", "tags_json", "source_references_json") VALUES
          (1, 1, 'project-article', 'project-article', 'guide', '[]', '[]'),
          (2, 3, 'single-article', 'single-article', 'guide', '[]', '[]');
        INSERT INTO "release_credential" (
          "project_version_id", "note_content_id", "issuer_user_id", "subject_type", "subject_id", "subject_hash", "subject_manifest_version", "network", "signer_address", "memo"
        ) VALUES
          (1, 1, 1, 'NOTE_CONTENT', '00000000-0000-0000-0000-000000000001', 'cccccccccccccccccccccccccccccccccccccccccccccccccccccccccccccccc', 1, 'devnet', '11111111111111111111111111111111', '{}'),
          (2, 3, 1, 'NOTE_CONTENT', '00000000-0000-0000-0000-000000000002', 'dddddddddddddddddddddddddddddddddddddddddddddddddddddddddddddddd', 1, 'devnet', '11111111111111111111111111111111', '{}');
        INSERT INTO "release_credential_attempt" (
          "credential_id", "issuer_user_id", "signer_address", "memo", "message_hash", "recent_blockhash", "last_valid_block_height", "expires_at"
        ) VALUES
          (1, 1, '11111111111111111111111111111111', '{}', 'eeeeeeeeeeeeeeeeeeeeeeeeeeeeeeeeeeeeeeeeeeeeeeeeeeeeeeeeeeeeeeee', 'blockhash-1', 100, CURRENT_TIMESTAMP),
          (2, 1, '11111111111111111111111111111111', '{}', 'ffffffffffffffffffffffffffffffffffffffffffffffffffffffffffffffff', 'blockhash-2', 100, CURRENT_TIMESTAMP);
      `)

      database.exec(migrationSql('20260911000000_remove_knowledge_package_import'))

      expect(
        database.prepare(
          "SELECT name FROM sqlite_master WHERE type = 'table' AND name IN ('knowledge_package', 'knowledge_article') ORDER BY name",
        ).all(),
      ).toEqual([])
      expect(
        database.prepare('SELECT id, version FROM "collections_project_version" ORDER BY id').all(),
      ).toEqual([
        { id: 2, version: 'article-target' },
        { id: 3, version: 'manual-control' },
      ])
      expect(
        database.prepare('SELECT id, note_title FROM "docs_note_info" ORDER BY id').all(),
      ).toEqual([
        { id: 4, note_title: 'Existing manual article' },
        { id: 5, note_title: 'Control article' },
      ])
      expect(
        database.prepare('SELECT COUNT(*) AS count FROM "docs_note_content"').get(),
      ).toEqual({ count: 2 })
      expect(
        database.prepare('SELECT COUNT(*) AS count FROM "release_credential"').get(),
      ).toEqual({ count: 0 })
      expect(
        database.prepare('SELECT COUNT(*) AS count FROM "release_credential_attempt"').get(),
      ).toEqual({ count: 0 })
      expect(
        database.prepare('SELECT id FROM "collections_category" WHERE "project_version_id" = 2').all(),
      ).toEqual([{ id: 2 }])
    } finally {
      database.close()
      rmSync(directory, { recursive: true, force: true })
    }
  })
})
