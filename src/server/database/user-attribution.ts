/**
 * @file user-attribution.ts
 * @project SlothVault
 * @module Persistence Audit Attribution
 * @description Captures historical operators on business writes without giving administrators ownership of site data.
 * @logic Wrap runtime and transaction delegates, preserve supplied portable snapshots, and merge attribution on operator changes including nested audits.
 * @dependencies Prisma transaction client, lib/user-attribution
 * @index_tags users,audit,prisma,transaction,site
 * @author holic512
 */
import 'server-only'
import type { Prisma } from '@generated/prisma-postgresql/client'
import { readAttribution, USER_ATTRIBUTION_FIELDS, type AttributionModel, type UserIdentity } from '@/lib/user-attribution'

type Client = Pick<Prisma.TransactionClient, 'user' | 'systemInstallation'>
type Row = Record<string, unknown>
type Delegate = {
  findMany(args: Row): Promise<Row[]>
  findUnique(args: Row): Promise<Row | null>
  update(args: Row): Promise<Row>
}
const nestedModels: Record<string, Record<string, string>> = {
  releaseCredential: { attempts: 'releaseCredentialAttempt' },
}

export async function snapshotUser(client: Client, userId: number): Promise<UserIdentity> {
  const user = await client.user.findUniqueOrThrow({ where: { id: userId }, select: { id: true, username: true, displayName: true, role: true } })
  const installation = await client.systemInstallation.findUnique({ where: { id: 1 }, select: { installationId: true } })
  return { installationId: installation?.installationId ?? null, userId: String(user.id), username: user.username, displayName: user.displayName, role: user.role as UserIdentity['role'] }
}

async function attributedData(client: Client, model: string, data: Row, existing?: Row | null): Promise<Row> {
  const result = { ...data }
  const fields = USER_ATTRIBUTION_FIELDS[model as AttributionModel] as readonly string[] | undefined
  if (fields && data.attributionJson === undefined) {
    const snapshots = readAttribution(existing?.attributionJson as string | undefined)
    for (const field of fields) {
      const userId = model === 'pointTransaction' && data.type === 'ADMIN_ADJUSTMENT'
        ? Number(data.referenceId) : data[field]
      if (typeof userId === 'number' && Number.isSafeInteger(userId) && userId > 0) snapshots[field] = await snapshotUser(client, userId)
    }
    if (Object.keys(snapshots).length) result.attributionJson = JSON.stringify(snapshots)
  }
  for (const [relation, childModel] of Object.entries(nestedModels[model] ?? {})) {
    const nested = data[relation] as Row | undefined
    if (!nested) continue
    const patch = { ...nested }
    if (nested.create) patch.create = Array.isArray(nested.create)
      ? await Promise.all(nested.create.map(row => attributedData(client, childModel, row)))
      : await attributedData(client, childModel, nested.create as Row)
    result[relation] = patch
  }
  return result
}

const wrapped = new WeakMap<object, object>()
export function withUserAttribution<T extends object>(client: T): T {
  const cached = wrapped.get(client)
  if (cached) return cached as T
  const proxy = new Proxy(client, {
    get(target, property, receiver) {
      const value = Reflect.get(target, property, receiver)
      if (property === '$transaction' && typeof value === 'function') return (operation: unknown, options: unknown) => {
        if (typeof operation !== 'function') return value.call(target, operation, options)
        return value.call(target, (tx: object) => operation(withUserAttribution(tx)), options)
      }
      if (typeof property !== 'string' || (!Object.hasOwn(USER_ATTRIBUTION_FIELDS, property) && !nestedModels[property])) return typeof value === 'function' ? value.bind(target) : value
      const delegate = value as Delegate & Record<string, (args: Row) => Promise<unknown>>
      return new Proxy(delegate, {
        get(modelTarget, method) {
          const fn = Reflect.get(modelTarget, method)
          if (!['create', 'createMany', 'update', 'updateMany', 'upsert'].includes(String(method))) return typeof fn === 'function' ? fn.bind(modelTarget) : fn
          return async (args: Row) => {
            const auditClient = target as unknown as Client
            if (method === 'upsert') {
              const existing = await modelTarget.findUnique({ where: args.where })
              return fn.call(modelTarget, { ...args, create: await attributedData(auditClient, property, args.create as Row), update: await attributedData(auditClient, property, args.update as Row, existing) })
            }
            const data = args.data as Row
            if (method === 'createMany') {
              const rows = Array.isArray(data) ? data : [data]
              return fn.call(modelTarget, { ...args, data: await Promise.all(rows.map(row => attributedData(auditClient, property, row))) })
            }
            const fields = USER_ATTRIBUTION_FIELDS[property as AttributionModel] as readonly string[] | undefined
            const changesOperator = fields?.some(field => typeof data[field] === 'number')
            if (method === 'updateMany' && changesOperator && data.attributionJson === undefined) {
              const rows = await modelTarget.findMany({ where: args.where })
              let count = 0
              for (const row of rows) {
                const result = await modelTarget.updateMany({ where: { AND: [args.where ?? {}, { id: row.id }] }, data: await attributedData(auditClient, property, data, row) }) as { count: number }
                count += result.count
              }
              return { count }
            }
            const existing = method === 'update' && changesOperator ? await modelTarget.findUnique({ where: args.where }) : undefined
            return fn.call(modelTarget, { ...args, data: await attributedData(auditClient, property, data, existing) })
          }
        },
      })
    },
  })
  wrapped.set(client, proxy)
  wrapped.set(proxy, proxy)
  return proxy
}
