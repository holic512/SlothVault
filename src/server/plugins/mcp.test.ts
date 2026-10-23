import { readFileSync } from 'node:fs'
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest'
import { Client } from '@modelcontextprotocol/sdk/client/index.js'
import { McpServer } from '@modelcontextprotocol/sdk/server/mcp.js'
import { InMemoryTransport } from '@modelcontextprotocol/sdk/inMemory.js'
import { pluginManifestSchema, type PluginManifest } from '@slothvault/plugin-sdk/protocol'
import { z } from 'zod'

const mocks = vi.hoisted(() => ({ initialize: vi.fn(), invoke: vi.fn(), memberships: vi.fn() }))
vi.mock('@/server/plugins/manager', () => ({ initializePlugins: mocks.initialize, invokeRegisteredPlugin: mocks.invoke }))
vi.mock('@/server/services/membership', () => ({ getActiveMemberships: mocks.memberships }))
import { collectPluginMcpToolDefinitions, pluginMcpInputSchema, registerPluginMcpTools } from './mcp'
import { pluginRegistry, type RegisteredPlugin } from './state'
import { collectMcpToolDefinitions, registerMcpToolDefinitions, setMcpAuditSink, type McpAuditEvent, type McpToolDefinition } from '@/server/mcp/registry'
import { MCP_MAX_TOOL_INPUT_ELEMENTS } from '@/server/mcp/limits'
import { HttpError } from '@/server/http/errors'
import type { McpPrincipal } from '@/server/services/mcp-api-keys'

const principal: McpPrincipal = { authentication: 'mcp-api-key', apiKeyId: 13, userId: 7, username: 'test-admin' }
const empty = { type: 'object', properties: {}, additionalProperties: false }
const contribution = (overrides: Partial<PluginManifest['mcp'][number]> = {}): PluginManifest['mcp'][number] => ({
  key: 'lookup', name: 'test.plugin.lookup', title: 'Lookup', description: 'Read a record', inputSchema: empty,
  access: { audience: 'admin', membershipLevelIds: [] }, operation: 'read', readOnly: true, ...overrides,
})
function install(tools = [contribution()], id = 'test.plugin'): RegisteredPlugin {
  const manifest = pluginManifestSchema.parse({ schema: 1, id, name: 'Test', version: '1.0.0', author: 'test', engines: { slothvault: '*', sdk: '*', node: '*' }, server: 'server/main.mjs', mcp: tools })
  const item = { manifest, installed: true, enabled: true, generation: 1, digest: 'a'.repeat(64), configCiphertext: '' }
  pluginRegistry.set(id, item)
  return item
}
let audit: McpAuditEvent[] = []
const sessions: { client: Client; server: McpServer }[] = []
async function connect(definitions?: McpToolDefinition[], identity = principal) {
  const server = new McpServer({ name: 'plugin-tests', version: '1.0.0' }, { maxToolInputElements: MCP_MAX_TOOL_INPUT_ELEMENTS })
  if (definitions) registerMcpToolDefinitions(server, definitions, identity)
  else await registerPluginMcpTools(server, identity)
  const client = new Client({ name: 'plugin-tests', version: '1.0.0' })
  sessions.push({ client, server })
  const [a, b] = InMemoryTransport.createLinkedPair()
  await server.connect(a); await client.connect(b)
  return client
}
beforeEach(() => {
  vi.clearAllMocks(); pluginRegistry.clear(); audit = []
  setMcpAuditSink(event => { audit.push(event) })
  mocks.invoke.mockResolvedValue({ ok: true }); mocks.initialize.mockResolvedValue(undefined)
})
afterEach(async () => {
  for (const { client, server } of sessions.splice(0)) { await client.close(); await server.close() }
  pluginRegistry.clear(); setMcpAuditSink(() => {}); vi.restoreAllMocks()
})

