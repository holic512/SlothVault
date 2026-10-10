import { contractRootHash } from '@/server/services/contract-evidence-protocol'
import type { AppPrismaClient } from '@/server/database/client'
import builtin from './builtin-template.json'
import type { TemplateField } from '@/types/commissions'
const fields = builtin.fields as TemplateField[]
export function completeAgreementValues() {
  const values: Record<string, unknown> = { ...structuredClone(builtin.defaults) }
  for (const f of fields) {
    if (f.when || f.documents && !f.documents.includes('AGREEMENT')) continue
    if (f.required) values[f.key] = f.type === 'money' ? '100001' : f.type === 'number' ? 30 : f.type === 'date' ? '2026-10-08' : f.type === 'select' ? f.options![0].value : f.type === 'multiselect' ? [f.options![0].value] : f.type === 'rows' ? [{ module: '订单管理', function: '创建、查询与取消订单', included: true }] : '双方已明确约定'
  }
  return { ...values, totalFen: '100001', startBps: 3000, progressBps: 4000, adjustmentRounds: 2, adjustmentDays: 15, maintenanceDays: 30, paymentReminderDays: 3, acceptanceDays: 5, supplementalDays: 3, deliveryDate: '2026-11-08' }
}

/** Seeds retained signed history without invoking retired contract write workflows. */
export async function seedSignedLegacyContract(client: AppPrismaClient, id: number) {
  const contract = await client.contract.findUniqueOrThrow({ where: { id } })
  const installation = await client.systemInstallation.findFirstOrThrow({ orderBy: { id: 'asc' } })
  const issuedAt = new Date('2026-10-08T00:00:00Z'), signedAt = new Date('2026-10-08T01:00:00Z')
  const contractHash = contractRootHash({
    snapshotHash: contract.snapshotHash, installationId: installation.installationId,
    contractId: contract.contractId, title: contract.title, bodyHash: contract.bodyHash,
    attachmentHash: contract.attachmentHash, partyCommitment: contract.partyCommitment,
    issuedAt, signedAt,
  })
  return client.contract.update({ where: { id }, data: {
    status: 2, installationId: installation.installationId, issuedAt, signedAt,
    signedSessionId: '00000000-0000-4000-8000-000000000002', signedIp: '127.0.0.1',
    signedUserAgent: 'historical-backup-fixture', contractHash,
  } })
}
