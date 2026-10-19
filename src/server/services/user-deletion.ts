/**
 * @file user-deletion.ts
 * @project SlothVault
 * @module Account Deletion Policy
 * @description Previews account cleanup and detaches site-owned attribution while retaining customer contracts and evidence.
 * @logic Count protected customer relationships, preserve independent operator snapshots, clear nullable references, and expose credential-free deletion history. Detach plugin-owned nullable user references and retain financial idempotency receipts after account deletion.
 * @dependencies Prisma transactions, account audit registry, plugin user-attribution adapter
 * @index_tags users,deletion,audit,contracts,wallet,backup
 * @author holic512
 */
import 'server-only'
import { pluginUserAttribution } from '@/server/plugins/user-attribution'
import type { Prisma } from '@generated/prisma-postgresql/client'
import { readAttribution, USER_ATTRIBUTION_FIELDS, type UserIdentity } from '@/lib/user-attribution'
import { snapshotUser } from '@/server/database/user-attribution'

type Tx = Prisma.TransactionClient
type Row = { id: number; attributionJson: string } & Record<string, unknown>
type Delegate = { count(args: object): Promise<number>; findMany(args: object): Promise<Row[]>; update(args: object): Promise<unknown> }
function delegate(tx: Tx, name: string) { return (tx as unknown as Record<string, Delegate>)[name] }

export async function inspectUserDeletion(tx: Tx, userId: number, actorUserId: number) {
  const user = await tx.user.findUniqueOrThrow({ where: { id: userId } })
  const [contracts, commissions, invitations, administrators] = await Promise.all([
    tx.contract.count({ where: { subjectUserId: userId } }),
    tx.commission.count({ where: { subjectUserId: userId } }),
    tx.commissionInvitation.count({ where: { claimedById: userId } }),
    tx.user.count({ where: { role: 'ADMIN', status: 1 } }),
  ])
  const blockers: Array<{ reason: string; count: number }> = []
  if (userId === actorUserId) blockers.push({ reason: 'CURRENT_ADMIN', count: 1 })
  if (user.role === 'ADMIN' && user.status === 1 && administrators <= 1) blockers.push({ reason: 'LAST_ADMIN', count: 1 })
  for (const [reason, count] of [['CUSTOMER_CONTRACTS', contracts], ['CUSTOMER_COMMISSIONS', commissions], ['CLAIMED_INVITATIONS', invitations]] as const) if (count) blockers.push({ reason, count })
  const cleanup = Object.fromEntries(await Promise.all([
    ['sessions', tx.session.count({ where: { userId } })],
    ['wallets', tx.userWallet.count({ where: { userId } })],
    ['mcpApiKeys', tx.mcpApiKey.count({ where: { userId } })],
    ['pointTransactions', tx.pointTransaction.count({ where: { userId } })],
    ['membershipGrants', tx.membershipGrant.count({ where: { userId } })],
    ['avatarReferences', tx.fileReference.count({ where: { sourceType: 'USER_AVATAR', sourceId: userId } })],
  ].map(async ([key, value]) => [key, await value]))) as Record<string, number>
  const retained = Object.fromEntries(await Promise.all(Object.entries(USER_ATTRIBUTION_FIELDS).filter(([model]) => model !== 'pointTransaction').map(async ([model, fields]) => [model, await delegate(tx, model).count({ where: { OR: fields.map(field => ({ [field]: userId })), ...(model === 'membershipGrant' ? { userId: { not: userId } } : {}) } })]))) as Record<string, number>
  retained.pointTransaction = await tx.pointTransaction.count({ where: { userId: { not: userId }, type: 'ADMIN_ADJUSTMENT', referenceId: String(userId) } })
  return { userId: String(userId), allowed: blockers.length === 0, blockers, cleanup, retained }
}

/** Fill only absent identities; frozen contract and submission bytes are never touched. */
export async function detachUserAttribution(tx: Tx, userId: number, identity: UserIdentity) {
  await tx.pluginPointReceipt.updateMany({ where: { userId }, data: { userId: null } })
  await pluginUserAttribution(tx, userId, identity)
  for (const [model, fields] of Object.entries(USER_ATTRIBUTION_FIELDS)) {
    const store = delegate(tx, model)
    let after = 0
    while (true) {
      const where = model === 'pointTransaction'
        ? { id: { gt: after }, type: 'ADMIN_ADJUSTMENT', referenceId: String(userId) }
        : { id: { gt: after }, OR: fields.map(field => ({ [field]: userId })) }
      const rows = await store.findMany({ where, orderBy: { id: 'asc' }, take: 100 })
      if (!rows.length) break
      for (const row of rows) {
        after = row.id
        const snapshots = readAttribution(row.attributionJson)
        const data: Record<string, unknown> = {}
        for (const field of fields) {
          if (model === 'pointTransaction' || row[field] === userId) {
            snapshots[field] ??= identity
            if (model !== 'pointTransaction') data[field] = null
          }
        }
        await store.update({ where: { id: row.id }, data: { ...data, attributionJson: JSON.stringify(snapshots) } })
      }
    }
  }
}

/** Used after schema deployment, on legacy imports, and for pre-snapshot account records. */
export async function backfillUserAttribution(tx: Tx, includeLegacyLedger = true) {
  await pluginUserAttribution(tx)
  const identities = new Map<number, UserIdentity>()
  for (const [model, fields] of Object.entries(USER_ATTRIBUTION_FIELDS)) {
    if (model === 'pointTransaction' && !includeLegacyLedger) continue
    const store = delegate(tx, model)
    let after = 0
    while (true) {
      const rows = await store.findMany({ where: { id: { gt: after } }, orderBy: { id: 'asc' }, take: 100 })
      if (!rows.length) break
      for (const row of rows) {
        after = row.id
        const snapshots = readAttribution(row.attributionJson)
        let changed = false
        for (const field of fields) {
          const id = model === 'pointTransaction' && row.type === 'ADMIN_ADJUSTMENT' ? Number(row.referenceId) : row[field]
          if (snapshots[field] || typeof id !== 'number' || !id) continue
          if (!identities.has(id)) {
            const user = await tx.user.findUnique({ where: { id }, select: { id: true } })
            if (!user) continue
            identities.set(id, await snapshotUser(tx, id))
          }
          snapshots[field] = identities.get(id)!
          changed = true
        }
        if (changed) await store.update({ where: { id: row.id }, data: { attributionJson: JSON.stringify(snapshots) } })
      }
    }
  }
}