describe('bounded plugin JSON schema conversion', () => {
  it('preserves nested required, strict objects, array and primitive constraints in the advertised schema', () => {
    const schema = pluginMcpInputSchema({ type: 'object', additionalProperties: false, properties: {
      id: { type: 'integer', minimum: 1, maximum: 100 }, name: { type: 'string', minLength: 2, maxLength: 20, description: 'Name' },
      values: { type: 'array', minItems: 1, maxItems: 3, items: { type: 'boolean' } },
      nested: { type: 'object', properties: { kind: { type: 'string', enum: ['draft', 'read'] } }, required: ['kind'], additionalProperties: false },
      customer: { type: ['integer', 'null'] }, revision: { type: 'integer', const: 0 },
    }, required: ['id', 'name', 'values', 'nested', 'revision'] })
    const valid = { id: 3, name: 'Test', values: [true], nested: { kind: 'draft' }, customer: null, revision: 0 }
    expect(schema.parse(valid)).toEqual(valid)
    for (const patch of [{ id: 1.2 }, { id: 101 }, { name: 'a' }, { values: [] }, { nested: {} }, { revision: 1 }, { customer: '1' }, { extra: true }]) expect(schema.safeParse({ ...valid, ...patch }).success).toBe(false)
    const json = z.toJSONSchema(schema)
    expect(json).toMatchObject({ type: 'object', additionalProperties: false, required: ['id', 'name', 'values', 'nested', 'revision'], properties: { id: { type: 'integer', minimum: 1, maximum: 100 }, name: { description: 'Name', minLength: 2, maxLength: 20 }, revision: { const: 0 } } })
  })
  it('preserves explicitly/open-by-default draft data objects', () => {
    expect(pluginMcpInputSchema({ type: 'object', properties: { data: { type: 'object' } }, additionalProperties: false }).parse({ data: { title: 'Draft' } })).toEqual({ data: { title: 'Draft' } })
  })
  it.each([
    { $ref: 'https://example.invalid/schema' }, { type: 'string', pattern: '(a+)+$' },
    { type: 'object', patternProperties: { '.*': {} } }, { type: 'object', oneOf: [{}] },
    { type: 'object', if: {}, then: {} }, { type: 'object', additionalProperties: {} },
    { type: 'array' }, { type: 'string', format: 'unknown' },
    { type: 'integer', enum: ['1'] }, { type: 'string', enum: ['x'], minLength: 2 },
    { type: 'integer', const: 0, minimum: 1 }, { type: 'integer', const: 2, enum: [1] },
    { type: 'object', required: ['missing'] }, { type: 'string', maxLength: 1000000 },
    { type: ['object', 'integer'] },
  ])('rejects unsupported or contradictory schema %j', child => {
    expect(() => pluginMcpInputSchema({ type: 'object', properties: { value: child } })).toThrow()
  })
  it('rejects unsafe keys, non-JSON, cycles, excessive depth and aggregate sizes', () => {
    expect(() => pluginMcpInputSchema(JSON.parse('{"type":"object","properties":{"__proto__":{"type":"string"}}}'))).toThrow()
    const cyclic: Record<string, unknown> = { type: 'object' }; cyclic.properties = { child: cyclic }
    expect(() => pluginMcpInputSchema(cyclic)).toThrow()
    let nested: Record<string, unknown> = empty
    for (let i = 0; i < 10; i++) nested = { type: 'object', properties: { nested } }
    expect(() => pluginMcpInputSchema(nested)).toThrow()
    expect(() => pluginMcpInputSchema({ ...empty, title: 'x'.repeat(33000) })).toThrow()
    expect(() => pluginMcpInputSchema({ ...empty, properties: Object.fromEntries(Array.from({ length: 101 }, (_, i) => [`k${i}`, { type: 'string' }])) })).toThrow()
    expect(() => pluginMcpInputSchema({ ...empty, title: () => null })).toThrow()
  })
  it('compiles every real commissions manifest schema including nullable customer, revision const and draft patch', () => {
    const manifest = pluginManifestSchema.parse(JSON.parse(readFileSync('plugins/commissions/plugin.json', 'utf8')))
    expect(manifest.mcp).toHaveLength(5)
    for (const tool of manifest.mcp) expect(z.toJSONSchema(pluginMcpInputSchema(tool.inputSchema)).type).toBe('object')
    expect(pluginMcpInputSchema(manifest.mcp.find(tool => tool.key === 'create-draft')!.inputSchema).parse({ commandId: 'test-command', revision: 0, title: 'Draft', customerId: null })).toMatchObject({ customerId: null, revision: 0 })
    expect(pluginMcpInputSchema(manifest.mcp.find(tool => tool.key === 'update-draft')!.inputSchema).parse({ commandId: 'test-command', revision: 2, commissionId: 'c1', data: { title: 'Draft' } })).toMatchObject({ data: { title: 'Draft' } })
  })
})

