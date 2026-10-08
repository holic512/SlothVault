/**
 * @file upgrade.ts
 * @project SlothVault
 * @module Prelaunch Contract Upgrade
 * @description Performs the authorized legacy-only contract purge once and seeds the new workflow.
 * @logic Transactionally mark exclusive old PDFs for cleanup, remove only unlinked legacy contracts, and retain a completion marker so retries never target new commissions.
 * @dependencies Prisma client, filesystem, managed upload root, template seed
 * @index_tags commissions,migration,legacy,cleanup,idempotency
 * @author holic512
 */
import 'server-only'
import type { AppPrismaClient } from '@/server/database/client'
import { mkdir, realpath, rename, unlink } from 'node:fs/promises'
import { relative, resolve, sep } from 'node:path'
import { UPLOAD_ROOT } from '@/server/services/admin-files'
import { seedCommissionTemplates } from './templates'
const marker = 'commission_legacy_cleanup_v1'
export async function upgradeCommissionLifecycle(client: AppPrismaClient) {
  await client.$transaction(async (tx) => {
    const completed = await tx.systemConfig.findUnique({ where: { configKey: marker } })
    if (completed) return
    const legacy = await tx.contract.findMany({ where: { commissionId: null }, select: { id: true, attachmentFileId: true } })
    const ids = legacy.map((c) => c.id), files = legacy.flatMap((c) => c.attachmentFileId ? [c.attachmentFileId] : [])
    const credentials = await tx.contractCredential.findMany({ where: { contractId: { in: ids } }, select: { id: true } })
    await tx.contractCredentialAttempt.deleteMany({ where: { credentialId: { in: credentials.map((c) => c.id) } } })
    await tx.contractCredential.deleteMany({ where: { contractId: { in: ids } } })
    await tx.contractAdminAudit.deleteMany({ where: { contractId: { in: ids } } })
    await tx.contract.deleteMany({ where: { id: { in: ids }, commissionId: null } })
    await tx.fileManagement.updateMany({ where: { id: { in: files }, businessType: 'ContractAttachment', contractAttachment: { is: null }, references: { none: {} } }, data: { status: -10 } })
    await tx.systemConfig.create({ data: { configKey: marker, configValue: JSON.stringify({ completed: true, contracts: ids.length }), description: 'Prelaunch legacy-only contract cleanup completed; never purge commission documents.' } })
  })
  // A durable status survives interruption between filesystem staging and metadata deletion.
  const pending = await client.fileManagement.findMany({ where: { status: -10, businessType: 'ContractAttachment' } })
  for (const file of pending) {
    if (!/^uploads\/contract-attachment\/[\w-]+\.pdf$/i.test(file.filePath)) throw new Error('Legacy PDF cleanup path is inconsistent')
    const source = resolve(UPLOAD_ROOT, file.filePath.slice('uploads/'.length)), trashDirectory = resolve(UPLOAD_ROOT, '.trash'), trash = resolve(trashDirectory, `legacy-contract-${file.id}-${file.fileName}`)
    try {
      const root = await realpath(UPLOAD_ROOT)
      await mkdir(trashDirectory, { recursive: true, mode: 0o700 })
      const trashRelative = relative(root, await realpath(trashDirectory))
      if (trashRelative.startsWith(`..${sep}`) || trashRelative === '..') throw new Error('Legacy PDF trash is outside the upload root')
      try {
        const real = await realpath(source), rel = relative(root, real)
        if (rel.startsWith(`..${sep}`) || rel === '..') throw new Error('Legacy PDF is outside the upload root')
        await rename(source, trash)
      } catch (error) { if (!(error && typeof error === 'object' && 'code' in error && error.code === 'ENOENT')) throw error }
      // Retain the pending row until bytes are removed. The deterministic path also
      // handles an interrupted run that already moved the PDF to the trash.
      await unlink(trash).catch((error: unknown) => { if (!(error && typeof error === 'object' && 'code' in error && error.code === 'ENOENT')) throw error })
    } catch (error) { if (!(error && typeof error === 'object' && 'code' in error && error.code === 'ENOENT')) throw error }
    await client.fileManagement.delete({ where: { id: file.id, status: -10 } })
  }
  await seedCommissionTemplates(client)
}
