import { mkdtempSync, readFileSync, readdirSync, rmSync } from 'node:fs'
import { tmpdir } from 'node:os'
import { join, resolve } from 'node:path'

import { PrismaBetterSqlite3 } from '@prisma/adapter-better-sqlite3'
import Database from 'better-sqlite3'
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest'

import { PrismaClient } from '@generated/prisma-sqlite/client'
import type { AppPrismaClient } from '@/server/database/client'

const fixture = vi.hoisted(() => ({ client: null as unknown as AppPrismaClient }))
vi.mock('@/server/prisma', () => ({ get prisma() { return fixture.client } }))

import { listAdminSettings, updateAdminSettings } from './admin-settings'
import { CONFIG_KEYS } from './system-config'
import { getSystemFiling } from './system-filing'

describe('database-backed filing lifecycle', () => {
  let directory: string
  let databaseFile: string

  const connect = () => new PrismaClient({
    adapter: new PrismaBetterSqlite3({ url: `file:${databaseFile}` }),
  }) as unknown as AppPrismaClient

  beforeEach(() => {
    directory = mkdtempSync(join(tmpdir(), 'sv-filing-'))
    databaseFile = join(directory, 'filing.db')
    const bootstrap = new Database(databaseFile)
    const migrations = resolve('prisma/providers/sqlite/migrations')
    for (const name of readdirSync(migrations).filter((name) => /^\d/.test(name)).sort()) {
      bootstrap.exec(readFileSync(join(migrations, name, 'migration.sql'), 'utf8'))
    }
    bootstrap.close()
    fixture.client = connect()
  })

  afterEach(async () => {
    await fixture.client.$disconnect()
    rmSync(directory, { recursive: true, force: true })
  })

  it('persists ICP-only settings across closing and reopening the database', async () => {
    await updateAdminSettings([
      { key: CONFIG_KEYS.SYSTEM_ICP_RECORD_NUMBER, value: ' 测试ICP备12345678号-1 ' },
      { key: CONFIG_KEYS.SYSTEM_ICP_RECORD_URL, value: 'https://example.com/icp' },
    ])
    await fixture.client.$disconnect()
    fixture.client = connect()

    await expect(getSystemFiling()).resolves.toEqual({
      icp: { number: '测试ICP备12345678号-1', url: 'https://example.com/icp' },
      publicSecurity: null,
    })
    const settings = await listAdminSettings()
    expect(settings.groups.find((group) => group.key === 'filing')?.configs)
      .toEqual(expect.arrayContaining([expect.objectContaining({ key: CONFIG_KEYS.SYSTEM_ICP_RECORD_NUMBER, value: '测试ICP备12345678号-1' })]))
  })

  it('reflects adding public security, clearing it, and clearing all numbers on the next read', async () => {
    await updateAdminSettings([
      { key: CONFIG_KEYS.SYSTEM_ICP_RECORD_NUMBER, value: '测试ICP备12345678号-1' },
      { key: CONFIG_KEYS.SYSTEM_PUBLIC_SECURITY_RECORD_NUMBER, value: '测试公网安备12345678901234号' },
    ])
    expect((await getSystemFiling()).publicSecurity?.number).toBe('测试公网安备12345678901234号')

    await updateAdminSettings([{ key: CONFIG_KEYS.SYSTEM_PUBLIC_SECURITY_RECORD_NUMBER, value: '' }])
    await expect(getSystemFiling()).resolves.toEqual({
      icp: { number: '测试ICP备12345678号-1', url: '' }, publicSecurity: null,
    })

    await updateAdminSettings([{ key: CONFIG_KEYS.SYSTEM_ICP_RECORD_NUMBER, value: '' }])
    await expect(getSystemFiling()).resolves.toEqual({ icp: null, publicSecurity: null })
  })

  it('leaves saved settings intact when another change in the batch is invalid', async () => {
    await updateAdminSettings([{ key: CONFIG_KEYS.SYSTEM_ICP_RECORD_NUMBER, value: 'original' }])
    await expect(updateAdminSettings([
      { key: CONFIG_KEYS.SYSTEM_ICP_RECORD_NUMBER, value: 'must roll back' },
      { key: CONFIG_KEYS.SYSTEM_PUBLIC_SECURITY_RECORD_URL, value: 'javascript:alert(1)' },
    ])).rejects.toMatchObject({ status: 400 })
    expect((await getSystemFiling()).icp?.number).toBe('original')
    expect(await fixture.client.systemConfig.count()).toBe(1)
  })
})
