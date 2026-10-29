/**
 * @file runtime.ts
 * @project SlothVault
 * @module Plugin Worker Supervisor
 * @description Lazily activates workers and bounds SQL, market, SOL/USDT transfers and scheduled point-credit access.
 * @logic Associate host calls with admitted scopes, restrict column inspection to declared migration tables, roll back abandoned transactions and terminate unhealthy workers.
 * @dependencies worker_threads, plugin database bridge, encrypted config, Prisma
 * @index_tags plugins,worker,rpc,transactions,lifecycle
 * @author holic512
 */
import 'server-only'
import { randomUUID } from 'node:crypto'
import { z } from 'zod'
import { assertActiveAdministrator } from '@/server/auth/administrator'
import { preparePluginEvidence, validatePluginEvidence, broadcastPluginEvidence, observePluginEvidence } from './evidence'
import { inspectPluginFile } from './files'
import { Worker } from 'node:worker_threads'
import { resolve } from 'node:path'
import { tableSchema, type PluginInvocation } from '@slothvault/plugin-sdk/protocol'
import { prisma } from '@/server/prisma'
import { snapshotUser } from '@/server/database/user-attribution'
import { configuredDatabaseProvider } from '@/server/database/client'
import { unitOfWork } from '@/server/database/unit-of-work'
import { acquireMaintenanceLock, withMaintenanceLock } from '@/server/services/maintenance-lock'
import { HttpError } from '@/server/http/errors'
import { decryptPluginConfig } from './config'
import {
  CORE_TABLES,
  PluginTransactions,
  columnExists,
  pluginTableMap,
  runPluginQuery,
  type PluginTransaction
} from './database'
import { verifyInstalledPackage } from './packages'
import { compiledAsset, ensureCompiledPlugin } from './compiler'
import { pluginRegistry, type RegisteredPlugin } from './state'
import { enqueuePluginEvent } from './events'
import { getMarketQuote } from '@/server/services/market-data'
import {
  validateSolIntent,
  prepareSolTransfer,
  validateSignedTransfer,
  broadcastSolTransfer,
  observeSolTransfer
} from '@/server/services/sol-payment-chain'

type Scope = {
  scheduledJob: boolean
  actor: PluginInvocation['actor']
  transactions: PluginTransactions
  ddl: boolean
  readOnly: boolean
  background: boolean
  active: boolean
  hosts: Set<Promise<void>>
}

type Pending = {
  resolve(value: unknown): void
  reject(error: Error): void
  timer: ReturnType<typeof setTimeout>
  scope: Scope
}

export class PluginWorker {
  readonly worker: Worker
  readonly pending = new Map<string, Pending>()
  lastUsed = Date.now()
  stopped = false
  private stopping?: Promise<void>
  ready: Promise<void>

  constructor(readonly registered: RegisteredPlugin, readonly tables: Record<string, string>) {
    const manifest = registered.manifest
    this.worker = new Worker(resolve(/* turbopackIgnore: true */ process.cwd(), 'generated/plugin-runtime/worker.mjs'), {
      workerData: {
        manifest,
        config: decryptPluginConfig(registered.configCiphertext),
        provider: configuredDatabaseProvider(),
        tables,
        entry: compiledAsset(registered.digest, manifest.id, manifest.server!),
      },
      resourceLimits: { maxOldGenerationSizeMb: 128 },
    })
    this.ready = new Promise((resolve, reject) => {
      const timer = setTimeout(() => {
        reject(new HttpError('Plugin activation timed out', 503))
        void this.stop()
      }, 10_000)
      this.worker.on('message', async message => {
        if (message.type === 'ready') {
          clearTimeout(timer)
          resolve()
        } else if (message.type === 'fatal') {
          clearTimeout(timer)
          reject(new HttpError('Plugin activation failed', 503))
          void this.stop()
        } else if (message.type === 'result') {
          const item = this.pending.get(message.id)
          if (!item) return
          item.scope.active = false
          await item.scope.transactions.abortAll()
          await Promise.allSettled([...item.scope.hosts])
          clearTimeout(item.timer)
          this.pending.delete(message.id)
          if (message.error) {
            item.reject(new HttpError(message.error.message, Number(message.error.status) || 500))
          } else {
            item.resolve(message.value)
          }
        } else if (message.type === 'host') {
          const scope = this.pending.get(message.invocationId)?.scope
          const task = this.host(message)
          scope?.hosts.add(task)
          void task.finally(() => scope?.hosts.delete(task))
        }
      })
      this.worker.on(
        'error',
        () => {
          clearTimeout(timer)
          reject(new HttpError('Plugin worker failed', 503))
          void this.stop()
        }
      )
      this.worker.on(
        'exit',
        () => {
          clearTimeout(timer)
          reject(new HttpError('Plugin worker stopped', 503))
          void this.stop()
        }
      )
    })
    this.worker.unref()
  }

