import { randomUUID } from 'node:crypto'
import { readFileSync } from 'node:fs'
import Database from 'better-sqlite3'
import { Kysely, SqliteDialect } from 'kysely'
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest'
import { Client } from '@modelcontextprotocol/sdk/client/index.js'
import { McpServer } from '@modelcontextprotocol/sdk/server/mcp.js'
import { InMemoryTransport } from '@modelcontextprotocol/sdk/inMemory.js'
import { pluginManifestSchema } from '@slothvault/plugin-sdk/protocol'
import type { PluginContext, PluginInvocation, PluginServer } from '@slothvault/plugin-sdk/server'
import factory from '../../../plugins/commissions/src/server'
import type { CommissionDetail } from '../../../plugins/commissions/src/domain'
const mocks = vi.hoisted(() => ({ invoke: vi.fn() }))
vi.mock('@/server/plugins/manager', () => ({ initializePlugins: vi.fn(), invokeRegisteredPlugin: mocks.invoke }))
vi.mock('@/server/services/membership', () => ({ getActiveMemberships: vi.fn() }))
import { registerPluginMcpTools } from './mcp'
import { pluginRegistry } from './state'
import { setMcpAuditSink, type McpAuditEvent } from '@/server/mcp/registry'

const manifest = pluginManifestSchema.parse(JSON.parse(readFileSync('plugins/commissions/plugin.json', 'utf8')))
let db: Kysely<Record<string, Record<string, unknown>>>, sql: Database.Database, backend: PluginServer, client: Client, server: McpServer
let events: McpAuditEvent[], host: PluginContext
beforeEach(async () => {
  sql = new Database(':memory:'); sql.pragma('foreign_keys = ON')
  sql.exec('CREATE TABLE auth_user (id INTEGER PRIMARY KEY); INSERT INTO auth_user VALUES (7), (8);')
  for (const table of manifest.tables) {
    const columns = table.columns.map(col => `${col.name} ${col.type === 'integer' ? 'INTEGER' : 'TEXT'}${col.primary ? ' PRIMARY KEY' : ''}${col.nullable ? '' : ' NOT NULL'}${col.references ? ` REFERENCES ${col.references.table}(${col.references.column}) ON DELETE ${col.references.onDelete}` : ''}`)
    sql.exec(`CREATE TABLE ${table.name} (${columns.join(',')})`)
    for (const [i, index] of table.indexes.entries()) sql.exec(`CREATE ${index.unique ? 'UNIQUE ' : ''}INDEX ${table.name}_${i} ON ${table.name}(${index.columns.join(',')})`)
  }
  db = new Kysely({ dialect: new SqliteDialect({ database: sql }) })
  host = { manifest, provider: 'sqlite', config: {}, table: (name: string) => name, db,
    evidence: { prepare: vi.fn(), validateSigned: vi.fn(), broadcast: vi.fn(), observe: vi.fn() },
    users: { snapshot: vi.fn(), find: vi.fn(async () => [{ id: 8, username: 'customer', displayName: null, role: 'USER', status: 1 }]) },
    files: { inspect: vi.fn(), ensure: vi.fn(async () => []) },
  } as unknown as PluginContext
  backend = await factory(host); await backend.onInstall!()
  mocks.invoke.mockReset().mockImplementation(async (_item, group: string, key: string, invocation: PluginInvocation) => {
    expect(group).toBe('mcp')
    return backend.mcp![key](invocation)
  })
  pluginRegistry.clear(); pluginRegistry.set(manifest.id, { manifest, installed: true, enabled: true, generation: 1, digest: 'a'.repeat(64), configCiphertext: '' })
  events = []; setMcpAuditSink(event => { events.push(event) })
  server = new McpServer({ name: 'commission-mcp-tests', version: '1.0.0' })
  await registerPluginMcpTools(server, { authentication: 'mcp-api-key', apiKeyId: 13, userId: 7, username: 'admin' })
  client = new Client({ name: 'test', version: '1.0.0' })
  const [a, b] = InMemoryTransport.createLinkedPair(); await server.connect(a); await client.connect(b)
})
afterEach(async () => { await client?.close(); await server?.close(); await db?.destroy(); pluginRegistry.clear(); setMcpAuditSink(() => {}) })
const call = (key: string, args: Record<string, unknown> = {}) => client.callTool({ name: `${manifest.id}.${key}`, arguments: args })
async function draft() {
  const result = await call('create-draft', { commandId: randomUUID(), revision: 0, title: 'MCP draft', customerId: null })
  expect(result.isError).not.toBe(true)
  return (result.structuredContent as { data: { detail: CommissionDetail } }).data.detail
}
describe('real commissions manifest and backend over the MCP adapter', () => {
  it('discovers exactly the declared schemas and reads/creates/updates a draft with host actor and business audit', async () => {
    expect((await client.listTools()).tools.map(tool => tool.name).sort()).toEqual(manifest.mcp.map(tool => tool.name).sort())
    for (const tool of manifest.mcp) expect(backend.mcp?.[tool.key]).toBeTypeOf('function')
    expect((await call('templates')).isError).not.toBe(true)
    let view = await draft()
    expect(view.commission).toMatchObject({ stage: 'DRAFT', createdBy: 7, customerId: null, paymentPercent: 0 })
    const updated = await call('update-draft', { commandId: randomUUID(), revision: view.commission.revision, commissionId: view.commission.id, data: { title: 'Updated draft', description: 'Unpublished work' } })
    expect(updated.isError).not.toBe(true)
    view = (updated.structuredContent as { data: { detail: CommissionDetail } }).data.detail
    expect(view.commission.title).toBe('Updated draft')
    expect((await call('detail', { commissionId: view.commission.id })).isError).not.toBe(true)
    expect((await call('list')).isError).not.toBe(true)
    expect(events).toHaveLength(5)
    expect(events.every(event => event.ok && event.principalUserId === 7 && event.apiKeyId === 13)).toBe(true)
    const rows = sql.prepare('SELECT data_json FROM events').all() as { data_json: string }[]
    expect(rows).toHaveLength(2)
    expect(rows.map(row => JSON.parse(row.data_json))).toEqual(expect.arrayContaining([expect.objectContaining({ actorId: 7 })]))
    expect(host.evidence.prepare).not.toHaveBeenCalled(); expect(host.evidence.broadcast).not.toHaveBeenCalled()
  })
  it('cannot smuggle formal actions, actor or business state through draft endpoints or nested patches', async () => {
    const view = await draft(), base = { commandId: randomUUID(), revision: view.commission.revision, commissionId: view.commission.id, data: { title: 'No changes' } }
    for (const action of ['submit-request', 'publish-contract', 'confirm-contract', 'payment', 'deliver', 'sign', 'broadcast']) {
      expect((await call('update-draft', { ...base, commandId: randomUUID(), action })).isError).toBe(true)
      expect((await call('update-draft', { ...base, commandId: randomUUID(), data: { action } })).isError).toBe(true)
      expect((await call('create-draft', { commandId: randomUUID(), revision: 0, title: 'Forbidden', action })).isError).toBe(true)
    }
    for (const patch of [{ actor: { userId: 8, role: 'ADMIN' } }, { stage: 'MAINTENANCE' }, { paymentPercent: 100 }, { contracts: [] }]) {
      expect((await call('update-draft', { ...base, commandId: randomUUID(), data: patch })).isError).toBe(true)
    }
    expect((await call('create-draft', { commandId: randomUUID(), revision: 0, title: 'Forbidden', actor: { userId: 8 } })).isError).toBe(true)
    const row = sql.prepare('SELECT data_json FROM commissions WHERE id = ?').get(view.commission.id) as { data_json: string }
    expect(JSON.parse(row.data_json)).toMatchObject({ stage: 'DRAFT', revision: 0, title: 'MCP draft', createdBy: 7, paymentPercent: 0 })
    expect(sql.prepare('SELECT COUNT(*) AS count FROM evidence').get()).toEqual({ count: 0 })
    expect(host.evidence.prepare).not.toHaveBeenCalled(); expect(host.evidence.validateSigned).not.toHaveBeenCalled(); expect(host.evidence.broadcast).not.toHaveBeenCalled()
    expect(events.some(event => !event.ok)).toBe(true)
    expect(events.every(event => event.principalUserId === 7 && event.apiKeyId === 13)).toBe(true)
  })
})