describe('plugin MCP registration and authenticated execution', () => {
  it('lists only installed enabled declarations, without starting workers; disabled tools disappear on the next stateless request', async () => {
    const item = install()
    expect((await (await connect()).listTools()).tools.map(tool => tool.name)).toEqual(['test.plugin.lookup'])
    expect(mocks.initialize).toHaveBeenCalledOnce(); expect(mocks.invoke).not.toHaveBeenCalled()
    item.enabled = false
    expect(await collectPluginMcpToolDefinitions(principal)).toEqual([])
    item.enabled = true; item.installed = false
    expect(await collectPluginMcpToolDefinitions(principal)).toEqual([])
  })
  it('binds the host administrator and audits the authenticated user/key, not actor input or client metadata', async () => {
    install([contribution({ inputSchema: { type: 'object' } })])
    mocks.invoke.mockResolvedValue({ id: 9, token: 'secret', nested: { privateKey: 'hidden', value: true } })
    const client = await connect()
    const result = await client.callTool({ name: 'test.plugin.lookup', arguments: { actor: { userId: 999, role: 'ADMIN' }, principal: { userId: 999 }, apiKeyId: 999 }, _meta: { userId: 999 } })
    expect(mocks.invoke).toHaveBeenCalledWith(expect.anything(), 'mcp', 'lookup', expect.objectContaining({ actor: { userId: 7, role: 'ADMIN' } }), false, true)
    expect(result.structuredContent).toEqual({ data: { id: '9', nested: { value: true } } })
    expect(audit).toEqual([expect.objectContaining({ principalUserId: 7, apiKeyId: 13, name: 'test.plugin.lookup', kind: 'tool', ok: true })])
    expect(JSON.stringify(audit)).not.toMatch(/secret|hidden|999/)
  })
  it.each(['admin', 'user', 'public', 'memberships'] as const)('respects the current administrator-only MCP principal for %s contributions', async audience => {
    install([contribution({ access: { audience, membershipLevelIds: [1] } })])
    expect(await collectPluginMcpToolDefinitions(principal)).toHaveLength(1)
    expect(mocks.memberships).not.toHaveBeenCalled()
  })
  it.each(['disabled', 'uninstalled', 'generation', 'digest', 'removed', 'changed'] as const)('rechecks %s after registration and audits rejection', async change => {
    const item = install(); const client = await connect()
    if (change === 'disabled') item.enabled = false
    if (change === 'uninstalled') item.installed = false
    if (change === 'generation') item.generation++
    if (change === 'digest') item.digest = 'b'.repeat(64)
    if (change === 'removed') item.manifest.mcp = []
    if (change === 'changed') item.manifest.mcp[0].access.audience = 'public'
    expect((await client.callTool({ name: 'test.plugin.lookup' })).isError).toBe(true)
    expect(mocks.invoke).not.toHaveBeenCalled(); expect(audit[0]).toMatchObject({ ok: false, principalUserId: 7 })
  })
  it('rejects non-MCP principals even for public tools', async () => {
    install([contribution({ access: { audience: 'public', membershipLevelIds: [] } })])
    const invalid = { ...principal, authentication: 'session' } as unknown as McpPrincipal
    await expect(collectPluginMcpToolDefinitions(invalid)).rejects.toMatchObject({ status: 401 })
    const definitions = await collectPluginMcpToolDefinitions(principal)
    expect((await (await connect(definitions, invalid)).callTool({ name: 'test.plugin.lookup' })).isError).toBe(true)
    expect(mocks.invoke).not.toHaveBeenCalled(); expect(audit[0].ok).toBe(false)
  })
  it('enforces input schema before worker dispatch and preserves useful advertised tool fields', async () => {
    install([contribution({ inputSchema: { type: 'object', properties: { id: { type: 'integer', minimum: 1 } }, required: ['id'], additionalProperties: false } })])
    const client = await connect(), tools = (await client.listTools()).tools
    expect(tools[0]).toMatchObject({ name: 'test.plugin.lookup', title: 'Lookup', annotations: { readOnlyHint: true }, inputSchema: { required: ['id'], additionalProperties: false, properties: { id: { type: 'integer', minimum: 1 } } } })
    for (const args of [{}, { id: '1' }, { id: 1, actor: { userId: 999 } }]) expect((await client.callTool({ name: tools[0].name, arguments: args })).isError).toBe(true)
    expect(mocks.invoke).not.toHaveBeenCalled()
  })
  it('uses the explicit draft profile and false readOnly only for a draft declaration', async () => {
    install([contribution({ key: 'draft', name: 'test.plugin.create-draft', operation: 'draft', readOnly: false })])
    const definitions = await collectPluginMcpToolDefinitions(principal)
    expect(definitions[0]).toMatchObject({ policy: { profile: 'plugin', pluginId: 'test.plugin', operation: 'draft' }, risk: 'write', idempotency: 'unknown', resourcePermissions: [] })
    expect((await (await connect(definitions)).callTool({ name: definitions[0].name })).isError).not.toBe(true)
    expect(mocks.invoke).toHaveBeenCalledWith(expect.anything(), 'mcp', 'draft', { actor: { userId: 7, role: 'ADMIN' }, input: {} }, false, false)
  })
  it('omits unsafe/unsupported declarations and reserves host names without affecting healthy tools', async () => {
    vi.spyOn(console, 'warn').mockImplementation(() => {})
    const item = install([contribution(), contribution({ key: 'bad', name: 'test.plugin.bad', inputSchema: { ...empty, $ref: 'https://example.invalid' } })])
    item.manifest.mcp.push(contribution({ key: 'inconsistent', name: 'test.plugin.inconsistent', operation: 'draft', readOnly: true }))
    expect((await collectPluginMcpToolDefinitions(principal)).map(tool => tool.name)).toEqual(['test.plugin.lookup'])
    expect(await collectPluginMcpToolDefinitions(principal, new Set(['test.plugin.lookup']))).toEqual([])
  })
  it('omits ambiguous names from overlapping plugin namespaces', async () => {
    install([contribution({ name: 'test.plugin.child.lookup' })])
    install([contribution({ name: 'test.plugin.child.lookup' })], 'test.plugin.child')
    expect(await collectPluginMcpToolDefinitions(principal)).toEqual([])
  })
  it('maps handler failures and emits failed host audit events without arguments', async () => {
    install(); mocks.invoke.mockRejectedValue(new HttpError('Access denied', 403))
    expect((await (await connect()).callTool({ name: 'test.plugin.lookup' })).isError).toBe(true)
    expect(audit).toEqual([expect.objectContaining({ apiKeyId: 13, principalUserId: 7, ok: false })])
  })
})

