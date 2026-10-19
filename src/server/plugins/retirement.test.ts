import { existsSync, mkdirSync, mkdtempSync, readFileSync, readdirSync, rmSync, writeFileSync } from 'node:fs'
import { tmpdir } from 'node:os'
import { join } from 'node:path'
import Database from 'better-sqlite3'
import { PrismaBetterSqlite3 } from '@prisma/adapter-better-sqlite3'
import { PrismaClient } from '@generated/prisma-sqlite/client'
import type { AppPrismaClient } from '@/server/database/client'
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest'
const fixture = vi.hoisted(() => ({ client: null as unknown as AppPrismaClient, root: '' }))
vi.mock('@/server/prisma', () => ({ get prisma() { return fixture.client } }))
vi.mock('@/server/config/app-data', () => ({ appDataPath: () => fixture.root }))
vi.mock('@/server/database/client', () => ({ configuredDatabaseProvider: () => 'sqlite' }))
import { retireLegacyGiftCards } from './retirement'
import { tableExists } from './database'
beforeEach(async () => {
  fixture.root = mkdtempSync(join(tmpdir(), 'sv-retirement-'))
  const path = join(fixture.root, 'test.db'), db = new Database(path)
  db.pragma('foreign_keys=ON')
  for (const name of readdirSync('prisma/providers/sqlite/migrations').filter(name => /^\d/.test(name)).sort()) db.exec(readFileSync(`prisma/providers/sqlite/migrations/${name}/migration.sql`, 'utf8'))
  db.exec("INSERT INTO points_gift_card_batch(id,name,points,quantity,status,attribution_json) VALUES (1,'Historical',10,1,1,'{}'); INSERT INTO points_gift_card(batch_id,code_hash,code_hint,status) VALUES (1,'historical-hash','hidden',1)")
  db.close()
  fixture.client = new PrismaClient({ adapter: new PrismaBetterSqlite3({ url: `file:${path}` }, { timestampFormat: 'iso8601' }) }) as unknown as AppPrismaClient
})
afterEach(async () => { await fixture.client.$disconnect(); rmSync(fixture.root, { recursive: true, force: true }) })
describe('one-time preproduction card retirement', () => {
  it('removes legacy cards but preserves core balances, ledger, and receipt identity', async () => {
    const user = await fixture.client.user.create({ data: { username: 'retirement-test', password: 'test', pointsBalance: 10 } })
    await fixture.client.pointTransaction.create({ data: { userId: user.id, amount: 10, balanceAfter: 10, type: 'CARD_REDEEM' } })
    await fixture.client.pluginPointReceipt.create({ data: { pluginId: 'slothvault.gift-cards', sourceKey: 'old', userId: user.id, amount: 10, balanceAfter: 10 } })
    await fixture.client.pluginInstallation.create({ data: { pluginId: 'slothvault.gift-cards', version: '1.0.0', digest: 'a'.repeat(64), manifestJson: JSON.stringify({ tables: [{ legacyName: 'points_gift_card' }] }) } })
    await retireLegacyGiftCards()
    await retireLegacyGiftCards()
    expect(await tableExists('points_gift_card')).toBe(false)
    expect(await tableExists('points_gift_card_batch')).toBe(false)
    expect(await fixture.client.pluginInstallation.count()).toBe(0)
    expect((await fixture.client.user.findUniqueOrThrow({ where: { id: user.id } })).pointsBalance).toBe(10)
    expect(await fixture.client.pointTransaction.count()).toBe(1)
    expect(await fixture.client.pluginPointReceipt.count()).toBe(1)
  })
  it('cleans uninstalled legacy previews and leaves other plugin files untouched', async () => {
    const digest = 'b'.repeat(64), other = 'c'.repeat(64)
    const manifest = { id: 'slothvault.gift-cards', tables: [{ legacyName: 'points_gift_card' }] }
    await fixture.client.pluginPackage.create({ data: { pluginId: manifest.id, version: '1.0.0', digest, manifestJson: JSON.stringify(manifest) } })
    for (const [key, metadata] of [[digest, manifest], [other, { id: 'slothvault.example' }]] as const) {
      const path = join(fixture.root, 'plugins', 'packages', key)
      mkdirSync(path, { recursive: true })
      writeFileSync(join(path, 'plugin.json'), JSON.stringify(metadata))
      mkdirSync(join(fixture.root, 'plugins', 'archives'), { recursive: true })
      writeFileSync(join(fixture.root, 'plugins', 'archives', key + '.zip'), 'test-only archive')
    }
    await retireLegacyGiftCards()
    expect(await fixture.client.pluginPackage.count()).toBe(0)
    expect(existsSync(join(fixture.root, 'plugins', 'packages', digest))).toBe(false)
    expect(existsSync(join(fixture.root, 'plugins', 'archives', digest + '.zip'))).toBe(false)
    expect(existsSync(join(fixture.root, 'plugins', 'packages', other, 'plugin.json'))).toBe(true)
    expect(existsSync(join(fixture.root, 'plugins', 'archives', other + '.zip'))).toBe(true)
  })
  it('refuses external foreign keys without dropping tables or creating a success marker', async () => {
    await fixture.client.$executeRawUnsafe('CREATE TABLE other_plugin(id INTEGER PRIMARY KEY, card_id INTEGER REFERENCES points_gift_card(id))')
    await expect(retireLegacyGiftCards()).rejects.toThrow('external references')
    expect(await tableExists('points_gift_card')).toBe(true)
    expect(await fixture.client.systemConfig.findUnique({ where: { configKey: '__legacy_gift_cards_retired_v1__' } })).toBeNull()
  })
})