  async host(message: { id: number; invocationId: string; method: string; payload?: unknown }) {
    const scope = this.pending.get(message.invocationId)?.scope
    try {
      if (!scope) throw new HttpError('Plugin invocation is no longer active', 409)
      const assertActive = () => {
        if (!scope.active || this.stopped) {
          throw new HttpError('Plugin invocation is no longer active', 409)
        }
      }
      assertActive()
      const payload = (message.payload ?? {}) as Record<string, unknown>
      const tx = scope.transactions.get(payload.transactionId as string | undefined)
      const manifest = this.registered.manifest
      let value: unknown
      if (message.method.startsWith('db.')) {
        if (!manifest.capabilities.includes('database')) {
          throw new HttpError('Database capability was not declared', 403)
        }
        if (scope.readOnly && message.method !== 'db.query') throw new HttpError('This lifecycle is read only', 403)
        if (message.method === 'db.begin') {
          value = await scope.transactions.begin()
        } else if (message.method === 'db.commit' || message.method === 'db.rollback') {
          value = await scope.transactions.end(String(payload.transactionId), message.method === 'db.commit')
        } else if (message.method === 'db.query') {
          const query = payload as { sql: string; parameters: unknown[]; kind?: string; ast?: unknown }
          assertPluginQueryOwnership(query.ast, this.tables, scope.ddl)
          if (scope.readOnly && !/^\s*select\b/i.test(query.sql)) {
            throw new HttpError('This lifecycle is read only', 403)
          }
          value = scope.background && !tx
            ? await withMaintenanceLock(
              /^\s*select\b/i.test(query.sql) ? 'shared' : 'exclusive',
              () => {
                assertActive()
                return runPluginQuery(query, tx, scope.ddl, assertActive)
              }
            )
            : await runPluginQuery(query, tx, scope.ddl, assertActive)
        } else {
          throw new HttpError('Unknown database method', 400)
        }
      } else if (message.method === 'schema.hasColumn') {
        if (!scope.ddl || scope.readOnly || scope.transactions.active ||
          !manifest.capabilities.includes('database')) {
          throw new HttpError('Schema inspection is only permitted during migrations outside a transaction', 403)
        }
        const table = manifest.tables.find(table => table.name === payload.table)
        if (!table || typeof payload.column !== 'string' ||
          !table.columns.some(column => column.name === payload.column) ||
          !this.tables[table.name]) {
          throw new HttpError('Schema inspection requires a declared table and column', 403)
        }
        value = await columnExists(this.tables[table.name], payload.column)
        assertActive()
      } else if (message.method === 'market.quote') {
        if (scope.readOnly || !manifest.capabilities.includes('market.read') || scope.transactions.active) {
          throw new HttpError('Market quote is not permitted in this scope', 403)
        }
        value = await getMarketQuote()
      } else if (message.method.startsWith('solana.')) {
        if (scope.readOnly || !manifest.capabilities.includes('solana.transfer') || scope.transactions.active) {
          throw new HttpError('Solana transfers are not permitted in this scope', 403)
        }
        if (message.method === 'solana.validateIntent') {
          value = validateSolIntent(payload)
        } else if (message.method === 'solana.prepare') {
          value = await prepareSolTransfer(manifest.id, payload)
        } else if (message.method === 'solana.validateSigned') {
          value = { signature: validateSignedTransfer(manifest.id, payload).signature }
        } else if (message.method === 'solana.broadcast') {
          value = await broadcastSolTransfer(manifest.id, payload)
        } else if (message.method === 'solana.observe') {
          value = await observeSolTransfer(manifest.id, payload)
        } else {
          throw new HttpError('Unknown SOL transfer method', 400)
        }
        assertActive()
      } else if (message.method.startsWith('evidence.')) {
        if (!manifest.capabilities.includes('evidence.memo') || scope.transactions.active) {
          throw new HttpError('Evidence capability is not permitted in this scope', 403)
        }
        const observation = message.method === 'evidence.observe'
        if (!observation) {
          if (scope.readOnly ||
            !(scope.actor?.role === 'ADMIN' || (scope.scheduledJob && message.method === 'evidence.broadcast'))) {
            throw new HttpError('Evidence signing is administrator-only', 403)
          }
          if (scope.actor) await assertActiveAdministrator(prisma, scope.actor.userId)
        }
        if (message.method === 'evidence.prepare') {
          value = await preparePluginEvidence(manifest.id, payload)
        } else if (message.method === 'evidence.validateSigned') {
          value = { signature: validatePluginEvidence(manifest.id, payload).signature }
        } else if (message.method === 'evidence.broadcast') {
          value = await broadcastPluginEvidence(manifest.id, payload)
        } else if (observation) {
          value = await observePluginEvidence(manifest.id, payload)
        } else {
          throw new HttpError('Unknown evidence operation', 400)
        }
        assertActive()
      } else if (message.method.startsWith('files.')) {
        if (!manifest.capabilities.includes('files.private')) {
          throw new HttpError('Private files capability was not declared', 403)
        }
        if (message.method === 'files.inspect') {
          value = await inspectPluginFile(manifest.id, z.string().uuid().parse(payload.id))
        } else if (message.method === 'files.ensure') {
          const ids = z.array(z.string().uuid()).max(100).parse(payload.ids)
          const files = []
          for (const id of ids) {
            assertActive()
            files.push(await inspectPluginFile(manifest.id, id))
          }
          value = files
        } else {
          throw new HttpError('Unknown private file operation', 400)
        }
        assertActive()
      } else if (message.method === 'users.find') {
        if (!manifest.capabilities.includes('users.read') || !scope.actor) {
          throw new HttpError('User lookup is not permitted', 403)
        }
        const search = z.object({ query: z.string().max(100).optional(), userId: z.number().int().positive().optional() }).strict().parse(payload)
        if (scope.actor.role !== 'ADMIN' && search.userId !== scope.actor.userId) {
          throw new HttpError('Only administrators can search accounts', 403)
        }
        value = await (tx ?? prisma).user.findMany({
          where: {
            ...(search.userId ? { id: search.userId } : {}),
            ...(search.query ? { OR: [{ username: { contains: search.query } }, { displayName: { contains: search.query } }] } : {}),
          },
          select: { id: true, username: true, displayName: true, role: true, status: true },
          take: 25,
          orderBy: { id: 'asc' },
        })
      } else if (message.method === 'users.snapshot') {
        if (!manifest.capabilities.includes('users.read')) throw new HttpError('Users capability was not declared', 403)
        value = await snapshotUser(tx ?? prisma, Number(payload.userId))
      } else if (message.method === 'points.credit') {
        if (scope.readOnly || !manifest.capabilities.includes('points.credit') ||
          !(scope.actor
            ? (scope.actor.role === 'ADMIN' || scope.actor.userId === payload.userId)
            : scope.scheduledJob && manifest.capabilities.includes('points.credit.background'))) {
          throw new HttpError('Plugin cannot credit this account', 403)
        }
        if (!tx && scope.transactions.active) {
          throw new HttpError('Pass the current transaction when crediting points inside a transaction', 409)
        }
        const credit = async (reader: PluginTransaction) => {
          assertActive()
          const userId = Number(payload.userId)
          const amount = Number(payload.amount)
          const sourceKey = String(payload.sourceKey)
          if (!Number.isSafeInteger(userId) || userId < 1 || !Number.isSafeInteger(amount) || amount < 1 ||
            amount > 1_000_000 ||
            sourceKey.length > 255) {
            throw new HttpError('Invalid plugin point credit', 400)
          }
          const old = await reader.pluginPointReceipt.findUnique({ where: { pluginId_sourceKey: { pluginId: manifest.id, sourceKey } } })
          if (old) {
            if (old.userId !== userId || old.amount !== amount) {
              throw new HttpError('Point credit idempotency conflict', 409)
            }
            return {
              pointsBalance: (await reader.user.findUniqueOrThrow({ where: { id: userId }, select: { pointsBalance: true } })).pointsBalance,
              replayed: true,
            }
          }
          const updated = await reader.user.updateMany({
            where: { id: userId, status: 1, pointsBalance: { lte: 2_147_483_647 - amount } },
            data: { pointsBalance: { increment: amount }, updatedAt: new Date() },
          })
          if (!updated.count) throw new HttpError('Account is unavailable or point balance limit exceeded', 409)
          const user = await reader.user.findUniqueOrThrow({ where: { id: userId }, select: { pointsBalance: true } })
          await reader.pointTransaction.create({
            data: {
              userId,
              amount,
              balanceAfter: user.pointsBalance,
              type: manifest.id === 'slothvault.gift-cards' ? 'CARD_REDEEM' : 'PLUGIN_CREDIT',
              referenceId: String(payload.referenceId ?? sourceKey).slice(0, 128),
              description: String(payload.description).slice(0, 255),
            },
          })
          await reader.pluginPointReceipt.create({ data: { pluginId: manifest.id, sourceKey, userId, amount, balanceAfter: user.pointsBalance } })
          await enqueuePluginEvent(reader, 'core.points.credited', { pluginId: manifest.id, userId, amount, sourceKey })
          assertActive()
          return { pointsBalance: user.pointsBalance, replayed: false }
        }
        const run = () => unitOfWork.execute(credit, { mode: 'write', isolationLevel: 'Serializable' })
        value = tx ? await credit(tx) : scope.background ? await withMaintenanceLock('exclusive', run) : await run()
      } else if (message.method === 'events.emit') {
        if (scope.readOnly || !manifest.capabilities.includes('events') ||
          !String(payload.event).startsWith(`${manifest.id}.`)) {
          throw new HttpError('Plugin event namespace is invalid', 403)
        }
        if (!tx && scope.transactions.active) {
          throw new HttpError('Pass the current transaction when emitting an event inside a transaction', 409)
        }
        const emit = () => {
          assertActive()
          return tx
            ? enqueuePluginEvent(tx, String(payload.event), payload.payload)
            : unitOfWork.execute(
              async reader => {
                await enqueuePluginEvent(reader, String(payload.event), payload.payload)
                assertActive()
              },
              { mode: 'write' }
            )
        }
        value = scope.background && !tx ? await withMaintenanceLock('exclusive', emit) : await emit()
      } else if (message.method === 'services.call') {
        if (scope.readOnly || !manifest.capabilities.includes('services') ||
          !Object.hasOwn(manifest.dependencies, String(payload.pluginId))) {
          throw new HttpError('Service dependency was not declared', 403)
        }
        const target = pluginRegistry.get(String(payload.pluginId))
        if (!target?.enabled || !target.installed || !target.manifest.services.includes(String(payload.service))) {
          throw new HttpError('Plugin service is unavailable', 409)
        }
        if (scope.transactions.active) {
          throw new HttpError('Cross-plugin service calls cannot run inside a database transaction', 409)
        }
        value = await (await startPluginWorker(target)).invoke(
          'services',
          String(payload.service),
          { actor: scope.actor, input: payload.input },
          { background: scope.background }
        )
      } else {
        throw new HttpError('Unknown plugin host method', 400)
      }
      if (!this.stopped) this.worker.postMessage({ type: 'host-result', id: message.id, value })
    } catch (error) {
      if (!this.stopped) {
        this.worker.postMessage({
          type: 'host-result',
          id: message.id,
          error: {
            message: error instanceof HttpError ? error.message : 'Plugin host operation failed',
            status: error instanceof HttpError ? error.status : 500,
          },
        })
      }
    }
  }

