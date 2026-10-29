/**
 * @file server.ts
 * @project SlothVault
 * @module Commissions plugin backend
 * @description Owns commissions, frozen contracts, private file references, invitations, immutable audit chains and mainnet evidence.
 * @logic Revision-CAS and command receipts serialize writes; persist signed attempts before broadcast; only FINALIZED applies frozen effects exactly once.
 * @dependencies Public plugin SDK, Kysely transaction API, zod, node:crypto, local DTOs/templates/workflow
 * @index_tags commissions,plugin,evidence,contracts,maintenance,mcp
 * @author holic512
 */
import { createHash, randomBytes, randomUUID } from 'node:crypto'
import { z } from 'zod'
import { definePlugin, type PluginContext, type PluginInvocation } from '@slothvault/plugin-sdk/server'
import type {
  Attachment,
  AttachmentPurpose,
  AuditEvent,
  Commission,
  CommissionDetail,
  CommandAction,
  ContractTemplate,
  ContractVersion,
  EvidenceAttempt,
  EvidencePrepared,
  FrozenAction,
  FrozenKind
} from './domain'
import { DEFAULT_TEMPLATES, compatibleFields, missingTemplateFields, renderTemplate } from './templates'
import { activeEvidence, allowedActions, fail } from './workflow'

const commandBase = z.object({ commandId: z.string().min(8).max(128), revision: z.number().int().min(0) })
const entityCommand = commandBase.extend({ commissionId: z.string().min(1).max(160) })
const text = z.string().trim().min(1).max(100000)
const reason = z.object({ reason: z.string().trim().min(1).max(4000) })
const selectedFiles = z.object({ fileIds: z.array(z.string().min(1).max(160)).max(100) })
const purposeSchema = z.enum(['request', 'contract', 'delivery', 'maintenance'])
const draftSchema = z.object({
  templateId: z.string().max(160),
  kind: z.enum(['MAIN', 'SUPPLEMENT']),
  title: z.string().trim().min(1).max(200),
  fields: z.record(z.string(), z.union([z.string().max(20000), z.number().finite(), z.boolean()])),
  body: text
}).strict()
const now = () => new Date().toISOString()
export function canonical(value: unknown): string {
  if (Array.isArray(value)) return `[${value.map(canonical).join(',')}]`
  if (value && typeof value === 'object') return `{${Object.entries(value).filter(([, v]) => v !== undefined).sort(([a], [b]) => a < b ? -1 : a > b ? 1 : 0).map(([k, v]) => `${JSON.stringify(k)}:${canonical(v)}`).join(',')}}`
  return JSON.stringify(value) ?? 'null'
}
export const digest = (value: unknown) => createHash('sha256').update(canonical(value)).digest('hex')
const readJson = <T>(value: unknown): T => JSON.parse(String(value)) as T
type Db = PluginContext['db']
type Actor = NonNullable<PluginInvocation['actor']>