describe('registry policy profiles', () => {
  it.each(['publish', 'sign', 'payment.record', 'broadcast', 'submit-request', 'confirm', 'delete'])('blocks formal plugin tool %s before handler dispatch', async suffix => {
    install([contribution({ name: `test.plugin.${suffix}`, operation: 'draft', readOnly: false })])
    const client = await connect()
    expect((await client.callTool({ name: `test.plugin.${suffix}` })).isError).toBe(true)
    expect(mocks.invoke).not.toHaveBeenCalled(); expect(audit[0].ok).toBe(false)
  })
  it.each(['risk', 'readonly', 'namespace', 'operation', 'permissions'] as const)('rejects inconsistent dynamic %s metadata', async change => {
    install(); const definitions = await collectPluginMcpToolDefinitions(principal), definition = definitions[0]
    if (change === 'risk') definition.risk = 'write'
    if (change === 'readonly') definition.annotations!.readOnlyHint = false
    if (change === 'namespace') definition.policy!.pluginId = 'other.plugin'
    if (change === 'operation') definition.policy!.operation = 'publish' as 'read'
    if (change === 'permissions') definition.resourcePermissions = ['managed-file:read']
    expect((await (await connect(definitions)).callTool({ name: definition.name })).isError).toBe(true)
    expect(mocks.invoke).not.toHaveBeenCalled()
  })
  it('keeps static metadata defaults, host lifecycle exceptions and audit enforcement unchanged', async () => {
    const handler = vi.fn(async () => ({ content: [], structuredContent: { ok: true } }))
    const definitions = collectMcpToolDefinitions(recorder => {
      for (const name of ['content.article.publish', 'content.article.delete']) recorder.defineTool(name, { title: name, description: name, inputSchema: z.object({}), outputSchema: z.object({ ok: z.boolean() }), annotations: { readOnlyHint: false } }, handler)
    })
    expect(definitions[0]).toMatchObject({ domain: 'content.article', risk: 'write', idempotency: 'non-idempotent', resourcePermissions: [] })
    expect(definitions[0].policy).toBeUndefined()
    const client = await connect(definitions)
    expect((await client.callTool({ name: 'content.article.publish' })).isError).not.toBe(true)
    expect((await client.callTool({ name: 'content.article.delete' })).isError).toBe(true)
    expect(handler).toHaveBeenCalledOnce(); expect(audit.map(event => event.ok)).toEqual([true, false])
  })
})
