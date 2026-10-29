/**
 * @file server.ts
 * @project SlothVault
 * @module Independent Gift-card Plugin
 * @description Owns plaintext card issuance, administrator detail inspection and one-time redemption while the host continues to own balances and ledger entries.
 * @logic Create ordinary plugin-owned tables, persist full codes, conditionally consume cards, and credit points through the same host transaction.
 * @dependencies Plugin SDK, node crypto, zod
 * @index_tags plugins,gift-cards,points,atomic,legacy
 * @author holic512
 */
import { createHash, randomBytes } from 'node:crypto'
import { z } from 'zod'
import { definePlugin, type PluginInvocation } from '@slothvault/plugin-sdk/server'

function fail(message: string, status = 409): never {
  throw Object.assign(new Error(message), { status })
}

const normalized = (code: string) => code.trim().toUpperCase().replace(/[^A-Z0-9]/g, '')
const hash = (code: string) => createHash('sha256').update(normalized(code)).digest('hex')
const inputSchema = z.object({
  name: z.string().trim().min(2).max(128),
  points: z.number().int().min(1).max(1_000_000),
  quantity: z.number().int().min(1).max(500),
  expiresAt: z.string().datetime().nullable().optional(),
})
const pageNumber = (input: unknown, fallback: number, max: number) => {
  const value = input === undefined ? fallback : Number(input)
  if (!Number.isSafeInteger(value) || value < 1 || value > max) {
    fail('Invalid pagination', 400)
  }
  return value
}
export default definePlugin(ctx => {
  const batches = ctx.table('batches')
  const cards = ctx.table('cards')
  const list = async (invocation: PluginInvocation) => {
    if (invocation.actor?.role !== 'ADMIN') fail('Unauthorized', 401)
    const input = (invocation.input ?? invocation.query ?? {}) as Record<string, unknown>
    const page = pageNumber(input.page, 1, 1_000_000)
    const pageSize = pageNumber(input.pageSize, 20, 100)
    const [rows, count] = await Promise.all([
      ctx.db
        .selectFrom(batches)
        .selectAll()
        .orderBy('created_at', 'desc')
        .orderBy('id', 'desc')
        .limit(pageSize)
        .offset((page - 1) * pageSize)
        .execute(),
      ctx.db.selectFrom(batches).select(eb => eb.fn.countAll().as('total')).executeTakeFirstOrThrow(),
    ])
    const grouped = rows.length
      ? await ctx.db
        .selectFrom(cards)
        .select(eb => ['batch_id', 'status', eb.fn.countAll().as('n')])
        .where('batch_id', 'in', rows.map(row => row.id))
        .groupBy(['batch_id', 'status'])
        .execute()
      : []
    const totals = new Map<string, { quantity: number; redeemed: number }>()
    for (const row of grouped) {
      const value = totals.get(String(row.batch_id)) ?? { quantity: 0, redeemed: 0 }
      value.quantity += Number(row.n)
      if (Number(row.status) === 2) {
        value.redeemed += Number(row.n)
      }
      totals.set(String(row.batch_id), value)
    }
    return {
      total: Number(count.total), list: await Promise.all(rows.map(async batch => {
        const snapshots = JSON.parse(String(batch.attribution_json || '{}'))
        let createdBy = snapshots.createdById?.username ?? 'System'
        if (!snapshots.createdById && batch.created_by_id) {
          try {
            createdBy = (await ctx.users.snapshot(Number(batch.created_by_id))).username
          } catch { /* Historical user may be deleted. */ }
        }
        return {
          id: String(batch.id),
          name: String(batch.name),
          points: Number(batch.points),
          quantity: totals.get(String(batch.id))?.quantity ?? 0,
          redeemed: totals.get(String(batch.id))?.redeemed ?? 0,
          status: Number(batch.status),
          expiresAt: batch.expires_at,
          createdBy,
          createdAt: batch.created_at,
        }
      })),
    }
  }

  const issue = async (invocation: PluginInvocation) => {
    if (invocation.actor?.role !== 'ADMIN') fail('Unauthorized', 401)
    const parsed = inputSchema.safeParse(invocation.input)
    if (!parsed.success) fail('Invalid gift-card batch', 400)
    const input = parsed.data
    if (input.quantity > Number(ctx.config.maxBatchQuantity)) fail('Batch quantity exceeds plugin configuration', 400)
    const expiresAt = input.expiresAt ? new Date(input.expiresAt) : null
    if (expiresAt && expiresAt.getTime() <= Date.now()) fail('Expiration must be in the future', 400)
    const codes = Array.from(
      { length: input.quantity },
      () => {
        const v = randomBytes(10).toString('hex').toUpperCase()
        return `SV-${v.slice(0, 5)}-${v.slice(5, 10)}-${v.slice(10, 15)}-${v.slice(15)}`
      }
    )
    if (new Set(codes).size !== codes.length) fail('Unable to generate unique gift cards', 500)
    const identity = await ctx.users.snapshot(invocation.actor.userId)
    return ctx.db.transaction().execute(async tx => {
      const now = new Date()
      const values = {
        name: input.name,
        points: input.points,
        quantity: input.quantity,
        status: 1,
        created_by_id: invocation.actor!.userId,
        attribution_json: JSON.stringify({ createdById: identity }),
        expires_at: expiresAt,
        created_at: now,
        updated_at: now,
      }
      const insert = tx.insertInto(batches).values(values)
      const batchId = ctx.provider === 'mysql'
        ? (await insert.executeTakeFirstOrThrow()).insertId
        : (await insert.returning('id').executeTakeFirstOrThrow()).id
      await tx
        .insertInto(cards)
        .values(codes.map(code => ({
          batch_id: Number(batchId),
          code,
          status: 1,
          redeemed_by_id: null,
          redeemed_at: null,
          created_at: now,
        })))
        .execute()
      return { batch: { id: String(batchId), ...input, expiresAt, createdAt: now }, codes }
    })
  }
  const redeem = async (invocation: PluginInvocation) => {
    if (!invocation.actor) fail('Unauthorized', 401)
    const input = z.object({ code: z.string().trim().min(10).max(64) }).safeParse(invocation.input)
    if (!input.success) fail('Invalid gift card code', 400)
    const code = normalized(input.data.code)
    if (!code.startsWith('SV') || code.length !== 22) fail('Invalid gift card code', 400)
    return ctx.db.transaction().execute(async tx => {
      const card = await tx
        .selectFrom(cards)
        .selectAll()
        .where(
          'code',
          '=',
          `SV-${code.slice(2, 7)}-${code.slice(7, 12)}-${code.slice(12, 17)}-${code.slice(17)}`
        )
        .executeTakeFirst()
      if (!card || Number(card.status) !== 1) fail('Gift card is invalid or already redeemed')
      const batch = await tx.selectFrom(batches).selectAll().where('id', '=', card.batch_id).executeTakeFirst()
      if (!batch || Number(batch.status) !== 1) fail('Gift card batch is disabled')
      if (batch.expires_at && new Date(String(batch.expires_at)).getTime() <= Date.now()) fail('Gift card has expired')
      const consumed = await tx
        .updateTable(cards)
        .set({ status: 2, redeemed_by_id: invocation.actor!.userId, redeemed_at: new Date() })
        .where('id', '=', card.id)
        .where('status', '=', 1)
        .where('redeemed_by_id', 'is', null)
        .executeTakeFirstOrThrow()
      if (consumed.numUpdatedRows !== 1n) fail('Gift card is invalid or already redeemed')
      const credited = await ctx.points.credit(
        {
          userId: invocation.actor!.userId,
          amount: Number(batch.points),
          sourceKey: `redeem:${hash(code)}`,
          description: `Redeemed ${batch.name}`,
          referenceId: String(card.id),
        },
        tx
      )
      return {
        pointsAdded: credited.replayed ? 0 : Number(batch.points),
        pointsBalance: credited.pointsBalance,
        batchName: String(batch.name),
      }
    })
  }
  const stats = async (invocation: PluginInvocation) => {
    if (invocation.actor?.role !== 'ADMIN') fail('Unauthorized', 401)
    const [total, redeemed] = await Promise.all([
      ctx.db.selectFrom(cards).select(eb => eb.fn.countAll().as('n')).executeTakeFirstOrThrow(),
      ctx.db.selectFrom(cards).select(eb => eb.fn.countAll().as('n')).where('status', '=', 2).executeTakeFirstOrThrow()
    ])
    return { total: Number(total.n), redeemed: Number(redeemed.n) }
  }
  const cardDetails = async (invocation: PluginInvocation) => {
    if (invocation.actor?.role !== 'ADMIN') fail('Unauthorized', 403)
    const input = invocation.query ?? {}
    const batchId = pageNumber(input.batchId, 0, 2_147_483_647)
    const page = pageNumber(input.page, 1, 1_000_000)
    const pageSize = pageNumber(input.pageSize, 20, 100)
    const status = input.status
    if (status && !['unused', 'used', 'expired', 'disabled'].includes(status)) fail('Invalid card status', 400)
    const batch = await ctx.db.selectFrom(batches).selectAll().where('id', '=', batchId).executeTakeFirst()
    if (!batch) fail('Batch not found', 404)
    let query = ctx.db.selectFrom(cards).where('batch_id', '=', batchId)
    const expired = !!batch.expires_at && new Date(String(batch.expires_at)).getTime() <= Date.now()
    const disabled = Number(batch.status) !== 1
    if (status === 'used') {
      query = query.where('status', '=', 2)
    } else if (status === 'disabled') {
      query = disabled ? query.where('status', '!=', 2) : query.where('status', '=', 0)
    } else if (status) {
      query = query.where('status', '=', 1)
      const match = status === 'expired' ? expired && !disabled : !expired && !disabled
      if (!match) return { list: [], total: 0 }
    }
    const [rows, count] = await Promise.all([
      query.selectAll().orderBy('id', 'desc').limit(pageSize).offset((page - 1) * pageSize).execute(),
      query.select(eb => eb.fn.countAll().as('total')).executeTakeFirstOrThrow(),
    ])
    const users = new Map<number, string>()
    for (const row of rows) {
      if (row.redeemed_by_id && !users.has(Number(row.redeemed_by_id))) {
        try {
          users.set(Number(row.redeemed_by_id), (await ctx.users.snapshot(Number(row.redeemed_by_id))).username)
        } catch {
          users.set(Number(row.redeemed_by_id), 'Deleted user')
        }
      }
    }
    return {
      total: Number(count.total), list: rows.map(row => ({
        id: String(row.id), code: String(row.code), points: Number(batch.points),
        status: Number(row.status) === 2 ? 'used' : disabled || Number(row.status) === 0 ? 'disabled' : expired ? 'expired' : 'unused',
        redeemedBy: row.redeemed_by_id ? users.get(Number(row.redeemed_by_id)) : null,
        redeemedAt: row.redeemed_at, expiresAt: batch.expires_at,
      })),
    }
  }
  return {
    api: { list, issue, redeem, stats, cards: cardDetails },
    services: { list, issue, redeem, stats },
    migrations: { initial: async () => { } },
  }
})
