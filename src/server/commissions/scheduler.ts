/**
 * @file scheduler.ts
 * @project SlothVault
 * @module Commission Background Maintenance
 * @description Closes expired maintenance windows and reconciles already-signed evidence transactions.
 * @logic Run one bounded minute tick per process, use database idempotency across instances and recover overdue work at startup.
 * @dependencies workflow maintenance commands, evidence reconciliation, Prisma
 * @index_tags commissions,scheduler,maintenance,evidence
 * @author holic512
 */
import 'server-only'
import { acquireMaintenanceLock } from '@/server/services/maintenance-lock'
import { prisma } from '@/server/prisma'
import { closeExpiredMaintenance } from './workflow'
import { reconcileWorkflowEvidence } from './evidence'
const globalRuntime = globalThis as unknown as { commissionScheduler?: { timer?: ReturnType<typeof setInterval>; running: boolean } }
const runtime = globalRuntime.commissionScheduler ??= { running: false }
export async function tickCommissionScheduler() {
  if (runtime.running) return
  runtime.running = true
  let release: (() => void) | undefined
  try {
    release = await acquireMaintenanceLock('shared')
    await closeExpiredMaintenance()
    await prisma.commissionProofAttempt.updateMany({ where: { status: 'PREPARED', expiresAt: { lte: new Date() } }, data: { status: 'FAILED', error: '钱包签名请求已过期' } })
    const pending = await prisma.commissionProofAttempt.findMany({ where: { status: 'SUBMITTED' }, orderBy: { id: 'asc' }, select: { id: true }, take: 10 })
    for (const attempt of pending) await reconcileWorkflowEvidence(attempt.id).catch(() => undefined)
  } finally { release?.(); runtime.running = false }
}
export function initializeCommissionRuntime() {
  if (process.env.NEXT_PHASE === 'phase-production-build' || runtime.timer) return
  const run = () => void tickCommissionScheduler().catch(() => console.error('[commissions] Maintenance/evidence tick could not complete'))
  runtime.timer = setInterval(run, 60_000)
  runtime.timer.unref()
  run()
}
