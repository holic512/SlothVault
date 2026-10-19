/**
 * @file user-attribution.ts
 * @project SlothVault
 * @module Plugin User Attribution
 * @description Preserves declared user snapshots without coupling core users to a particular plugin.
 * @logic Walk only registered tables and detach declared attribution references before account deletion.
 * @dependencies plugin table descriptors, host database transaction
 * @index_tags plugins,users,attribution
 * @author holic512
 */
import 'server-only'
import { tableSchema } from '@slothvault/plugin-sdk/protocol'
import { placeholder, quoteIdentifier, type PluginTransaction } from './database'
export async function pluginUserAttribution(tx: PluginTransaction, userId?: number, identity?: Record<string, unknown>) {
  const tables = (await tx.pluginOwnedTable.findMany()).map(t => ({ name: t.name, descriptor: tableSchema.parse(JSON.parse(t.descriptorJson)) }))
  for (const table of tables) for (const col of table.descriptor.columns) {
    if (col.references?.coreCollection !== 'users' || !col.references.attributionField || !table.descriptor.columns.some(c => c.name === 'attribution_json')) continue
    const primary = table.descriptor.columns.find(c => c.primary)!.name
    const rows = await tx.$queryRawUnsafe<Record<string, unknown>[]>(`SELECT ${quoteIdentifier(primary)} AS pk, ${quoteIdentifier(col.name)} AS uid, attribution_json FROM ${quoteIdentifier(table.name)} WHERE ${quoteIdentifier(col.name)} IS NOT NULL${userId ? ` AND ${quoteIdentifier(col.name)} = ${placeholder(1)}` : ''}`, ...(userId ? [userId] : []))
    for (const row of rows) {
      const values = JSON.parse(String(row.attribution_json || '{}'))
      let snapshot = identity
      if (!snapshot) {
        const user = await tx.user.findUnique({ where: { id: Number(row.uid) }, select: { id: true, username: true, displayName: true, role: true } })
        if (!user) continue
        const site = await tx.systemInstallation.findUnique({ where: { id: 1 }, select: { installationId: true } })
        snapshot = { userId: String(user.id), username: user.username, displayName: user.displayName, role: user.role, installationId: site?.installationId ?? null }
      }
      values[col.references.attributionField] ??= snapshot
      await tx.$executeRawUnsafe(`UPDATE ${quoteIdentifier(table.name)} SET attribution_json = ${placeholder(1)}${userId ? `, ${quoteIdentifier(col.name)} = NULL` : ''} WHERE ${quoteIdentifier(primary)} = ${placeholder(2)}`, JSON.stringify(values), row.pk)
    }
  }
}
