/**
 * @file server.ts
 * @project SlothVault
 * @module Extension SDK Example
 * @description Demonstrates a portable owned table, public API, after-commit hooks and periodic worker jobs.
 * @logic Initialize counters during migration and persist increments transactionally without touching core tables.
 * @dependencies Plugin server SDK
 * @index_tags plugins,example,hooks,jobs,database
 * @author holic512
 */
import { definePlugin, type PluginTaskContext } from '@slothvault/plugin-sdk/server'
export default definePlugin(ctx => {
  const table = ctx.table('counters'), receipts = ctx.table('deliveries')
  const increment = (id: string, task?: PluginTaskContext) => ctx.db.transaction().execute(async tx => {
    if (task) {
      if (await tx.selectFrom(receipts).selectAll().where('id', '=', task.id).executeTakeFirst()) return
      await tx.insertInto(receipts).values({ id: task.id }).execute()
    }
    const current = await tx.selectFrom(table).selectAll().where('id', '=', id).executeTakeFirst()
    if (current) await tx.updateTable(table).set({ value: Number(current.value) + 1 }).where('id', '=', id).execute()
    else await tx.insertInto(table).values({ id, value: 1 }).execute()
  })
  return {
    api: { status: async () => ({ message: ctx.config.message, counters: await ctx.db.selectFrom(table).selectAll().orderBy('id').execute() }) },
    migrations: { initial: async () => {} },
    events: { 'core.article.published': (_payload, task) => increment('articles', task), 'core.project-version.published': (_payload, task) => increment('releases', task) },
    jobs: { tick: task => increment('ticks', task) },
  }
})
