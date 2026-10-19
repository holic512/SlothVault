import { beforeEach, describe, expect, it, vi } from 'vitest'
import { pluginManifestSchema } from '@slothvault/plugin-sdk/protocol'

const mocks = vi.hoisted(() => ({
  tasks: [] as { id: number; taskKey: string; pluginId: string; kind: string; handler: string; status: string; attempts: number; payloadJson: string; runAt: Date }[],
  invoke: vi.fn(),
  deleteMany: vi.fn(),
}))
vi.mock('@/server/prisma', () => ({ prisma: { pluginTask: {
  findMany: async () => mocks.tasks.filter(task => task.status === 'PENDING').map(task => ({ ...task })),
  findUnique: async ({ where }: { where: { id: number } }) => { const task = mocks.tasks.find(task => task.id === where.id); return task ? { ...task } : null },
  update: async ({ where, data }: { where: { id: number }; data: object }) => Object.assign(mocks.tasks.find(task => task.id === where.id)!, data),
  updateMany: async ({ where, data }: { where: { id: number; status: string }; data: { status: string; attempts?: { increment: number } } }) => {
    const task = mocks.tasks.find(task => task.id === where.id && task.status === where.status)
    if (!task) return { count: 0 }
    task.status = data.status
    if (data.attempts) task.attempts += data.attempts.increment
    return { count: 1 }
  },
  deleteMany: mocks.deleteMany,
} } }))
vi.mock('@/server/services/maintenance-lock', () => ({ withMaintenanceLock: (_mode: string, run: () => unknown) => run() }))
vi.mock('./manager', () => ({ invokeRegisteredPlugin: mocks.invoke }))
vi.mock('./runtime', () => ({ pluginWorkers: new Map(), stopPluginWorker: vi.fn() }))
import { pluginRegistry } from './state'
import { tickPluginTasks } from './scheduler'

const id = 'test.scheduler'
beforeEach(() => {
  vi.clearAllMocks()
  pluginRegistry.clear()
  pluginRegistry.set(id, {
    manifest: pluginManifestSchema.parse({ schema: 1, id, name: 'Scheduler', version: '1.0.0', author: 'test', engines: { slothvault: '*', sdk: '*', node: '*' }, server: 'server/index.mjs', capabilities: ['events'], events: ['test.event'] }),
    digest: '0'.repeat(64), installed: true, enabled: true, generation: 1, configCiphertext: '', accessBindings: {},
  })
  mocks.tasks = [1, 2].map(n => ({ id: n, taskKey: `task-${n}`, pluginId: id, kind: 'event', handler: 'test.event', status: 'PENDING', attempts: 0, payloadJson: '{}', runAt: new Date(0) }))
  mocks.invoke.mockResolvedValue(undefined)
})

describe('plugin task admission', () => {
  it('does not execute a canceled queued task after disable and re-enable', async () => {
    mocks.invoke.mockImplementationOnce(async () => {
      mocks.tasks[1].status = 'CANCELED'
      pluginRegistry.get(id)!.generation += 2
    })
    await tickPluginTasks()
    expect(mocks.invoke).toHaveBeenCalledTimes(1)
    expect(mocks.tasks[1]).toMatchObject({ status: 'CANCELED', attempts: 0 })
  })

  it('cancels obsolete handlers without activating a worker or retrying forever', async () => {
    pluginRegistry.get(id)!.manifest.events = []
    await tickPluginTasks()
    expect(mocks.invoke).not.toHaveBeenCalled()
    expect(mocks.tasks.map(task => task.status)).toEqual(['CANCELED', 'CANCELED'])
  })

  it('retains failed task history only for the bounded retention window', async () => {
    await tickPluginTasks()
    expect(mocks.deleteMany).toHaveBeenCalledWith({ where: {
      status: { in: ['SUCCEEDED', 'CANCELED', 'FAILED'] }, createdAt: { lt: expect.any(Date) },
    } })
  })
})
