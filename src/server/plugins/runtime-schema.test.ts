import { beforeEach, describe, expect, it, vi } from 'vitest'
import { pluginManifestSchema } from '@slothvault/plugin-sdk/protocol'
import { createPluginContext } from '@slothvault/plugin-sdk/server'
const mocks = vi.hoisted(() => ({ columnExists: vi.fn() }))
vi.mock('./database', async original => ({ ...await original<typeof import('./database')>(), columnExists: mocks.columnExists }))
import { PluginWorker } from './runtime'
import { PluginTransactions } from './database'

const manifest = pluginManifestSchema.parse({
 schema: 1, id: 'test.schema', name: 'Migration inspection', author: 'test', version: '1.0.0', engines: { slothvault: '*', sdk: '*', node: '*' }, capabilities: ['database'],
 tables: [{ name: 'orders', columns: [{ name: 'id', type: 'integer', primary: true }, { name: 'token_amount', type: 'string', nullable: true }] }],
})
function boundary(overrides: Partial<{ ddl: boolean; readOnly: boolean; active: boolean }> = {}, capability = true) {
 const postMessage = vi.fn(), transactions = new PluginTransactions()
 const scope = { scheduledJob: false, actor: null, transactions, ddl: true, readOnly: false, background: false, active: true, hosts: new Set<Promise<void>>(), ...overrides }
 const worker = Object.create(PluginWorker.prototype) as PluginWorker
 Object.assign(worker, { registered: { manifest: { ...manifest, capabilities: capability ? manifest.capabilities : [] } }, tables: { orders: 'svp_test_orders' }, pending: new Map(), stopped: false, worker: { postMessage } })
 worker.pending.set('migration', { resolve: () => {}, reject: () => {}, timer: undefined, scope } as unknown as Parameters<typeof worker.pending.set>[1])
 const call = (payload: Record<string, unknown> = { table: 'orders', column: 'token_amount' }) => worker.host({ id: 1, invocationId: 'migration', method: 'schema.hasColumn', payload })
 return { worker, transactions, scope, call, postMessage }
}
beforeEach(() => { vi.clearAllMocks(); mocks.columnExists.mockResolvedValue(true) })

describe('migration-only declared-column inspection', () => {
 it('forwards the SDK logical table and returns only the host boolean', async () => {
  const host = vi.fn().mockResolvedValue(false)
  const ctx = createPluginContext({ manifest, config: {}, provider: 'sqlite', tables: { orders: 'svp_test_orders' } }, host)
  expect(await ctx.schema.hasColumn('orders', 'token_amount')).toBe(false)
  expect(host).toHaveBeenCalledWith('schema.hasColumn', { table: 'orders', column: 'token_amount' })
  const b = boundary(); await b.call()
  expect(mocks.columnExists).toHaveBeenCalledWith('svp_test_orders', 'token_amount')
  expect(b.postMessage).toHaveBeenCalledWith({ type: 'host-result', id: 1, value: true })
 })
 it.each([{ ddl: false }, { readOnly: true }, { active: false }])('denies unavailable migration scopes before querying metadata (%j)', async override => {
  const b = boundary(override); await b.call()
  expect(mocks.columnExists).not.toHaveBeenCalled()
  expect(b.postMessage).toHaveBeenCalledWith(expect.objectContaining({ error: expect.objectContaining({ status: override.active === false ? 409 : 403 }) }))
 })
 it('denies inspection without database capability or while an SQL transaction is active', async () => {
  const without = boundary({}, false); await without.call()
  expect(without.postMessage).toHaveBeenCalledWith(expect.objectContaining({ error: expect.objectContaining({ status: 403 }) }))
  const transaction = boundary(); vi.spyOn(transaction.transactions, 'active', 'get').mockReturnValue(true)
  await transaction.call()
  expect(transaction.postMessage).toHaveBeenCalledWith(expect.objectContaining({ error: expect.objectContaining({ status: 403 }) }))
  expect(mocks.columnExists).not.toHaveBeenCalled()
 })
 it.each([{ table: 'auth_user', column: 'id' }, { table: 'svp_test_orders', column: 'id' }, { table: 'other', column: 'token_amount' }, { table: 'orders', column: 'password' }, { table: 'orders', column: 'token_amount; DROP TABLE auth_user' }])('denies undeclared tables and columns (%j)', async payload => {
  const b = boundary(); await b.call(payload)
  expect(mocks.columnExists).not.toHaveBeenCalled()
  expect(b.postMessage).toHaveBeenCalledWith(expect.objectContaining({ error: expect.objectContaining({ status: 403 }) }))
 })
 it('does not expose raw metadata query errors to plugin code', async () => {
  mocks.columnExists.mockRejectedValue(new Error('private database connection and SQL details'))
  const b = boundary(); await b.call()
  expect(b.postMessage).toHaveBeenCalledWith({ type: 'host-result', id: 1, error: { message: 'Plugin host operation failed', status: 500 } })
 })
 it('denies missing invocations and discards inspection results after cancellation', async () => {
  const absent = boundary(); absent.worker.pending.clear(); await absent.call()
  expect(mocks.columnExists).not.toHaveBeenCalled()
  expect(absent.postMessage).toHaveBeenCalledWith(expect.objectContaining({ error: expect.objectContaining({ status: 409 }) }))
  const b = boundary(); mocks.columnExists.mockImplementation(async () => { b.scope.active = false; return true })
  await b.call()
  expect(b.postMessage).toHaveBeenCalledWith(expect.objectContaining({ error: expect.objectContaining({ status: 409 }) }))
 })
})
