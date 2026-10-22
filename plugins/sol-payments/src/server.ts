/**
 * @file server.ts
 * @project SlothVault
 * @module Solana Payments Plugin
 * @description Owns locked purchase orders, durable signed payment attempts and exactly-once point settlement.
 * @logic Default new orders to fixed-unit USDT, preserve legacy SOL intents, persist before broadcast and atomically settle finalized chain facts through the host ledger.
 * @dependencies Plugin SDK, node crypto, zod, precise pricing
 * @index_tags plugins,payments,solana,points,reconciliation
 * @author holic512
 */
import { randomUUID } from 'node:crypto'
import { z } from 'zod'
import { definePlugin, type PluginInvocation, type PreparedSolTransfer, type SolTransferIntent, type PluginServer } from '@slothvault/plugin-sdk/server'
import { decimal, paymentLamports, paymentTokenAmount } from './pricing'
const fail = (message: string, status = 409): never => { throw Object.assign(new Error(message), { status }) }
type Row = Record<string, unknown>
const date = (value: unknown) => value instanceof Date ? value.getTime() : Date.parse(String(value))
const preparedOf = (row: Row) => JSON.parse(String(row.prepared_json)) as PreparedSolTransfer
const assetOf = (row: Row) => row.payment_asset === 'USDT' ? 'USDT' : 'SOL'
const orderInput = z.object({ orderId: z.string().uuid() })
export default definePlugin(ctx => {
  const orders = ctx.table('orders'), attempts = ctx.table('attempts')
  const config = () => {
    const rate = String(ctx.config.pointsPerUsdt), recipient = String(ctx.config.recipient)
    const minPoints = Number(ctx.config.minPoints), maxPoints = Number(ctx.config.maxPoints)
    let valid = true
    try { decimal(rate) } catch { valid = false }
    valid &&= !!recipient && Number.isInteger(minPoints) && Number.isInteger(maxPoints) && minPoints >= 1 && maxPoints <= 1_000_000 && minPoints <= maxPoints
    return { salesEnabled: ctx.config.salesEnabled === true && valid, recipient, pointsPerUsdt: rate, minPoints, maxPoints, assets: ['USDT', 'SOL'], defaultAsset: 'USDT' }
  }
  const owned = async (id: string, actor: PluginInvocation['actor'], admin = false) => {
    if (!actor || (admin && actor.role !== 'ADMIN')) fail('UNAUTHORIZED', 403)
    const order = await ctx.db.selectFrom(orders).selectAll().where('id', '=', id).executeTakeFirst()
    if (!order || (!admin && Number(order.user_id) !== actor!.userId)) fail('ORDER_NOT_FOUND', 404)
    return order!
  }
  const snapshot = async (order: Row) => {
    const attempt = order.active_attempt_id ? await ctx.db.selectFrom(attempts).selectAll().where('id', '=', order.active_attempt_id).executeTakeFirst() : undefined
    return { id: String(order.id), userId: order.user_id == null ? null : Number(order.user_id), points: Number(order.points), payer: String(order.payer), recipient: String(order.recipient), asset: assetOf(order), amount: String(assetOf(order) === 'USDT' ? order.token_amount : order.lamports), lamports: String(order.lamports), rate: String(order.rate), quote: JSON.parse(String(order.quote_json)), network: order.network,
      status: order.status === 'AWAITING_PAYMENT' && date(order.expires_at) <= Date.now() ? 'EXPIRED' : order.status,
      expiresAt: order.expires_at, createdAt: order.created_at, signature: attempt?.signature ?? null, slot: attempt?.slot ?? null, reason: order.reason }
  }
  const create = async (inv: PluginInvocation) => {
    if (!inv.actor) fail('UNAUTHORIZED', 401)
    const input = z.object({ points: z.number().int().min(1).max(1_000_000), payer: z.string().max(44), requestKey: z.string().uuid(), asset: z.enum(['USDT', 'SOL']).default('USDT') }).strict().parse(inv.input)
    const previous = () => ctx.db.selectFrom(orders).selectAll().where('user_id', '=', inv.actor!.userId).where('request_key', '=', input.requestKey).executeTakeFirst()
    const replay = async (row: Row) => { if (Number(row.points) !== input.points || row.payer !== input.payer || assetOf(row) !== input.asset) fail('IDEMPOTENCY_CONFLICT'); return snapshot(row) }
    const old = await previous(); if (old) return replay(old)
    const settings = config()
    if (!settings.salesEnabled) fail('SALES_PAUSED')
    if (input.points < settings.minPoints || input.points > settings.maxPoints) fail('INVALID_POINTS', 400)
    const id = randomUUID()
    // USDT uses the configured points ratio directly; only native SOL needs market conversion.
    await ctx.solana.validateIntent({ orderId: id, payer: input.payer, recipient: settings.recipient, network: 'mainnet', ...(input.asset === 'USDT' ? { asset: 'USDT', tokenAmount: '1' } : { lamports: '1' }) })
    const quote = input.asset === 'SOL' ? await ctx.marketData.quote() : null
    const lamports = quote ? paymentLamports(input.points, settings.pointsPerUsdt, quote.price) : '0'
    const tokenAmount = input.asset === 'USDT' ? paymentTokenAmount(input.points, settings.pointsPerUsdt) : null
    const now = new Date(), identity = await ctx.users.snapshot(inv.actor!.userId)
    const row = { id, user_id: inv.actor!.userId, attribution_json: JSON.stringify({ userId: identity }), request_key: input.requestKey, points: input.points, payer: input.payer, recipient: settings.recipient, lamports, payment_asset: input.asset, token_amount: tokenAmount, rate: settings.pointsPerUsdt, quote_json: JSON.stringify(quote), network: 'mainnet', status: 'AWAITING_PAYMENT', active_attempt_id: null, revision: 0, expires_at: new Date(now.getTime() + 300_000), created_at: now, updated_at: now, reason: null }
    try { await ctx.db.insertInto(orders).values(row).execute() } catch (error) { const existing = await previous(); if (existing) return replay(existing); throw error }
    return snapshot(row)
  }
  const prepare = async (inv: PluginInvocation) => {
    const { orderId } = orderInput.strict().parse(inv.input), order = await owned(orderId, inv.actor)
    if (order.status !== 'AWAITING_PAYMENT' || date(order.expires_at) <= Date.now()) fail('ORDER_NOT_PAYABLE')
    const old = order.active_attempt_id ? await ctx.db.selectFrom(attempts).selectAll().where('id', '=', order.active_attempt_id).executeTakeFirst() : undefined
    if (old && !['FAILED', 'EXPIRED'].includes(String(old.status))) {
      if (old.status !== 'PREPARED') fail('PAYMENT_PENDING')
      const observation = await ctx.solana.observe({ prepared: preparedOf(old) })
      if (observation.status !== 'EXPIRED') return { attemptId: old.id, prepared: preparedOf(old) }
    }
    const intent: SolTransferIntent = { orderId, payer: String(order.payer), recipient: String(order.recipient), network: 'mainnet', ...(assetOf(order) === 'USDT' ? { asset: 'USDT', tokenAmount: String(order.token_amount) } : { lamports: String(order.lamports) }) }
    const prepared = await ctx.solana.prepare(intent), id = randomUUID()
    await ctx.db.transaction().execute(async tx => {
      const locked = await tx.updateTable(orders).set({ active_attempt_id: id, revision: Number(order.revision) + 1, updated_at: new Date() }).where('id', '=', orderId).where('revision', '=', order.revision).where('status', '=', 'AWAITING_PAYMENT').where('expires_at', '>', new Date()).executeTakeFirstOrThrow()
      if (locked.numUpdatedRows !== 1n) fail('ORDER_CHANGED')
      if (old) {
        const expired = await tx.updateTable(attempts).set({ status: 'EXPIRED', updated_at: new Date() }).where('id', '=', old.id).where('status', 'in', ['PREPARED', 'FAILED', 'EXPIRED']).executeTakeFirstOrThrow()
        if (expired.numUpdatedRows !== 1n) fail('PAYMENT_PENDING')
      }
      await tx.insertInto(attempts).values({ id, order_id: orderId, prepared_json: JSON.stringify(prepared), signed_transaction: null, signature: null, network: 'mainnet', status: 'PREPARED', slot: null, checks: 0, next_check_at: new Date(), created_at: new Date(), updated_at: new Date() }).execute()
    })
    return { attemptId: id, prepared }
  }
  const submit = async (inv: PluginInvocation) => {
    const input = orderInput.extend({ attemptId: z.string().uuid(), signedTransaction: z.string().max(1700) }).strict().parse(inv.input)
    const order = await owned(input.orderId, inv.actor)
    const attempt = await ctx.db.selectFrom(attempts).selectAll().where('id', '=', input.attemptId).where('order_id', '=', order.id).executeTakeFirst()
    if (!attempt || order.active_attempt_id !== attempt.id) fail('ATTEMPT_NOT_FOUND', 404)
    const prepared = preparedOf(attempt!), checked = await ctx.solana.validateSigned({ prepared, signedTransaction: input.signedTransaction })
    if (attempt!.signature) { if (attempt!.signature !== checked.signature) fail('IDEMPOTENCY_CONFLICT'); return snapshot(order) }
    await ctx.db.transaction().execute(async tx => {
      const changed = await tx.updateTable(orders).set({ status: 'CONFIRMING', revision: Number(order.revision) + 1, updated_at: new Date() }).where('id', '=', order.id).where('revision', '=', order.revision).where('status', '=', 'AWAITING_PAYMENT').where('expires_at', '>', new Date()).executeTakeFirstOrThrow()
      if (changed.numUpdatedRows !== 1n) fail('ORDER_NOT_PAYABLE')
      const saved = await tx.updateTable(attempts).set({ signature: checked.signature, signed_transaction: input.signedTransaction, status: 'PENDING', updated_at: new Date(), next_check_at: new Date() }).where('id', '=', attempt!.id).where('status', '=', 'PREPARED').executeTakeFirstOrThrow()
      if (saved.numUpdatedRows !== 1n) fail('ORDER_CHANGED')
    })
    try { await ctx.solana.broadcast({ prepared, signedTransaction: input.signedTransaction }) } catch { /* Signature is durable; never undo acceptance after a broadcast error. */ }
    return snapshot(await owned(input.orderId, inv.actor))
  }
  const settle = async (attempt: Row) => {
    const order = await ctx.db.selectFrom(orders).selectAll().where('id', '=', attempt.order_id).executeTakeFirst()
    if (!order || order.status === 'PAID' || !attempt.signature) return
    const prepared = preparedOf(attempt)
    const observation = await ctx.solana.observe({ prepared, signature: String(attempt.signature) })
    if (observation.status === 'FINALIZED') {
      await ctx.db.updateTable(attempts).set({ status: 'CHAIN_CONFIRMED', slot: String(observation.slot), updated_at: new Date() }).where('id', '=', attempt.id).where('status', '!=', 'SETTLED').execute()
      try {
        await ctx.db.transaction().execute(async tx => {
          const changed = await tx.updateTable(orders).set({ status: 'PAID', reason: null, updated_at: new Date() }).where('id', '=', order.id).where('status', 'in', ['CONFIRMING', 'NEEDS_REVIEW']).executeTakeFirstOrThrow()
          if (changed.numUpdatedRows !== 1n) return
          if (!order.user_id) fail('ACCOUNT_UNAVAILABLE')
          await ctx.points.credit({ userId: Number(order.user_id), amount: Number(order.points), sourceKey: `order:${order.id}`, referenceId: String(order.id), description: `${assetOf(order)} purchase / ${order.id}` }, tx)
          await tx.updateTable(attempts).set({ status: 'SETTLED', updated_at: new Date() }).where('id', '=', attempt.id).execute()
        })
      } catch {
        await ctx.db.updateTable(orders).set({ status: 'NEEDS_REVIEW', reason: 'CREDIT_PENDING', updated_at: new Date() }).where('id', '=', order.id).where('status', '!=', 'PAID').execute()
      }
      return
    }
    if (observation.status === 'FAILED') {
      await ctx.db.transaction().execute(async tx => {
        await tx.updateTable(attempts).set({ status: 'FAILED', updated_at: new Date() }).where('id', '=', attempt.id).where('status', 'in', ['PENDING', 'REVIEW']).execute()
        await tx.updateTable(orders).set({ status: date(order.expires_at) > Date.now() ? 'AWAITING_PAYMENT' : 'FAILED', reason: 'CHAIN_TRANSACTION_FAILED', updated_at: new Date() }).where('id', '=', order.id).where('status', 'in', ['CONFIRMING', 'NEEDS_REVIEW']).execute()
      }); return
    }
    if (Number(attempt.checks) < 3 && attempt.signed_transaction) { try { await ctx.solana.broadcast({ prepared, signedTransaction: String(attempt.signed_transaction) }) } catch { /* Same signature only; an RPC error is not a payment failure. */ } }
  }
  const check = async (attempt: Row) => {
    if (!['PENDING', 'REVIEW', 'CHAIN_CONFIRMED'].includes(String(attempt.status))) return
    // Claim a short durable lease so concurrent page requests and jobs do not hammer RPC.
    const now = new Date(), count = Number(attempt.checks) + 1
    const claimed = await ctx.db.updateTable(attempts).set({ checks: count, next_check_at: new Date(now.getTime() + 60_000), updated_at: now }).where('id', '=', attempt.id).where('checks', '=', attempt.checks).where('next_check_at', '<=', now).executeTakeFirstOrThrow()
    if (claimed.numUpdatedRows !== 1n) return
    try { await settle(attempt) } catch { /* A later lease retries durable intent without re-pricing. */ }
    if (count >= 30) {
      await ctx.db.updateTable(attempts).set({ status: 'REVIEW', next_check_at: new Date(Date.now() + 300_000) }).where('id', '=', attempt.id).where('status', '=', 'PENDING').execute()
      await ctx.db.updateTable(orders).set({ status: 'NEEDS_REVIEW', reason: 'CONFIRMATION_DELAYED' }).where('id', '=', attempt.order_id).where('status', '=', 'CONFIRMING').execute()
    }
  }
  const reconcile = async (inv: PluginInvocation, admin = false) => {
    const { orderId } = orderInput.strict().parse(inv.input), order = await owned(orderId, inv.actor, admin)
    if (order.active_attempt_id) { const attempt = await ctx.db.selectFrom(attempts).selectAll().where('id', '=', order.active_attempt_id).executeTakeFirst(); if (attempt) await check(attempt) }
    return snapshot(await owned(orderId, inv.actor, admin))
  }
  const list = async (inv: PluginInvocation, admin = false) => {
    if (!inv.actor || (admin && inv.actor.role !== 'ADMIN')) fail('UNAUTHORIZED', 403)
    const input = z.object({ page: z.coerce.number().int().min(1).max(100000).default(1), status: z.enum(['AWAITING_PAYMENT','CONFIRMING','PAID','FAILED','NEEDS_REVIEW','EXPIRED']).optional(), userId: z.coerce.number().int().positive().optional(), orderId: z.string().uuid().optional(), signature: z.string().max(88).optional() }).parse(inv.query ?? {})
    let query = ctx.db.selectFrom(orders)
    if (!admin) query = query.where('user_id', '=', inv.actor!.userId)
    else if (input.userId) query = query.where('user_id', '=', input.userId)
    if (input.status === 'EXPIRED') query = query.where('status', '=', 'AWAITING_PAYMENT').where('expires_at', '<=', new Date())
    else if (input.status) { query = query.where('status', '=', input.status); if (input.status === 'AWAITING_PAYMENT') query = query.where('expires_at', '>', new Date()) }
    if (input.orderId) query = query.where('id', '=', input.orderId)
    if (input.signature) { const found = await ctx.db.selectFrom(attempts).select('order_id').where('signature', '=', input.signature).executeTakeFirst(); if (!found) return { list: [], total: 0 }; query = query.where('id', '=', found.order_id) }
    const [rows, total] = await Promise.all([query.selectAll().orderBy('created_at','desc').orderBy('id','desc').offset((input.page-1)*20).limit(20).execute(), query.select(eb => eb.fn.countAll().as('n')).executeTakeFirstOrThrow()])
    return { list: await Promise.all(rows.map(snapshot)), total: Number(total.n) }
  }
  const api: NonNullable<PluginServer['api']> = { options: async () => config(), create, prepare, submit, list, detail: async inv => snapshot(await owned(z.string().uuid().parse(inv.query?.orderId), inv.actor)), reconcile, 'admin-list': inv => list(inv,true), 'admin-reconcile': inv => reconcile(inv,true) }
  return { api: Object.fromEntries(Object.entries(api).map(([key, handler]) => [key, async (inv: PluginInvocation) => {
    try { return await handler(inv) } catch (error) { if (error instanceof z.ZodError) fail('INVALID_REQUEST', 400); throw error }
  }])),
    jobs: { reconcile: async () => { const due = await ctx.db.selectFrom(attempts).selectAll().where('status','in',['PENDING','REVIEW','CHAIN_CONFIRMED']).where('next_check_at','<=',new Date()).orderBy('next_check_at','asc').limit(3).execute(); await Promise.all(due.map(check)) } },
    migrations: { initial: async () => {}, usdt_payments: async () => {
      for (const [column, type] of [['payment_asset', 'varchar(8)'], ['token_amount', 'varchar(32)']] as const) {
        if (!await ctx.schema.hasColumn('orders', column)) await ctx.db.schema.alterTable(orders).addColumn(column, type).execute()
      }
    } },
  }
})
