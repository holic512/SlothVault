import { beforeEach, describe, expect, it, vi } from 'vitest'
import { pluginManifestSchema } from '@slothvault/plugin-sdk/protocol'
const mocks = vi.hoisted(() => ({ prepare: vi.fn(), observe: vi.fn(), broadcast: vi.fn(), validate: vi.fn(), administrator: vi.fn(), inspect: vi.fn() }))
vi.mock('./evidence', () => ({ preparePluginEvidence: mocks.prepare, observePluginEvidence: mocks.observe, broadcastPluginEvidence: mocks.broadcast, validatePluginEvidence: mocks.validate }))
vi.mock('./files', () => ({ inspectPluginFile: mocks.inspect }))
vi.mock('@/server/auth/administrator', () => ({ assertActiveAdministrator: mocks.administrator }))
import { PluginWorker } from './runtime'
import { PluginTransactions } from './database'
function boundary(options: { role?: string; readOnly?: boolean; job?: boolean; capability?: boolean } = {}) {
  const manifest = pluginManifestSchema.parse({ schema: 1, id: 'test.evidence', name: 'Evidence', author: 'test', version: '1.0.0', engines: { slothvault: '*', sdk: '*', node: '*' }, capabilities: options.capability === false ? [] : ['evidence.memo'] })
  const postMessage = vi.fn(), transactions = new PluginTransactions()
  const scope = { actor: options.role ? { userId: 1, role: options.role } : null, readOnly: options.readOnly ?? false, scheduledJob: options.job ?? false, active: true, background: options.job ?? false, ddl: false, transactions, hosts: new Set<Promise<void>>() }
  const worker = Object.create(PluginWorker.prototype) as PluginWorker
  Object.assign(worker, { registered: { manifest }, tables: {}, pending: new Map(), stopped: false, worker: { postMessage } })
  worker.pending.set('call', { resolve: () => {}, reject: () => {}, timer: undefined, scope } as unknown as Parameters<typeof worker.pending.set>[1])
  return { postMessage, call: (method: string) => worker.host({ id: 1, invocationId: 'call', method, payload: {} }) }
}
beforeEach(() => { vi.clearAllMocks(); mocks.prepare.mockResolvedValue({}); mocks.observe.mockResolvedValue({ status: 'PENDING' }); mocks.broadcast.mockResolvedValue({ signature: 'test' }) })
describe('plugin evidence authorization', () => {
  it.each([{}, { role: 'USER' }, { role: 'ADMIN', readOnly: true }, { role: 'ADMIN', capability: false }, { job: true }])('denies preparing evidence outside active admin write scopes (%j)', async options => {
    const test = boundary(options); await test.call('evidence.prepare')
    expect(mocks.prepare).not.toHaveBeenCalled(); expect(test.postMessage).toHaveBeenCalledWith(expect.objectContaining({ error: expect.objectContaining({ status: 403 }) }))
  })
  it('allows public read-only observation but no mutation', async () => {
    const test = boundary({ readOnly: true }); await test.call('evidence.observe')
    expect(mocks.observe).toHaveBeenCalledWith('test.evidence', {})
  })
  it('checks active administrator status before preparing', async () => {
    const test = boundary({ role: 'ADMIN' }); await test.call('evidence.prepare')
    expect(mocks.administrator).toHaveBeenCalledWith(expect.anything(), 1)
    expect(mocks.prepare).toHaveBeenCalledWith('test.evidence', {})
  })
  it('allows declared background jobs to rebroadcast but not prepare', async () => {
    const test = boundary({ job: true }); await test.call('evidence.broadcast')
    expect(mocks.broadcast).toHaveBeenCalledWith('test.evidence', {})
  })
})
