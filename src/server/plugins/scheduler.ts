/**
 * @file scheduler.ts
 * @project SlothVault
 * @module Plugin Task Runtime
 * @description Dispatches bounded durable hooks and interval jobs outside business request locks.
 * @logic Claim one task at a time under a short maintenance lock, execute worker computation outside it, and let individual RPC transactions coordinate their database access.
 * @dependencies plugin registry, Worker supervisor, maintenance lock, Prisma
 * @index_tags plugins,tasks,jobs,outbox,retry
 * @author holic512
 */
import 'server-only'
import { randomUUID } from 'node:crypto'
import { prisma } from '@/server/prisma'
import { withMaintenanceLock } from '@/server/services/maintenance-lock'
import { pluginRegistry, type RegisteredPlugin } from './state'
import { invokeRegisteredPlugin } from './manager'
import { pluginWorkers, stopPluginWorker } from './runtime'
const state = globalThis as unknown as { slothVaultPluginTimer?: ReturnType<typeof setInterval>; slothVaultPluginTick?: boolean }
export async function tickPluginTasks() {
  if (state.slothVaultPluginTick) return
  state.slothVaultPluginTick = true
  try {
    const due = await withMaintenanceLock('exclusive', async () => {
      for (const item of pluginRegistry.values()) {
        if (!item.installed || !item.enabled) continue
        for (const job of item.manifest.jobs) {
          const queued = await prisma.pluginTask.findFirst({
            where: { pluginId: item.manifest.id, kind: 'job', handler: job.key, status: { in: ['PENDING', 'RUNNING'] } },
            select: { id: true },
          })
          if (!queued) await prisma.pluginTask.create({ data: {
            pluginId: item.manifest.id, taskKey: randomUUID(), kind: 'job', handler: job.key,
            runAt: new Date(Date.now() + job.intervalSeconds * 1000),
          } })
        }
      }
      return prisma.pluginTask.findMany({
        where: { status: 'PENDING', runAt: { lte: new Date() } },
        orderBy: { id: 'asc' }, take: 32, select: { id: true, taskKey: true },
      })
    })

    for (const candidate of due) {
      // A previous handler can outlive an admin disable/upgrade/restore. Claim
      // only the next task, using its durable identity rather than stale rows.
      const claimed = await withMaintenanceLock('exclusive', async () => {
        const task = await prisma.pluginTask.findUnique({ where: { id: candidate.id } })
        if (!task || task.taskKey !== candidate.taskKey || task.status !== 'PENDING' || task.runAt > new Date()) return null
        const item: RegisteredPlugin | undefined = pluginRegistry.get(task.pluginId)
        const declared = task.kind === 'job'
          ? item?.manifest.jobs.some(job => job.key === task.handler)
          : task.kind === 'event' && item?.manifest.events.includes(task.handler)
        if (!item?.installed || !item.enabled || !declared) {
          await prisma.pluginTask.update({ where: { id: task.id }, data: { status: 'CANCELED' } })
          return null
        }
        const updated = await prisma.pluginTask.updateMany({
          where: { id: task.id, status: 'PENDING' },
          data: { status: 'RUNNING', attempts: { increment: 1 } },
        })
        return updated.count ? { task, item, attempt: task.attempts + 1 } : null
      })
      if (!claimed) continue
      const { task, item, attempt } = claimed
      let succeeded = false
      try {
        await invokeRegisteredPlugin(item, task.kind === 'job' ? 'jobs' : 'events', task.handler,
          JSON.parse(task.payloadJson), true, false,
          { id: task.taskKey, attempt, scheduledAt: task.runAt.toISOString() })
        succeeded = true
      } catch { /* Persist the bounded failure below. */ }
      await withMaintenanceLock('exclusive', () => prisma.pluginTask.updateMany({
        where: { id: task.id, taskKey: task.taskKey, status: 'RUNNING', attempts: attempt },
        data: succeeded ? { status: 'SUCCEEDED', error: null } : {
          status: attempt >= 3 ? 'FAILED' : 'PENDING',
          runAt: new Date(Date.now() + 30_000 * 2 ** (attempt - 1)), error: 'PLUGIN_TASK_FAILED',
        },
      }))
    }
    await withMaintenanceLock('exclusive', () => prisma.pluginTask.deleteMany({ where: {
      status: { in: ['SUCCEEDED', 'CANCELED', 'FAILED'] }, createdAt: { lt: new Date(Date.now() - 7 * 86400_000) },
    } }))
    for (const [id, worker] of pluginWorkers) {
      if (!worker.pending.size && Date.now() - worker.lastUsed > 300_000) await stopPluginWorker(id)
    }
  } finally { state.slothVaultPluginTick = false }
}
export function initializePluginScheduler() {
  if (process.env.NEXT_PHASE === 'phase-production-build' || process.env.NODE_ENV === 'test' || state.slothVaultPluginTimer) return
  state.slothVaultPluginTimer = setInterval(() => { void tickPluginTasks().catch(() => console.error('[plugins] Background tick could not complete')) }, 15_000)
  state.slothVaultPluginTimer.unref()
}
export function stopPluginScheduler() { if (state.slothVaultPluginTimer) clearInterval(state.slothVaultPluginTimer); state.slothVaultPluginTimer = undefined }