  /**
   * 将一次调用派发给 Worker，并跟踪该调用发起的宿主操作和事务。
   * @param group 处理器分组，例如 api、jobs、migrations 或 lifecycle。
   * @param key 对应分组中声明的处理器键；lifecycle 使用生命周期方法名。
   * @param input 携带已认证 actor 的调用数据，后台任务可不提供。
   * @param options.ddl 仅受管迁移可开启结构变更能力。
   * @param options.readOnly 限制本次调用允许的宿主操作，不构成独立的安全沙箱。
   * @param options.timeout 执行超时毫秒数，默认 15000；超时会停止整个 Worker。
   * @param options.background 为后台数据库操作启用维护锁协调。
   * @param options.task 宿主持久化的任务上下文；识别合法后台作业时还会核对清单声明。
   */
  async invoke(group: string, key: string, input?: unknown, options: {
    ddl?: boolean
    readOnly?: boolean
    timeout?: number
    background?: boolean
    task?: { id: string; attempt: number; scheduledAt: string }
  } = {}) {
    await this.ready
    if (this.stopped || this.pending.size >= 16) throw new HttpError('Plugin is busy or stopped', 503)
    this.lastUsed = Date.now()
    return new Promise<unknown>((resolve, reject) => {
      const id = randomUUID()
      const scope: Scope = {
        scheduledJob: group === 'jobs' && options.background === true && !!options.task &&
          this.registered.manifest.jobs.some(job => job.key === key),
        active: true,
        hosts: new Set(),
        actor: (input as PluginInvocation | undefined)?.actor ?? null,
        transactions: new PluginTransactions(options.background ? () => acquireMaintenanceLock('exclusive') : undefined),
        background: options.background ?? false,
        ddl: options.ddl ?? false,
        readOnly: options.readOnly ?? false,
      }
      const timer = setTimeout(
        () => {
          reject(new HttpError('Plugin execution timed out', 504))
          void this.stop()
        },
        options.timeout ?? 15_000
      )
      this.pending.set(id, { resolve, reject, timer, scope })
      this.worker.postMessage({ type: 'invoke', id, group, key, input, task: options.task })
    })
  }