export default definePlugin(ctx => {
  const t = (name: string) => ctx.table(name)
  const requireActor = (inv: PluginInvocation): Actor => inv.actor ?? fail('Authentication required', 401)
  const requireAdmin = (inv: PluginInvocation): Actor => {
    const actor = requireActor(inv)
    if (actor.role !== 'ADMIN') fail('Administrator required', 403)
    return actor
  }
  const owned = async (id: string, actor: Actor, db: Db = ctx.db): Promise<Commission> => {
    const row = await db.selectFrom(t('commissions')).selectAll().where('id', '=', id).executeTakeFirst()
    if (!row) fail('Commission not found', 404)
    const commission = readJson<Commission>(row.data_json)
    if (actor.role !== 'ADMIN' && commission.customerId !== actor.userId && !(commission.customerId === null && commission.createdBy === actor.userId)) fail('Commission not found', 404)
    return commission
  }
  const allEvidence = async (id: string, db: Db = ctx.db): Promise<FrozenAction[]> => (await db.selectFrom(t('evidence')).selectAll().where('commission_id', '=', id).execute()).map(row => readJson<FrozenAction>(row.data_json))
  const attachments = async (id: string, db: Db = ctx.db): Promise<Attachment[]> => (await db.selectFrom(t('attachments')).selectAll().where('commission_id', '=', id).execute()).map(row => readJson<Attachment>(row.data_json))
  const getSettings = async (db: Db = ctx.db) => {
    const row = await db.selectFrom(t('settings')).selectAll().where('id', '=', 'global').executeTakeFirst()
    return {
      acceptingNew: row ? Number(row.accepting_new) === 1 : true,
      revision: row ? Number(row.revision) : 0
    }
  }
  const detail = async (id: string, actor: Actor, db: Db = ctx.db): Promise<CommissionDetail> => {
    const commission = await owned(id, actor, db),
      admin = actor.role === 'ADMIN'
    const evidence = await allEvidence(id, db),
      files = await attachments(id, db),
      pending = activeEvidence(evidence)
    const events = (await db.selectFrom(t('events')).selectAll().where('commission_id', '=', id).orderBy('sequence', 'asc').execute()).map(row => readJson<AuditEvent>(row.data_json))
    const blockers: string[] = []
    if (pending) blockers.push(pending.status === 'SUBMITTED' ? '主网交易确认中；确认前不能修改待生效内容' : '关键记录已冻结，等待管理员完成主网存证')
    if (commission.paused) blockers.push('委托已暂停')
    if (commission.customerId === null) blockers.push('尚未绑定客户；正式合同发布前须认领邀请或绑定启用账户')
    const unconfirmed = commission.contracts.some(item => !item.effectiveAt && !item.rejectedAt)
    if (unconfirmed) blockers.push('等待客户确认已发布合同，或提交合同异议')
    const actions = allowedActions(commission, admin, actor.userId, pending)
    const visibleEvidence = admin
      ? evidence
      : evidence.map(item => ({
        ...item,
        snapshot: item.status !== 'FINALIZED' ? {} : item.snapshot,
        error: item.error ? '存证办理暂未完成，请联系管理员' : null
      }))
    const customer = admin && commission.customerId ? (await ctx.users.find({ userId: commission.customerId }))[0] : undefined
    const contractDefaults = admin
      ? {
        customerName: customer?.displayName || customer?.username,
        providerName: typeof ctx.config.providerName === 'string' ? ctx.config.providerName : undefined
      }
      : undefined
    return {
      contractDefaults,
      commission: admin ? commission : { ...commission, contractDraft: null },
      pendingAction: pending ? visibleEvidence.find(item => item.id === pending.id)! : null,
      evidence: visibleEvidence,
      attachments: files.filter(file => admin || file.shared || file.uploadedBy === actor.userId),
      events: admin
        ? events
        : events.filter(event => !['save-contract', 'invite', 'revoke-invitation', 'update-draft'].includes(event.type) && (event.type !== 'attachment-uploaded' || files.some(file => file.id === event.payload.fileId && (file.shared || file.uploadedBy === actor.userId)))),
      allowedActions: actions,
      blockers,
      nextActor: ['CLOSED', 'TERMINATED'].includes(commission.stage)
        ? 'NONE'
        : pending
          ? 'ADMIN'
          : unconfirmed || (commission.stage === 'DRAFT' && commission.customerId !== null) ? 'CUSTOMER' : 'ADMIN'
    }
  }
  /**
   * 以旧版本号作条件更新，避免并发命令覆盖彼此的修改；同时递增传入对象的版本号。
   * @param db 必须与关联的存证、审计和命令回执共用事务，版本冲突时一并回滚。
   * @param revision 本次修改所基于的已持久化版本，而非递增后的目标版本。
   */
  const persist = async (db: Db, commission: Commission, revision: number) => {
    commission.revision = revision + 1
    commission.updatedAt = now()
    const changed = await db.updateTable(t('commissions')).set({
      revision: commission.revision,
      customer_id: commission.customerId,
      stage: commission.stage,
      data_json: JSON.stringify(commission)
    }).where(
      'id',
      '=',
      commission.id
    ).where(
      'revision',
      '=',
      revision
    ).executeTakeFirstOrThrow()
    if (changed.numUpdatedRows !== 1n) fail('STALE_REVISION: refresh the commission')
  }
  const audit = async (db: Db, commission: Commission, type: string, actorId: number | null, payload: Record<string, unknown> = {}) => {
    const prior = await db.selectFrom(t('events')).selectAll().where('commission_id', '=', commission.id).orderBy('sequence', 'desc').executeTakeFirst()
    const event = {
      id: randomUUID(),
      type,
      actorId,
      createdAt: now(),
      payload,
      previousHash: prior ? readJson<AuditEvent>(prior.data_json).hash : null
    }
    const complete: AuditEvent = { ...event, hash: digest(event) }
    await db.insertInto(t('events')).values({
      id: complete.id,
      commission_id: commission.id,
      sequence: prior ? Number(prior.sequence) + 1 : 1,
      data_json: JSON.stringify(complete)
    }).execute()
  }
  /**
   * 将业务写入与命令回执原子提交；同一命令号仅允许相同操作者、操作及输入重放。
   * @param work 数据库写入须使用回调事务，不应执行无法随事务回滚的外部副作用。
   * @returns 首次执行的结果或已保存的回执；邀请令牌不保存，因此重放不会再次返回令牌。
   */
  const run = async <T>(actor: Actor, input: { commandId: string;[key: string]: unknown }, operation: string, work: (db: Db) => Promise<T>): Promise<T> => {
    const fingerprint = digest({ operation, input, actor: actor.userId })
    const prior = await ctx.db.selectFrom(t('commands')).selectAll().where('id', '=', input.commandId).executeTakeFirst()
    const replay = (row: Record<string, unknown>) => {
      if (row.fingerprint !== fingerprint || Number(row.actor_id) !== actor.userId) fail('IDEMPOTENCY_CONFLICT')
      return readJson<T>(row.result_json)
    }
    if (prior) return replay(prior)
    try {
      return await ctx.db.transaction().execute(async db => {
        const existing = await db.selectFrom(t('commands')).selectAll().where('id', '=', input.commandId).executeTakeFirst()
        if (existing) return replay(existing)
        const result = await work(db)
        await db.insertInto(t('commands')).values({
          id: input.commandId,
          actor_id: actor.userId,
          fingerprint,
          result_json: JSON.stringify(result, (key, value) => key === 'invitationToken' ? undefined : value)
        }).execute()
        return result
      })
    } catch (error) {
      const completed = await ctx.db.selectFrom(t('commands')).selectAll().where('id', '=', input.commandId).executeTakeFirst()
      if (completed) return replay(completed)
      throw error
    }
  }
  const validCustomer = async (id: number) => {
    const users = await ctx.users.find({ userId: id }),
      user = users.find(item => item.id === id)
    if (!user || ![1, '1', 'ACTIVE', 'ENABLED'].includes(user.status)) fail('Customer must be an enabled account', 400)
    return user
  }
  const templateById = async (id: string, db: Db = ctx.db): Promise<ContractTemplate> => {
    const row = await db.selectFrom(t('templates')).selectAll().where('id', '=', id).executeTakeFirst()
    if (!row) fail('Template not found', 404)
    return readJson<ContractTemplate>(row.data_json)
  }
  const seed = async () => {
    await ctx.db.transaction().execute(async db => {
      for (const template of DEFAULT_TEMPLATES) {
        const present = await db.selectFrom(t('templates')).select('id').where('family', '=', template.family).executeTakeFirst()
        if (!present) await db.insertInto(t('templates')).values({ id: template.id, family: template.family, version: 1, data_json: JSON.stringify(template) }).execute()
      }
      if (!await db.selectFrom(t('settings')).select('id').where('id', '=', 'global').executeTakeFirst()) await db.insertInto(t('settings')).values({ id: 'global', revision: 0, accepting_new: 1 }).execute()
    })
  }
  /**
   * 引用附件前同时核验委托归属、查看权限及宿主文件的摘要和大小，不能仅信任附件表记录。
   * @param purpose 指定时要求全部附件属于该用途；省略仅跳过用途限制，不跳过权限或完整性检查。
   */
  const checkFiles = async (db: Db, commission: Commission, actor: Actor, ids: string[], purpose?: AttachmentPurpose): Promise<Attachment[]> => {
    if (new Set(ids).size !== ids.length) fail('Duplicate file reference', 400)
    const available = await attachments(commission.id, db),
      chosen = ids.map(id => available.find(file => file.id === id) ?? fail('File not attached to this commission', 404))
    if (chosen.some(file => (purpose && file.purpose !== purpose) || (actor.role !== 'ADMIN' && file.uploadedBy !== actor.userId && !file.shared))) fail('File not available for this action', 403)
    const checked = await ctx.files.ensure(ids)
    for (const file of chosen) {
      const actual = checked.find(item => item.id === file.id)
      if (!actual || actual.sha256 !== file.sha256 || actual.size !== file.size) fail('ATTACHMENT_INTEGRITY_FAILURE')
    }
    return chosen
  }
  const shareFiles = async (db: Db, commissionId: string, files: Attachment[]) => {
    for (const file of files) await db.updateTable(t('attachments')).set({ data_json: JSON.stringify({ ...file, shared: true }) }).where('commission_id', '=', commissionId).where(
      'file_id',
      '=',
      file.id
    ).execute()
  }
  /**
   * 固定待存证内容及摘要，此时不推进业务阶段；冻结效果仅在主网最终确认后应用。
   * @param snapshot 调用方须先校验业务内容和附件，且不得覆盖协议、网络、委托及版本等保留字段。
   * @param db 与委托版本更新共用事务；调用方须已排除其他未结束的冻结记录。
   */
  const freeze = async (db: Db, commission: Commission, kind: FrozenKind, snapshot: Record<string, unknown>, actorId: number) => {
    const id = randomUUID(),
      createdAt = now()
    const frozenSnapshot = {
      protocol: 'slothvault.commissions',
      network: 'mainnet',
      commissionId: commission.id,
      revision: commission.revision,
      kind,
      createdAt,
      ...snapshot
    }
    const hash = digest(frozenSnapshot),
      memo = JSON.stringify({ protocol: 'slothvault.commissions', evidenceId: id, digest: hash })
    const record: FrozenAction = {
      id,
      kind,
      status: 'AWAITING_ADMIN',
      digest: hash,
      memo,
      snapshot: frozenSnapshot,
      createdAt,
      effectiveAt: null,
      attemptId: null,
      signature: null,
      error: null
    }
    await db.insertInto(t('evidence')).values({
      id,
      commission_id: commission.id,
      kind,
      status: record.status,
      data_json: JSON.stringify(record)
    }).execute()
    await audit(db, commission, `freeze-${kind.toLowerCase()}`, actorId, { evidenceId: id, digest: hash })
    return record
  }
  const saveEvidence = async (db: Db, record: FrozenAction) => {
    await db.updateTable(t('evidence')).set({ status: record.status, data_json: JSON.stringify(record) }).where('id', '=', record.id).execute()
  }
  const loadEvidence = async (id: string, commissionId: string, db: Db = ctx.db): Promise<FrozenAction> => {
    const row = await db.selectFrom(t('evidence')).selectAll().where('id', '=', id).where('commission_id', '=', commissionId).executeTakeFirst()
    if (!row) fail('Evidence not found', 404)
    return readJson<FrozenAction>(row.data_json)
  }
  const create = async (inv: PluginInvocation) => {
    const actor = requireActor(inv)
    const input = commandBase.extend({
      title: z.string().trim().min(1).max(200),
      description: z.string().max(100000).default(''),
      customerId: z.number().int().positive().nullable().optional(),
      maintenanceDays: z.number().int().min(0).max(3650).default(30),
      templateId: z.string().max(160).optional()
    }).strict().parse(inv.input)
    if (input.revision !== 0) fail('New drafts require revision 0', 400)
    if (actor.role !== 'ADMIN' && input.customerId !== undefined && input.customerId !== actor.userId) fail('Cannot create for another customer', 403)
    const customerId = actor.role === 'ADMIN' ? input.customerId ?? null : actor.userId
    if (customerId !== null) await validCustomer(customerId)
    return run(actor, input, 'create', async db => {
      if (!(await getSettings(db)).acceptingNew) fail('New commissions are paused')
      const date = now(),
        commission: Commission = {
          id: randomUUID(),
          revision: 0,
          title: input.title,
          description: input.description,
          customerId,
          createdBy: actor.userId,
          stage: 'DRAFT',
          paused: false,
          paymentPercent: 0,
          maintenanceDays: input.maintenanceDays,
          maintenanceStartedAt: null,
          maintenanceEndsAt: null,
          contractDraft: null,
          contracts: [],
          createdAt: date,
          updatedAt: date
        }
      if (input.templateId) {
        if (actor.role !== 'ADMIN') fail('Only administrators prepare contracts', 403)
        const template = await templateById(input.templateId, db)
        if (template.kind !== 'MAIN') fail('Supplement requires an effective main contract')
        const fields = compatibleFields(null, template, {})
        fields.projectName = commission.title
        fields.maintenanceDays = commission.maintenanceDays
        if (ctx.config.providerName) fields.providerName = String(ctx.config.providerName)
        if (customerId) {
          const customer = await validCustomer(customerId)
          fields.customerName = customer.displayName || customer.username
        }
        commission.contractDraft = {
          templateId: template.id,
          kind: template.kind,
          title: template.title,
          fields,
          body: renderTemplate(template, fields)
        }
      }
      await db.insertInto(t('commissions')).values({
        id: commission.id,
        revision: 0,
        customer_id: customerId,
        created_by: actor.userId,
        stage: commission.stage,
        data_json: JSON.stringify(commission)
      }).execute()
      await audit(db, commission, 'create', actor.userId)
      return { detail: await detail(commission.id, actor, db) }
    })
  }
  const command = async (inv: PluginInvocation) => {
    const actor = requireActor(inv)
    const input = entityCommand.extend({ action: z.string(), data: z.record(z.string(), z.unknown()).default({}) }).strict().parse(inv.input)
    return run(actor, input, 'command', async db => {
      const commission = await owned(input.commissionId, actor, db),
        pending = activeEvidence(await allEvidence(commission.id, db))
      if (commission.revision !== input.revision) fail('STALE_REVISION: refresh the commission')
      if (!allowedActions(commission, actor.role === 'ADMIN', actor.userId, pending).includes(input.action as CommandAction)) fail('ACTION_NOT_ALLOWED', 403)
      const data = input.data
      let invitationToken: string | undefined
      switch (input.action) {
        case 'update-draft':
          {
            const patch = z.object({
              title: z.string().trim().min(1).max(200).optional(),
              description: z.string().max(100000).optional(),
              customerId: z.number().int().positive().nullable().optional(),
              maintenanceDays: z.number().int().min(0).max(3650).optional()
            }).strict().parse(data)
            if (patch.customerId !== undefined) {
              if (actor.role !== 'ADMIN') fail('Administrator required to bind a customer', 403)
              if (patch.customerId !== null) await validCustomer(patch.customerId)
            }
            Object.assign(commission, patch)
            break
          }
        case 'submit-request':
          {
            if (!commission.description.trim()) fail('Describe the requirements before submission', 400)
            const files = await checkFiles(db, commission, actor, selectedFiles.parse(data).fileIds, 'request')
            await freeze(db, commission, 'REQUEST', {
              title: commission.title,
              description: commission.description,
              customerId: commission.customerId,
              files
            }, actor.userId)
            break
          }
        case 'accept':
          commission.stage = 'CONTRACT_PREPARATION'
          break
        case 'return-request':
          reason.parse(data)
          commission.stage = 'DRAFT'
          break
        case 'save-contract':
          {
            const draft = draftSchema.parse(data.draft),
              template = await templateById(draft.templateId, db)
            if (draft.kind !== template.kind) fail('Template kind mismatch', 400)
            const effective = commission.contracts.find(item => item.kind === 'MAIN' && item.effectiveAt)
            if (draft.kind === 'SUPPLEMENT' && !effective) fail('Supplement requires an effective main contract')
            if (draft.kind === 'MAIN' && effective) fail('Use a supplement to change an effective main contract')
            if (commission.contracts.some(item => !item.effectiveAt && !item.rejectedAt)) fail('Resolve the pending contract before editing another version')
            commission.contractDraft = draft
            break
          }
        case 'publish-contract':
          {
            if (!commission.customerId) fail('Bind a customer before publishing')
            await validCustomer(commission.customerId)
            const draft = commission.contractDraft ?? fail('Prepare a contract first'),
              template = await templateById(draft.templateId, db)
            if (!template.published) fail('Select a published template')
            if (draft.fields.maintenanceDays !== undefined) {
              z.number().int().min(0).max(3650).parse(draft.fields.maintenanceDays)
              if (commission.maintenanceStartedAt && draft.fields.maintenanceDays !== commission.maintenanceDays) fail('An existing maintenance clock cannot be changed by a supplement')
            }
            const missing = missingTemplateFields(template, draft.fields)
            if (missing.length) fail(`MISSING_FIELDS:${missing.join(',')}`, 400)
            if (/\{\{[^{}]+\}\}|【待填写：/.test(draft.body)) fail('Contract contains unresolved fields', 400)
            const effective = commission.contracts.find(item => item.kind === 'MAIN' && item.effectiveAt)
            if (draft.kind === 'SUPPLEMENT' && (!effective || draft.fields.baseContractId !== effective.id)) fail('Supplement must reference the effective main contract')
            if (draft.kind === 'MAIN' && (effective || commission.stage !== 'CONTRACT_PREPARATION')) fail('Main contract cannot be published at this stage')
            if (commission.contracts.some(item => !item.effectiveAt && !item.rejectedAt)) fail('An unconfirmed contract already exists')
            const files = await checkFiles(db, commission, actor, selectedFiles.parse(data).fileIds, 'contract')
            const version: ContractVersion = {
              ...draft,
              id: randomUUID(),
              version: commission.contracts.length + 1,
              publishedAt: now(),
              effectiveAt: null,
              confirmation: null
            }
            await freeze(db, commission, 'CONTRACT', { contract: version, template, files }, actor.userId)
            break
          }
        case 'confirm-contract':
        case 'record-confirmation':
          {
            const confirmation = z.object({ contractId: z.string(), note: z.string().trim().max(4000).default('') }).strict().parse(data)
            if (input.action === 'record-confirmation' && !confirmation.note) fail('Offline confirmation requires a traceable record', 400)
            const contract = commission.contracts.find(item => item.id === confirmation.contractId && !item.effectiveAt && !item.rejectedAt && !item.confirmation) ?? fail('Contract is not awaiting confirmation')
            await freeze(
              db,
              commission,
              'CONFIRMATION',
              {
                contractId: contract.id,
                contractDigest: digest(contract),
                confirmation: {
                  method: input.action === 'confirm-contract' ? 'ONLINE' : 'OFFLINE',
                  actorId: actor.userId,
                  note: confirmation.note,
                  recordedAt: now()
                }
              },
              actor.userId
            )
            break
          }
        case 'decline-contract':
          {
            const rejection = z.object({ contractId: z.string(), reason: reason.shape.reason }).strict().parse(data)
            const contract = commission.contracts.find(item => item.id === rejection.contractId && !item.effectiveAt && !item.rejectedAt) ?? fail('Contract is not awaiting confirmation')
            contract.rejectedAt = now()
            contract.rejectionReason = rejection.reason
            if (contract.kind === 'MAIN') commission.stage = 'CONTRACT_PREPARATION'
            break
          }
        case 'start':
          {
            if (!commission.contracts.some(item => item.kind === 'MAIN' && item.effectiveAt)) fail('Effective main contract required')
            if (commission.contracts.some(item => !item.effectiveAt && !item.rejectedAt)) fail('Resolve unconfirmed contracts before starting')
            commission.stage = 'IN_PROGRESS'
            break
          }
        case 'deliver':
          {
            if (commission.contracts.some(item => !item.effectiveAt && !item.rejectedAt)) fail('Resolve pending supplementary contracts before delivery')
            const delivery = selectedFiles.extend({ description: text }).strict().parse(data)
            if (!delivery.fileIds.length) fail('At least one delivery attachment is required', 400)
            const files = await checkFiles(db, commission, actor, delivery.fileIds, 'delivery')
            await freeze(db, commission, 'DELIVERY', { description: delivery.description, files, maintenanceDays: commission.maintenanceDays }, actor.userId)
            break
          }
        case 'pause':
          commission.paused = true
          break
        case 'resume':
          commission.paused = false
          break
        case 'terminate':
          reason.parse(data)
          commission.stage = 'TERMINATED'
          commission.paused = false
          break
        case 'close-maintenance':
          reason.parse(data)
          if (commission.contracts.some(item => !item.effectiveAt && !item.rejectedAt)) fail('Resolve unconfirmed contracts before closing maintenance')
          commission.stage = 'CLOSED'
          break
        case 'payment':
          commission.paymentPercent = z.object({ percent: z.number().min(0).max(100), reason: reason.shape.reason }).strict().parse(data).percent
          break
        case 'comment': case 'maintenance-feedback': case 'maintenance-resolve':
          z.object({ text }).strict().parse(data)
          break
        case 'withdraw':
          {
            const evidenceId = z.object({ evidenceId: z.string() }).strict().parse(data).evidenceId
            if (!pending || pending.id !== evidenceId || pending.status === 'SUBMITTED') fail('Broadcast evidence must be reconciled before withdrawal')
            pending.status = 'WITHDRAWN'
            await saveEvidence(db, pending)
            if (pending.attemptId) await db.updateTable(t('attempts')).set({ status: 'WITHDRAWN' }).where('id', '=', pending.attemptId).execute()
            break
          }
        case 'invite': case 'revoke-invitation':
          {
            await db.updateTable(t('invitations')).set({ revoked: 1 }).where('commission_id', '=', commission.id).where('claimed_by', 'is', null).execute()
            if (input.action === 'invite') {
              const days = z.object({ expiresInDays: z.number().int().min(1).max(30).default(7) }).strict().parse(data).expiresInDays
              invitationToken = randomBytes(32).toString('base64url')
              await db.insertInto(t('invitations')).values({
                id: randomUUID(),
                commission_id: commission.id,
                token_hash: digest(invitationToken),
                expires_at: new Date(Date.now() + days * 86400000).toISOString(),
                claimed_by: null,
                revoked: 0
              }).execute()
            }
            break
          }
        default:
          fail('Unknown action', 400)
      }
      await persist(db, commission, input.revision)
      const payload = [
        'comment',
        'maintenance-feedback',
        'maintenance-resolve',
        'payment',
        'return-request',
        'terminate',
        'decline-contract',
        'close-maintenance'
      ].includes(input.action)
        ? data
        : {}
      await audit(db, commission, input.action, actor.userId, payload)
      return {
        detail: await detail(commission.id, actor, db),
        ...(invitationToken ? { invitationToken } : {})
      }
    })
  }
  const attemptDto = (row: Record<string, unknown>): EvidenceAttempt => ({
    id: String(row.id),
    evidenceId: String(row.evidence_id),
    status: String(row.status) as EvidenceAttempt['status'],
    signature: row.signature ? String(row.signature) : null,
    prepared: readJson<EvidencePrepared>(row.prepared_json),
    error: row.error ? String(row.error) : null,
    createdAt: String(row.created_at)
  })
  const replayCommand = async <T>(actor: Actor, input: { commandId: string }, operation: string): Promise<{ result: T } | null> => {
    const row = await ctx.db.selectFrom(t('commands')).selectAll().where('id', '=', input.commandId).executeTakeFirst()
    if (!row) return null
    if (Number(row.actor_id) !== actor.userId || row.fingerprint !== digest({ operation, input, actor: actor.userId })) fail('IDEMPOTENCY_CONFLICT')
    return { result: readJson<T>(row.result_json) }
  }
  /**
   * 在事务外取得主网签名材料，再于事务内复核版本和尝试状态，防止网络等待期间状态已变化。
   * 已准备的尝试必须原样恢复；更换签名钱包前需先撤回，不能悄悄替换仍有效的签名请求。
   */
  const prepare = async (inv: PluginInvocation) => {
    const actor = requireAdmin(inv),
      input = entityCommand.extend({ evidenceId: z.string(), signerAddress: z.string().min(32).max(44) }).strict().parse(inv.input)
    const replay = await replayCommand<{ detail: CommissionDetail; attempt: EvidenceAttempt }>(actor, input, 'prepare')
    if (replay) return replay.result
    const observedCommission = await owned(input.commissionId, actor),
      observedEvidence = await loadEvidence(input.evidenceId, input.commissionId)
    if (observedCommission.revision !== input.revision) fail('STALE_REVISION: refresh the commission')
    if (!['AWAITING_ADMIN', 'FAILED', 'EXPIRED', 'PREPARED'].includes(observedEvidence.status)) fail('Evidence cannot be prepared in its current state')
    if (observedEvidence.digest !== digest(observedEvidence.snapshot)) fail('FROZEN_CONTENT_INTEGRITY_FAILURE')
    // RPC preparation is intentionally outside DB transactions, as required by the host SDK.
    const prepared = observedEvidence.status === 'PREPARED'
      ? null
      : await ctx.evidence.prepare({ memo: observedEvidence.memo, signerAddress: input.signerAddress })
    if (prepared && (prepared.memo !== observedEvidence.memo || prepared.signerAddress !== input.signerAddress)) fail('Evidence preparation mismatch')
    if (prepared && prepared.balanceLamports < prepared.feeLamports) fail('Insufficient SOL for mainnet transaction fee', 400)
    return run(actor, input, 'prepare', async db => {
      const commission = await owned(input.commissionId, actor, db),
        evidence = await loadEvidence(input.evidenceId, commission.id, db)
      if (commission.revision !== input.revision || evidence.status !== observedEvidence.status || evidence.attemptId !== observedEvidence.attemptId) fail('STALE_REVISION: refresh the commission')
      // Resume the same signing request after reload; never silently replace a live attempt.
      if (evidence.status === 'PREPARED') {
        const existing = await db.selectFrom(t('attempts')).selectAll().where('id', '=', evidence.attemptId).executeTakeFirst() ?? fail('Prepared attempt missing')
        const attempt = attemptDto(existing)
        if (attempt.prepared.signerAddress !== input.signerAddress) fail('Withdraw the existing preparation before changing wallets')
        return { detail: await detail(commission.id, actor, db), attempt }
      }
      if (!prepared || evidence.digest !== digest(evidence.snapshot)) fail('FROZEN_CONTENT_INTEGRITY_FAILURE')
      const attempt: EvidenceAttempt = {
        id: randomUUID(),
        evidenceId: evidence.id,
        status: 'PREPARED',
        signature: null,
        prepared,
        error: null,
        createdAt: now()
      }
      await db.insertInto(t('attempts')).values({
        id: attempt.id,
        commission_id: commission.id,
        evidence_id: evidence.id,
        status: attempt.status,
        signature: null,
        prepared_json: JSON.stringify(prepared),
        signed_transaction: null,
        error: null,
        created_at: attempt.createdAt
      }).execute()
      evidence.status = 'PREPARED'
      evidence.attemptId = attempt.id
      evidence.error = null
      evidence.signature = null
      await saveEvidence(db, evidence)
      await persist(db, commission, input.revision)
      return { detail: await detail(commission.id, actor, db), attempt }
    })
  }
  const broadcastSaved = async (attemptId: string) => {
    const attempt = await ctx.db.selectFrom(t('attempts')).selectAll().where('id', '=', attemptId).executeTakeFirst()
    if (attempt?.status === 'SUBMITTED') {
      try {
        await ctx.evidence.broadcast({
          prepared: readJson<EvidencePrepared>(attempt.prepared_json),
          signedTransactionBase64: String(attempt.signed_transaction)
        })
      } catch { /* Observe durable signature before retrying identical bytes. */ }
    }
  }
  /**
   * 先验证签名，再将签名、原始交易字节及 SUBMITTED 状态持久化，提交成功后才允许广播。
   * 广播超时不能视为链上失败；命令重放只重发已保存的相同交易，不创建新的签名尝试。
   */
  const submit = async (inv: PluginInvocation) => {
    const actor = requireAdmin(inv),
      input = entityCommand.extend({
        evidenceId: z.string(),
        attemptId: z.string(),
        signedTransactionBase64: z.string().min(1).max(4000)
      }).strict().parse(inv.input)
    const replay = await replayCommand<{ detail: CommissionDetail }>(actor, input, 'submit')
    if (replay) {
      await broadcastSaved(input.attemptId)
      return replay.result
    }
    const observedCommission = await owned(input.commissionId, actor),
      observedEvidence = await loadEvidence(input.evidenceId, input.commissionId)
    if (observedCommission.revision !== input.revision) fail('STALE_REVISION: refresh the commission')
    if (observedEvidence.status !== 'PREPARED' || observedEvidence.attemptId !== input.attemptId) fail('Attempt is not awaiting signature')
    const observedAttempt = await ctx.db.selectFrom(t('attempts')).selectAll().where('id', '=', input.attemptId).where('status', '=', 'PREPARED').executeTakeFirst() ?? fail('Attempt not found', 404)
    const prepared = readJson<EvidencePrepared>(observedAttempt.prepared_json)
    if (prepared.memo !== observedEvidence.memo || digest(observedEvidence.snapshot) !== observedEvidence.digest) fail('FROZEN_CONTENT_INTEGRITY_FAILURE')
    // Exact-message/signature validation is a host operation and cannot run inside DB transactions.
    const { signature } = await ctx.evidence.validateSigned({ prepared, signedTransactionBase64: input.signedTransactionBase64 })
    const result = await run(actor, input, 'submit', async db => {
      const commission = await owned(input.commissionId, actor, db),
        evidence = await loadEvidence(input.evidenceId, commission.id, db)
      if (commission.revision !== input.revision) fail('STALE_REVISION: refresh the commission')
      if (evidence.status !== 'PREPARED' || evidence.attemptId !== input.attemptId || evidence.digest !== observedEvidence.digest || evidence.digest !== digest(evidence.snapshot)) fail('Attempt is no longer awaiting this signature')
      evidence.status = 'SUBMITTED'
      evidence.signature = signature
      evidence.error = null
      await db.updateTable(t('attempts')).set({ status: 'SUBMITTED', signature, signed_transaction: input.signedTransactionBase64 }).where('id', '=', input.attemptId).where(
        'status',
        '=',
        'PREPARED'
      ).execute()
      await saveEvidence(db, evidence)
      await persist(db, commission, input.revision)
      await audit(db, commission, 'evidence-submitted', actor.userId, { evidenceId: evidence.id, signature })
      return { detail: await detail(commission.id, actor, db) }
    })
    // Broadcast after durable acceptance. An unknown transport result MUST remain SUBMITTED.
    await broadcastSaved(input.attemptId)
    return result
  }
  /**
   * 以链上观察结果结算已提交尝试，仅 FINALIZED 会应用冻结的业务效果并共享附件。
   * 事务内重新核对当前尝试，配合委托版本更新，避免手动对账与后台任务重复生效。
   * @param actor 手动对账时提供；后台对账省略，审计操作者记为空。
   * @param input 手动对账时与 actor 一并提供，用于版本检查及终态处理的命令回执。
   */
  const reconcileOne = async (commissionId: string, evidenceId: string, actor?: Actor, input?: { commandId: string; revision: number }): Promise<unknown> => {
    const evidence = await loadEvidence(evidenceId, commissionId)
    if (actor) await owned(commissionId, actor)
    if (evidence.status !== 'SUBMITTED' || !evidence.attemptId || !evidence.signature) {
      if (actor) return { detail: await detail(commissionId, actor) }
      return
    }
    const attempt = await ctx.db.selectFrom(t('attempts')).selectAll().where('id', '=', evidence.attemptId).executeTakeFirst() ?? fail('Evidence attempt missing')
    const prepared = readJson<EvidencePrepared>(attempt.prepared_json)
    const observed = await ctx.evidence.observe({ prepared, signature: evidence.signature })
    if (observed.status === 'PENDING') {
      // Identical signed bytes are safe to rebroadcast; no new signature, snapshot or attempt.
      try {
        await ctx.evidence.broadcast({ prepared, signedTransactionBase64: String(attempt.signed_transaction) })
      } catch { /* Keep pending until authoritative observation. */ }
      if (actor) return { detail: await detail(commissionId, actor) }
      return
    }
    const terminalStatus = observed.status
    const apply = async (db: Db) => {
      const row = await db.selectFrom(t('commissions')).selectAll().where('id', '=', commissionId).executeTakeFirst() ?? fail('Commission missing')
      const commission = readJson<Commission>(row.data_json),
        current = await loadEvidence(evidenceId, commissionId, db)
      if (current.status === 'SUBMITTED' && current.attemptId === attempt.id) {
        if (input && commission.revision !== input.revision) fail('STALE_REVISION: refresh the commission')
        if (current.digest !== digest(current.snapshot)) fail('FROZEN_CONTENT_INTEGRITY_FAILURE')
        current.status = terminalStatus
        current.error = observed.error ?? null
        if (observed.status === 'FINALIZED') {
          const time = now()
          current.effectiveAt = time
          const snapshot = current.snapshot
          const files = Array.isArray(snapshot.files) ? snapshot.files as Attachment[] : []
          const actual = await ctx.files.ensure(files.map(file => file.id))
          if (files.some(file => !actual.some(item => item.id === file.id && item.sha256 === file.sha256 && item.size === file.size))) fail('ATTACHMENT_INTEGRITY_FAILURE')
          if (current.kind === 'REQUEST') {
            if (commission.stage !== 'DRAFT') fail('Invalid request stage')
            commission.stage = 'REQUESTED'
          }
          if (current.kind === 'CONTRACT') {
            const contract = snapshot.contract as ContractVersion
            commission.contracts.push(contract)
            commission.contractDraft = null
            if (contract.kind === 'MAIN') commission.stage = 'AWAITING_CONFIRMATION'
          }
          if (current.kind === 'CONFIRMATION') {
            const contract = commission.contracts.find(item => item.id === snapshot.contractId) ?? fail('Contract missing')
            if (digest(contract) !== snapshot.contractDigest) fail('Contract changed after confirmation')
            contract.confirmation = snapshot.confirmation as ContractVersion['confirmation']
            contract.effectiveAt = time
            if (!commission.maintenanceStartedAt && typeof contract.fields.maintenanceDays === 'number') commission.maintenanceDays = contract.fields.maintenanceDays
            if (contract.kind === 'MAIN') commission.stage = 'READY'
          }
          if (current.kind === 'DELIVERY') {
            if (commission.stage !== 'IN_PROGRESS') fail('Invalid delivery stage')
            commission.stage = 'MAINTENANCE'
            commission.maintenanceStartedAt ??= time
            commission.maintenanceEndsAt ??= new Date(new Date(commission.maintenanceStartedAt).getTime() + Number(snapshot.maintenanceDays) * 86400000).toISOString()
          }
          await shareFiles(db, commissionId, files)
          await audit(db, commission, 'evidence-finalized', actor?.userId ?? null, { evidenceId, signature: current.signature, blockTime: observed.blockTime })
        }
        await db.updateTable(t('attempts')).set({ status: current.status, error: current.error }).where('id', '=', attempt.id).where('status', '=', 'SUBMITTED').execute()
        await saveEvidence(db, current)
        await persist(db, commission, commission.revision)
      }
      return actor ? { detail: await detail(commissionId, actor, db) } : undefined
    }
    return actor && input ? run(actor, input, `reconcile:${commissionId}:${evidenceId}`, apply) : ctx.db.transaction().execute(apply)
  }
  const list = async (inv: PluginInvocation) => {
    const actor = requireActor(inv)
    let query = ctx.db.selectFrom(t('commissions')).selectAll()
    if (actor.role !== 'ADMIN' || inv.query?.scope === 'mine') query = query.where('customer_id', '=', actor.userId)
    const rows = await query.orderBy('id', 'desc').limit(500).execute()
    return {
      list: rows.map(row => {
        const commission = readJson<Commission>(row.data_json)
        return actor.role === 'ADMIN' ? commission : { ...commission, contractDraft: null }
      })
    }
  }
  const templates = async (inv: PluginInvocation) => {
    requireActor(inv)
    const rows = await ctx.db.selectFrom(t('templates')).selectAll().orderBy('version', 'desc').execute(),
      families = new Set<string>(),
      latest: ContractTemplate[] = []
    for (const row of rows) {
      const template = readJson<ContractTemplate>(row.data_json)
      if (!template.published || families.has(template.family)) continue
      families.add(template.family)
      if (inv.query?.kind && template.kind !== inv.query.kind) continue
      if (inv.query?.scenario && template.scenario !== inv.query.scenario) continue
      latest.push(template)
    }
    const selectedId = z.string().max(160).optional().parse(inv.query?.templateId)
    if (selectedId && !latest.some(template => template.id === selectedId)) latest.push(await templateById(selectedId))
    return { list: latest }
  }
  const templateSave = async (inv: PluginInvocation) => {
    const actor = requireAdmin(inv)
    const templateSchema = z.object({
      id: z.string().max(160),
      family: z.string().regex(/^[a-z][a-z0-9-]{0,79}$/),
      version: z.number().int().positive(),
      kind: z.enum(['MAIN', 'SUPPLEMENT']),
      title: z.string().trim().min(1).max(200),
      scenario: z.string().min(1).max(100),
      applicableWhen: text,
      requiredMaterials: z.array(z.string().min(1).max(1000)).max(50),
      fields: z.array(z.object({
        key: z.string().regex(/^[a-zA-Z][a-zA-Z0-9]*$/).max(100),
        label: z.string().min(1).max(200),
        type: z.enum(['string', 'number', 'boolean']),
        required: z.boolean(),
        default: z.union([z.string(), z.number().finite(), z.boolean()]).optional(),
        semantic: z.string().min(1).max(100)
      }).strict()).min(1).max(100),
      body: text,
      published: z.boolean(),
      createdAt: z.string()
    }).strict()
    const input = commandBase.extend({ template: templateSchema }).strict().parse(inv.input)
    return run(actor, input, 'template-save', async db => {
      const last = await db.selectFrom(t('templates')).selectAll().where('family', '=', input.template.family).orderBy('version', 'desc').executeTakeFirst()
      if ((last ? Number(last.version) : 0) !== input.revision) fail('STALE_TEMPLATE_VERSION')
      if (last && String(last.id) !== input.template.id) fail('Edit the latest template version')
      if (last && readJson<ContractTemplate>(last.data_json).kind !== input.template.kind) fail('Template family kind cannot change', 400)
      if (new Set(input.template.fields.map(field => field.key)).size !== input.template.fields.length) fail('Duplicate template fields', 400)
      if (input.template.fields.some(field => field.default !== undefined && typeof field.default !== field.type)) fail('Template default has incompatible type', 400)
      const placeholders = [...input.template.body.matchAll(/\{\{([a-zA-Z][a-zA-Z0-9]*)\}\}/g)].map(match => match[1])
      if (placeholders.some(key => !input.template.fields.some(field => field.key === key))) fail('Unknown template placeholder', 400)
      const template: ContractTemplate = {
        ...input.template,
        id: randomUUID(),
        version: input.revision + 1,
        published: true,
        createdAt: now()
      }
      await db.insertInto(t('templates')).values({
        id: template.id,
        family: template.family,
        version: template.version,
        data_json: JSON.stringify(template)
      }).execute()
      return { template }
    })
  }
  const invitation = async (inv: PluginInvocation) => {
    const token = z.string().min(32).max(128).parse(inv.query?.token)
    const row = await ctx.db.selectFrom(t('invitations')).selectAll().where('token_hash', '=', digest(token)).where('revoked', '=', 0).where('claimed_by', 'is', null).executeTakeFirst()
    return row && String(row.expires_at) > now() ? { valid: true, expiresAt: String(row.expires_at) } : { valid: false, expiresAt: null }
  }
  const claim = async (inv: PluginInvocation) => {
    const actor = requireActor(inv),
      input = commandBase.extend({ token: z.string().min(32).max(128) }).strict().parse(inv.input)
    if (input.revision !== 0) fail('Invitation claim requires revision 0', 400)
    await validCustomer(actor.userId)
    return run(actor, input, 'claim', async db => {
      const invite = await db.selectFrom(t('invitations')).selectAll().where('token_hash', '=', digest(input.token)).where('revoked', '=', 0).where('claimed_by', 'is', null).executeTakeFirst()
      if (!invite || String(invite.expires_at) <= now()) fail('Invitation is invalid or expired', 404)
      const row = await db.selectFrom(t('commissions')).selectAll().where('id', '=', invite.commission_id).executeTakeFirst() ?? fail('Commission not found', 404)
      const commission = readJson<Commission>(row.data_json)
      if (commission.customerId !== null || !['DRAFT', 'REQUESTED', 'CONTRACT_PREPARATION'].includes(commission.stage) || commission.paused || activeEvidence(await allEvidence(commission.id, db))) fail('Commission cannot currently be claimed')
      const updated = await db.updateTable(t('invitations')).set({ claimed_by: actor.userId }).where('id', '=', invite.id).where('claimed_by', 'is', null).where('revoked', '=', 0).executeTakeFirstOrThrow()
      if (updated.numUpdatedRows !== 1n) fail('Invitation already claimed')
      commission.customerId = actor.userId
      await db.updateTable(t('invitations')).set({ revoked: 1 }).where('commission_id', '=', commission.id).where('claimed_by', 'is', null).execute()
      await persist(db, commission, commission.revision)
      await audit(db, commission, 'invitation-claimed', actor.userId)
      return { detail: await detail(commission.id, actor, db) }
    })
  }
  /**
   * 上传分为预授权与完成登记两阶段；预授权不会保留版本或锁定业务状态。
   * 完成时须重新校验权限、阶段和版本，并核对宿主文件元数据后才建立委托附件关联。
   */
  const upload = async (inv: PluginInvocation) => {
    const actor = requireActor(inv),
      query = inv.query ?? {}
    const input = entityCommand.extend({ purpose: purposeSchema }).strict().parse({
      commissionId: query.commissionId,
      purpose: query.purpose,
      commandId: query.commandId,
      revision: Number(query.revision)
    })
    const transport = z.object({
      phase: z.enum(['authorize', 'complete']),
      upload: z.object({
        id: z.string().max(160),
        name: z.string().min(1).max(255),
        size: z.string().regex(/^\d+$/),
        sha256: z.string().regex(/^[a-f0-9]{64}$/),
        createdAt: z.string()
      }).optional()
    }).strict().parse(inv.input)
    const authorize = async (db: Db) => {
      const commission = await owned(input.commissionId, actor, db)
      if (commission.revision !== input.revision) fail('STALE_REVISION: refresh the commission')
      if (commission.paused || ['CLOSED', 'TERMINATED'].includes(commission.stage) || activeEvidence(await allEvidence(commission.id, db))) fail('Uploads are blocked for frozen, paused or ended commissions')
      if (input.purpose === 'request' && commission.stage !== 'DRAFT') fail('Request attachments are only editable in drafts')
      if (['contract', 'delivery'].includes(input.purpose) && actor.role !== 'ADMIN') fail('Administrator upload required', 403)
      if (input.purpose === 'contract' && !['DRAFT', 'CONTRACT_PREPARATION', 'READY', 'IN_PROGRESS', 'MAINTENANCE'].includes(commission.stage)) fail('Contract upload not allowed at this stage')
      if (input.purpose === 'delivery' && commission.stage !== 'IN_PROGRESS') fail('Delivery upload requires implementation stage')
      if (input.purpose === 'maintenance' && commission.stage !== 'MAINTENANCE') fail('Maintenance upload requires maintenance stage')
      return commission
    }
    if (transport.phase === 'authorize') {
      await authorize(ctx.db)
      return { authorized: true }
    }
    if (!transport.upload) fail('Uploaded metadata is required', 400)
    const metadata = transport.upload
    return run(actor, { ...input, upload: metadata }, 'upload', async db => {
      const commission = await authorize(db),
        actual = await ctx.files.inspect(metadata.id)
      if (actual.sha256 !== metadata.sha256 || actual.size !== metadata.size || actual.name !== metadata.name) fail('ATTACHMENT_INTEGRITY_FAILURE')
      const file: Attachment = {
        ...actual,
        purpose: input.purpose,
        uploadedBy: actor.userId,
        shared: input.purpose === 'maintenance'
      }
      await db.insertInto(t('attachments')).values({
        id: randomUUID(),
        commission_id: commission.id,
        file_id: file.id,
        data_json: JSON.stringify(file)
      }).execute()
      await persist(db, commission, input.revision)
      await audit(db, commission, 'attachment-uploaded', actor.userId, { fileId: file.id, purpose: file.purpose })
      return { detail: await detail(commission.id, actor, db) }
    })
  }
  const download = async (inv: PluginInvocation) => {
    const actor = requireActor(inv),
      input = z.object({ commissionId: z.string(), fileId: z.string() }).parse(inv.query)
    const commission = await owned(input.commissionId, actor),
      file = (await attachments(commission.id)).find(item => item.id === input.fileId)
    if (!file || (actor.role !== 'ADMIN' && !file.shared && file.uploadedBy !== actor.userId)) fail('File not found', 404)
    await checkFiles(ctx.db, commission, actor, [file.id])
    return { fileId: file.id, name: file.name }
  }
  const archive = async (inv: PluginInvocation) => {
    const actor = requireActor(inv),
      id = z.string().parse(inv.query?.commissionId),
      view = await detail(id, actor)
    const files = await checkFiles(ctx.db, view.commission, actor, view.attachments.map(file => file.id))
    const cleanName = (name: string) => name.replace(/[^\p{L}\p{N}._-]/gu, '_').replace(/^\.+/, '_').slice(0, 120) || 'file'
    return {
      name: `commission-${id}.zip`,
      entries: [
        { path: 'commission.json', text: JSON.stringify(view, null, 2) },
        {
          path: 'README.txt',
          text: 'Mainnet evidence covers immutable snapshot digests. Audit records form a local SHA-256 chain; not every event is individually on-chain. Files are included only when authorized for this viewer.'
        },
        ...files.map((file, i) => ({ path: `files/${i + 1}-${cleanName(file.name)}`, fileId: file.id }))
      ]
    }
  }
  const receipt = async (inv: PluginInvocation) => {
    const id = z.string().min(1).max(160).parse(inv.query?.evidenceId)
    const row = await ctx.db.selectFrom(t('evidence')).selectAll().where('id', '=', id).executeTakeFirst() ?? fail('Receipt not found', 404)
    const record = readJson<FrozenAction>(row.data_json)
    return {
      evidenceId: record.id,
      digest: record.digest,
      memo: record.memo,
      status: record.status,
      signature: record.signature,
      network: 'mainnet',
      finalizedAt: record.effectiveAt
    }
  }
  /**
   * 维护到期按既定截止时间关闭，暂停状态不延长维护期。
   * 已提交主网的尝试必须先对账；尚未提交的冻结动作及未生效合同则随到期处理撤回或拒绝。
   */
  const maintenance = async () => {
    const rows = await ctx.db.selectFrom(t('commissions')).selectAll().where('stage', '=', 'MAINTENANCE').execute()
    for (const row of rows) {
      const saved = readJson<Commission>(row.data_json)
      if (!saved.maintenanceEndsAt || saved.maintenanceEndsAt > now()) continue
      await ctx.db.transaction().execute(async db => {
        const latest = await db.selectFrom(t('commissions')).selectAll().where('id', '=', saved.id).executeTakeFirst()
        if (!latest) return
        const commission = readJson<Commission>(latest.data_json)
        if (commission.stage !== 'MAINTENANCE' || !commission.maintenanceEndsAt || commission.maintenanceEndsAt > now()) return
        const pending = activeEvidence(await allEvidence(commission.id, db))
        // A submitted signature must be resolved first; unsent supplementary work must not
        // require an administrator to sign merely to allow the maintenance timer to close.
        if (pending?.status === 'SUBMITTED') return
        if (pending) {
          pending.status = 'WITHDRAWN'
          pending.error = 'Maintenance expired before this action took effect'
          await saveEvidence(db, pending)
          if (pending.attemptId) await db.updateTable(t('attempts')).set({ status: 'WITHDRAWN' }).where('id', '=', pending.attemptId).execute()
          await audit(db, commission, 'maintenance-expired-withdrawal', null, { evidenceId: pending.id })
        }
        for (const contract of commission.contracts) if (!contract.effectiveAt && !contract.rejectedAt) {
          contract.rejectedAt = now()
          contract.rejectionReason = 'Maintenance expired before confirmation took effect'
        }
        commission.stage = 'CLOSED'
        commission.paused = false
        await persist(db, commission, commission.revision)
        await audit(db, commission, 'maintenance-expired', null)
      })
    }
  }
  const reconcileAll = async () => {
    const rows = await ctx.db.selectFrom(t('attempts')).selectAll().where('status', '=', 'SUBMITTED').execute()
    let firstError: unknown
    for (const row of rows) {
      try {
        await reconcileOne(String(row.commission_id), String(row.evidence_id))
      } catch (error) {
        firstError ??= error
      }
    }
    if (firstError) throw firstError
  }
  const stopGuard = async () => {
    if (await ctx.db.selectFrom(t('attempts')).select('id').where('status', '=', 'SUBMITTED').executeTakeFirst()) fail('Reconcile submitted mainnet evidence before disabling or uninstalling')
  }
  return {
    api: {
      list,
      detail: inv => detail(z.string().parse(inv.query?.commissionId), requireActor(inv)),
      create,
      command,
      templates,
      'template-save': templateSave,
      prepare,
      submit,
      reconcile: inv => {
        const actor = requireAdmin(inv),
          input = entityCommand.extend({ evidenceId: z.string() }).strict().parse(inv.input)
        return reconcileOne(input.commissionId, input.evidenceId, actor, input)
      },
      evidence: async inv => {
        requireAdmin(inv)
        const rows = await ctx.db.selectFrom(t('evidence')).selectAll().where('status', 'not in', ['FINALIZED', 'WITHDRAWN']).execute()
        const list = []
        for (const row of rows) {
          const commission = await owned(String(row.commission_id), requireAdmin(inv))
          list.push({
            commissionId: commission.id,
            title: commission.title,
            evidence: readJson<FrozenAction>(row.data_json)
          })
        }
        return { list }
      },
      users: async inv => {
        requireAdmin(inv)
        return { list: await ctx.users.find({ query: inv.query?.query }) }
      },
      settings: async inv => {
        requireAdmin(inv)
        return getSettings()
      },
      'settings-save': async inv => {
        const actor = requireAdmin(inv),
          input = commandBase.extend({ acceptingNew: z.boolean() }).strict().parse(inv.input)
        return run(actor, input, 'settings-save', async db => {
          const updated = await db.updateTable(t('settings')).set({ accepting_new: input.acceptingNew ? 1 : 0, revision: input.revision + 1 }).where('id', '=', 'global').where(
            'revision',
            '=',
            input.revision
          ).executeTakeFirstOrThrow()
          if (updated.numUpdatedRows !== 1n) fail('STALE_SETTINGS_REVISION')
          return getSettings(db)
        })
      },
      invitation,
      claim,
      receipt,
      upload,
      download,
      archive,
    },
    mcp: {
      list: inv => list({ ...inv, query: {} }),
      detail: inv => {
        const input = z.object({ commissionId: z.string() }).strict().parse(inv.input)
        return detail(input.commissionId, requireActor(inv))
      },
      templates: inv => templates({ ...inv, query: {} }),
      'create-draft': create,
      'update-draft': async inv => {
        const input = entityCommand.extend({ data: z.record(z.string(), z.unknown()) }).strict().parse(inv.input)
        return command({ ...inv, input: { ...input, action: 'update-draft' } })
      },
    },
    migrations: { initial: async () => { } },
    onInstall: seed,
    onEnable: async () => {
      try {
        await reconcileAll()
      } finally {
        await maintenance()
      }
    },
    onDisable: stopGuard,
    onUninstall: stopGuard,
    jobs: { reconcile: reconcileAll, maintenance },
  }
})
