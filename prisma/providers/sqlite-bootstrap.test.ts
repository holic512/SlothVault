import { mkdtempSync, readFileSync, rmSync } from 'node:fs'
import { tmpdir } from 'node:os'
import { join, resolve } from 'node:path'
import { PrismaBetterSqlite3 } from '@prisma/adapter-better-sqlite3'
import Database from 'better-sqlite3'
import { describe, expect, it } from 'vitest'
import { PrismaClient } from '../../generated/prisma-sqlite/client'

describe('SQLite provider bootstrap', () => {
  it('applies the initial migration, seeds locks, and autogenerates portable Int IDs', async () => {
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
      bootstrapDatabase.close()

      prisma = new PrismaClient({
        adapter: new PrismaBetterSqlite3({ url: `file://${databasePath}`, timeout: 5_000 }),
      })

      const locks = await prisma.runtimeLock.findMany({
        orderBy: { key: 'asc' },
        select: { key: true, revision: true },
      })

      expect(locks).toEqual([
        { key: 'solana-tree-priority:devnet', revision: 0 },
        { key: 'solana-tree-priority:mainnet', revision: 0 },
      ])

      const first = await prisma.project.create({ data: { projectName: 'first', weight: 0, status: 1 } })
      const second = await prisma.project.create({ data: { projectName: 'second', weight: 0, status: 1 } })
      expect(first.id).toBe(1)
      expect(second.id).toBe(2)

      const largeCapacity = 2n ** 40n
      const tree = await prisma.merkleTree.create({
        data: {
          name: 'portable-bigint-check',
          treeAddress: 'sqlite-tree-address',
          treeAuthority: 'sqlite-tree-authority',
          encryptedKey: 'test-only',
          creatorAddress: 'sqlite-tree-creator',
          maxDepth: 20,
          maxBufferSize: 64,
          canopyDepth: 10,
          maxCapacity: largeCapacity,
          remainingCapacity: largeCapacity,
          creationCost: 1234567890123n,
        },
      })
      expect(tree.id).toBeTypeOf('number')
      expect(tree.maxCapacity).toBe(largeCapacity)
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
