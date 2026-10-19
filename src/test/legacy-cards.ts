/** Historical SQLite fixture access only; never imported by application code. */
import { executePluginSql, placeholder, quoteIdentifier, tableExists, type PluginTransaction } from '@/server/plugins/database'
const names = { giftCards: 'points_gift_card', giftCardBatches: 'points_gift_card_batch' } as const
const snake = (key: string) => key.replace(/[A-Z]/g, letter => '_' + letter.toLowerCase())
const camel = (key: string) => key.replace(/_([a-z])/g, (_, letter: string) => letter.toUpperCase())
export async function legacyCardRows(tx: PluginTransaction, key: keyof typeof names, after: number, take = 100) {
  const name = names[key]
  if (!await tableExists(name, tx)) return []
  const rows = await tx.$queryRawUnsafe<Record<string, unknown>[]>(`SELECT * FROM ${quoteIdentifier(name)} WHERE id > ${placeholder(1)} ORDER BY id ASC LIMIT ${take}`, after)
  return rows.map(row => Object.fromEntries(Object.entries(row).map(([name, value]) => [camel(name), value == null ? null : name.endsWith('_at') ? new Date(String(value)) : typeof value === 'bigint' ? Number(value) : value])))
}
export async function insertLegacyCard(tx: PluginTransaction, key: keyof typeof names, data: Record<string, unknown>) {
  const columns = Object.keys(data)
  const result = await executePluginSql(tx, { sql: `INSERT INTO ${quoteIdentifier(names[key])} (${columns.map(column => quoteIdentifier(snake(column))).join(',')}) VALUES (${columns.map((_, i) => placeholder(i + 1)).join(',')})${placeholder(1) === '$1' ? ' RETURNING id' : ''}`, parameters: Object.values(data), kind: 'InsertQueryNode' })
  return { id: Number(result.rows[0]?.id ?? ('insertId' in result ? result.insertId : undefined)) }
}
