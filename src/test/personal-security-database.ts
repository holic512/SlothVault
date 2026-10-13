import { mkdtempSync, readdirSync, readFileSync, rmSync } from 'node:fs'
import { tmpdir } from 'node:os'
import { join } from 'node:path'
import Database from 'better-sqlite3'
import { PrismaBetterSqlite3 } from '@prisma/adapter-better-sqlite3'
import { PrismaClient } from '@generated/prisma-sqlite/client'
import type { AppPrismaClient } from '@/server/database/client'
export function personalSecurityDatabase() {
  const root = mkdtempSync(join(tmpdir(), 'sv-personal-security-')), path = join(root, 'test.db')
  const db = new Database(path)
  db.pragma('foreign_keys=ON')
  for (const name of readdirSync('prisma/providers/sqlite/migrations').filter(name => /^\d/.test(name)).sort()) db.exec(readFileSync(`prisma/providers/sqlite/migrations/${name}/migration.sql`, 'utf8'))
  db.close()
  const client = new PrismaClient({ adapter: new PrismaBetterSqlite3({ url: `file:${path}` }, { timestampFormat: 'iso8601' }) }) as unknown as AppPrismaClient
  return { client, close: async () => { await client.$disconnect(); rmSync(root, { recursive: true, force: true }) } }
}