  /** 停止接纳调用、回滚未结束事务并终止 Worker；重复调用复用同一个停止过程。 */
  stop(): Promise<void> {
    if (this.stopping) return this.stopping
    this.stopped = true
    this.stopping = (async () => {
      const admitted = [...this.pending.values()]
      for (const item of admitted) {
        item.scope.active = false
        clearTimeout(item.timer)
        item.reject(new HttpError('Plugin stopped', 503))
        await item.scope.transactions.abortAll()
      }
      this.pending.clear()
      await this.worker.terminate().catch(() => undefined)
      // Foreground DB calls do not wait on the outer maintenance lock. Drain
      // them before upgrade recovery; background waiters recheck active on entry.
      await Promise.allSettled(admitted.filter(item => !item.scope.background).flatMap(item => [...item.scope.hosts]))
    })()
    return this.stopping
  }

}

const globalRuntime = globalThis as unknown as {
  slothVaultPluginWorkers?: Map<string, PluginWorker>
  slothVaultPluginStarting?: Map<string, Promise<PluginWorker>>
}
export const pluginWorkers = globalRuntime.slothVaultPluginWorkers ??= new Map()
const starting = globalRuntime.slothVaultPluginStarting ??= new Map<string, Promise<PluginWorker>>()

/**
 * 合并同一插件的并发启动请求，并复用内容摘要与状态代次一致的健康 Worker。
 * @param registered 宿主注册表中的当前插件状态；编译等待后仍会重新检查其 generation。
 */
