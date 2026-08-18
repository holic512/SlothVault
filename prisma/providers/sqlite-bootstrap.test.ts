import { mkdtempSync, readFileSync, rmSync } from 'node:fs'
import { tmpdir } from 'node:os'
import { join, resolve } from 'node:path'
import { PrismaBetterSqlite3 } from '@prisma/adapter-better-sqlite3'
import Database from 'better-sqlite3'
import { describe, expect, it } from 'vitest'
import { PrismaClient } from '../../generated/prisma-sqlite/client'

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
      for (const migration of [
        '20260721000000_web2_identity_points',
        '20260812000000_project_version_releases',
        '20260813000000_release_transaction_evidence',
        '20260818000000_contract_evidence',
      ]) {
        bootstrapDatabase.exec(readFileSync(resolve(process.cwd(), `prisma/providers/sqlite/migrations/${migration}/migration.sql`), 'utf8'))
      }
      bootstrapDatabase.close()

      prisma = new PrismaClient({
        adapter: new PrismaBetterSqlite3({ url: `file://${databasePath}`, timeout: 5_000 }),
      })

      const first = await prisma.project.create({ data: { projectName: 'first', weight: 0, status: 1 } })
      const second = await prisma.project.create({ data: { projectName: 'second', weight: 0, status: 1 } })
      expect(first.id).toBe(1)
      expect(second.id).toBe(2)

      const admin = await prisma.user.create({ data: { username: 'admin', password: 'hash', role: 'ADMIN' } })
      const version = await prisma.projectVersion.create({ data: { projectId: first.id, version: 'v1', weight: 0, status: 0 } })
      const evidence = await prisma.releaseCredential.create({
        data: {
          projectVersionId: version.id,
          issuerUserId: admin.id,
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
})
