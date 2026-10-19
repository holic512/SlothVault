import { beforeEach, describe, expect, it, vi } from 'vitest'
const mocks = vi.hoisted(() => ({ memberships: vi.fn() }))
vi.mock('@/server/services/membership', () => ({ getActiveMemberships: mocks.memberships }))
vi.mock('./manager', () => ({ initializePlugins: vi.fn() }))
import { canAccessPlugin, requirePluginAccess } from './access'
import { assertPluginQueryOwnership } from './runtime'
import { createPluginContext } from '@slothvault/plugin-sdk/server'
import type { PluginManifest } from '@slothvault/plugin-sdk/protocol'

describe('host-owned plugin permissions', () => {
  beforeEach(() => mocks.memberships.mockResolvedValue([{ id: '2' }]))
  it('fails closed and never treats hidden UI as API authorization', async () => {
    for (const audience of ['admin', 'user', 'memberships'] as const) await expect(requirePluginAccess({ audience, membershipLevelIds: [2] }, null)).rejects.toThrow()
    expect(await canAccessPlugin({ audience: 'admin', membershipLevelIds: [] }, { userId: 1, role: 'USER' })).toBe(false)
    expect(await canAccessPlugin({ audience: 'public', membershipLevelIds: [] }, null)).toBe(true)
    expect(await canAccessPlugin({ audience: 'memberships', membershipLevelIds: [] }, { userId: 1, role: 'USER' })).toBe(false)
    expect(await canAccessPlugin({ audience: 'memberships', membershipLevelIds: [2] }, { userId: 1, role: 'USER' })).toBe(true)
    expect(await canAccessPlugin({ audience: 'memberships', membershipLevelIds: [3] }, { userId: 1, role: 'USER' })).toBe(false)
  })
  it('restricts the SDK SQL bridge to declared tables and managed DDL', () => {
    const ctx = createPluginContext({ provider: 'sqlite', manifest: {} as PluginManifest, config: {}, tables: { rows: 'svp_test_rows' } }, vi.fn())
    expect(() => assertPluginQueryOwnership(ctx.db.selectFrom('svp_test_rows').selectAll().compile().query, { rows: 'svp_test_rows' }, false)).not.toThrow()
    expect(() => assertPluginQueryOwnership(ctx.db.selectFrom('auth_user').selectAll().compile().query, { rows: 'svp_test_rows' }, false)).toThrow('undeclared table')
    expect(() => assertPluginQueryOwnership(ctx.db.schema.dropTable('svp_test_rows').compile().query, { rows: 'svp_test_rows' }, false)).toThrow('migration target')
    expect(() => assertPluginQueryOwnership({ kind: 'CreateViewNode', query: ctx.db.selectFrom('svp_test_rows').selectAll().compile().query }, { rows: 'svp_test_rows' }, true)).toThrow('Unsupported portable')
    expect(() => assertPluginQueryOwnership({ kind: 'RawNode' }, { rows: 'svp_test_rows' }, true)).toThrow('raw SQL')
  })
  it('binds SDK events and core credit to the caller transaction, never a browser handle', async () => {
    const host = vi.fn(async (method: string) => method === 'db.begin' ? 'invocation-owned-id' : undefined)
    const ctx = createPluginContext({ provider: 'sqlite', manifest: {} as PluginManifest, config: {}, tables: {} }, host)
    await ctx.db.transaction().execute(async tx => {
      await ctx.emit('slothvault.example.changed', { id: 1 }, tx)
      await ctx.points.credit({ userId: 1, amount: 10, sourceKey: 'unique-key', description: 'test' }, tx)
    })
    expect(host).toHaveBeenCalledWith('events.emit', { event: 'slothvault.example.changed', payload: { id: 1 }, transactionId: 'invocation-owned-id' })
    expect(host).toHaveBeenCalledWith('points.credit', expect.objectContaining({ transactionId: 'invocation-owned-id' }))
    expect(host).toHaveBeenLastCalledWith('db.commit', { transactionId: 'invocation-owned-id' })
  })

})