export function startPluginWorker(registered: RegisteredPlugin): Promise<PluginWorker> {
  const id = registered.manifest.id
  const active = starting.get(id)
  if (active) return active
  if (starting.size >= 8) return Promise.reject(new HttpError('Plugin activation capacity reached', 503))
  const task = activatePluginWorker(registered).finally(() => { if (starting.get(id) === task) starting.delete(id) })
  starting.set(id, task)
  return task
}

async function activatePluginWorker(registered: RegisteredPlugin) {
  const generation = registered.generation
  const old = pluginWorkers.get(registered.manifest.id)
  if (old && !old.stopped && old.registered.digest === registered.digest &&
    old.registered.generation === registered.generation) {
    await old.ready
    return old
  }
  if (old) await old.stop()
  for (const [id, worker] of pluginWorkers) {
    if (worker.stopped || (!worker.pending.size && Date.now() - worker.lastUsed > 300_000)) {
      await worker.stop()
      pluginWorkers.delete(id)
    }
  }
  if (pluginWorkers.size >= 8) {
    const idle = [...pluginWorkers].filter(([, w]) => !w.pending.size).sort((a, b) => a[1].lastUsed - b[1].lastUsed)[0]
    if (!idle) throw new HttpError('Plugin worker capacity reached', 503)
    await idle[1].stop()
    pluginWorkers.delete(idle[0])
  }
  if (!registered.manifest.server) throw new HttpError('Plugin has no backend', 404)
  await verifyInstalledPackage(registered.digest, registered.manifest)
  await ensureCompiledPlugin(registered.digest, registered.manifest)
  const retained = await prisma.pluginOwnedTable.findMany({ where: { pluginId: registered.manifest.id } })
  const tables = {
    ...Object.fromEntries(retained.map(t => [tableSchema.parse(JSON.parse(t.descriptorJson)).name, t.name])),
    ...pluginTableMap(registered.manifest),
  }
  if (registered.generation !== generation) throw new HttpError('Plugin state changed during activation', 409)
  if (pluginWorkers.size >= 8) {
    const idle = [...pluginWorkers].find(([, worker]) => !worker.pending.size)
    if (idle) {
      await idle[1].stop()
      pluginWorkers.delete(idle[0])
    }
  }
  if (pluginWorkers.size >= 8) throw new HttpError('Plugin worker capacity reached', 503)
  const worker = new PluginWorker(registered, tables)
  pluginWorkers.set(registered.manifest.id, worker)
  try {
    await worker.ready
    return worker
  } catch (error) {
    await worker.stop()
    throw error
  }
}

