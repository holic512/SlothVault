import Database from 'better-sqlite3'
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest'
const mocks = vi.hoisted(() => ({ provider: 'sqlite', query: vi.fn() }))
vi.mock('@/server/database/client', () => ({ configuredDatabaseProvider: () => mocks.provider, getDatabaseClient: vi.fn() }))
vi.mock('@/server/prisma', () => ({ prisma: { $queryRawUnsafe: mocks.query } }))
import { columnExists } from './database'
let database: Database.Database
beforeEach(() => {
 vi.clearAllMocks(); mocks.provider = 'sqlite'
 database = new Database(':memory:')
 database.exec('CREATE TABLE svp_test_orders (id INTEGER PRIMARY KEY, token_amount TEXT)')
 mocks.query.mockImplementation(async (sql: string, ...parameters: unknown[]) => database.prepare(sql).all(...parameters))
})
afterEach(() => database.close())

describe('safe portable plugin column inspection', () => {
 it('uses actual SQLite schema metadata for present, absent and missing-table columns', async () => {
  expect(await columnExists('svp_test_orders', 'token_amount')).toBe(true)
  expect(await columnExists('svp_test_orders', 'payment_asset')).toBe(false)
  expect(await columnExists('svp_missing', 'id')).toBe(false)
  expect(mocks.query).toHaveBeenCalledWith('PRAGMA table_info("svp_test_orders")')
 })
 it.each(['mysql', 'postgresql'])('binds both identifiers as metadata values on %s', async provider => {
  mocks.provider = provider; mocks.query.mockResolvedValue([{ column_name: 'token_amount' }])
  expect(await columnExists('svp_test_orders', 'token_amount')).toBe(true)
  const [sql, ...parameters] = mocks.query.mock.calls[0]
  expect(sql).toContain('information_schema.')
  expect(sql).not.toContain('svp_test_orders'); expect(sql).not.toContain('token_amount')
  expect(parameters).toEqual(['svp_test_orders', 'token_amount'])
  expect(sql).toContain(provider === 'mysql' ? 'TABLE_SCHEMA=DATABASE()' : 'table_schema=current_schema()')
  mocks.query.mockResolvedValue([])
  expect(await columnExists('svp_test_orders', 'payment_asset')).toBe(false)
 })
 it('rejects malformed names before metadata access', async () => {
  for (const [table, column] of [['svp_test_orders); DROP TABLE auth_user', 'id'], ['svp_test_orders', 'id; DROP TABLE auth_user']]) {
   await expect(columnExists(table, column)).rejects.toThrow('Invalid SQL identifier')
  }
  expect(mocks.query).not.toHaveBeenCalled()
 })
 it('does not turn connectivity failures into absent-column results', async () => {
  mocks.query.mockRejectedValue(new Error('offline'))
  await expect(columnExists('svp_test_orders', 'token_amount')).rejects.toThrow('offline')
 })
})