export async function stopPluginWorker(id: string) {
  await starting.get(id)?.catch(() => undefined)
  const worker = pluginWorkers.get(id)
  if (!worker) return
  if (!worker.stopped) {
    try {
      await worker.invoke('lifecycle', 'dispose', undefined, { readOnly: true, timeout: 2000 })
    } catch { /* Force termination below. */ }
  }
  await worker.stop()
  pluginWorkers.delete(id)
}

/**
 * 检查编译后查询引用的物理表及迁移目标，防止误访问未声明的表。
 * 这里只是 SDK 使用边界，不是安全沙箱；受信任插件仍具有 Node.js 进程权限。
 * @param ast Kysely 编译结果中的查询语法树，不接受顶层原始 SQL 节点。
 * @param tables 当前插件获准使用的逻辑表名到物理表名映射。
 * @param ddl 是否处于受管迁移阶段；为 true 仍不允许变更非插件所属的目标表。
 */
export function assertPluginQueryOwnership(ast: unknown, tables: Record<string, string>, ddl: boolean) {
  if (!ast || typeof ast !== 'object') throw new HttpError('Plugin SQL requires a compiled Kysely query', 400)
  const root = ast as Record<string, unknown>
  if (root.kind === 'RawNode') throw new HttpError('Top-level raw SQL is not part of portable plugin API v1', 403)
  if (![
    'SelectQueryNode',
    'InsertQueryNode',
    'UpdateQueryNode',
    'DeleteQueryNode',
    'CreateTableNode',
    'AlterTableNode',
    'DropTableNode',
    'CreateIndexNode',
    'DropIndexNode'
  ].includes(String(root.kind))) {
    throw new HttpError('Unsupported portable plugin SQL operation', 403)
  }
  const allowed = new Set(Object.values(tables))
  const references: string[] = []
  let visited = 0
  const walk = (value: unknown) => {
    if (!value || typeof value !== 'object') return
    if (++visited > 50000) throw new HttpError('Plugin query AST is too large', 413)
    const node = value as Record<string, unknown>
    if (node.kind === 'TableNode') {
      const table = node.table as { identifier?: { name?: string }; schema?: unknown }
      if (table.schema || !table.identifier?.name) throw new HttpError('Qualified plugin tables are not supported', 403)
      references.push(table.identifier.name)
    }
    for (const child of Object.values(node)) {
      if (Array.isArray(child)) {
        child.forEach(walk)
      } else {
        walk(child)
      }
    }
  }
  walk(ast)
  const changingSchema = typeof root.kind === 'string' && /^(Create|Alter|Drop)/.test(root.kind)
  if (changingSchema && (!ddl || !references.length || !allowed.has(references[0]))) {
    throw new HttpError('Plugin migration target is not an owned table', 403)
  }
  for (const name of references) {
    if (!allowed.has(name) && !(changingSchema && Object.values(CORE_TABLES).includes(name))) {
      throw new HttpError('Plugin query references an undeclared table', 403)
    }
  }
}
