/**
 * @file retired-gift-cards.ts
 * @project SlothVault
 * @module Retired Backup Data Conversion
 * @description Drops explicitly retired preproduction cards from old backups without touching financial ledger receipts.
 * @logic Strip fixed card collections and legacy card installation metadata before generic plugin validation.
 * @dependencies backup record store
 * @index_tags backup,compatibility,gift-cards,retirement
 * @author holic512
 */
import type { RecordStore } from './record-store'
const id = 'slothvault.gift-cards'
const retired = ['pluginInstallations', 'pluginTables', 'pluginMigrations', 'pluginRows']
export function discardRetiredCardPayload(data: Record<string, unknown>) {
  const result: Record<string, unknown> = { ...data, giftCards: [], giftCardBatches: [] }
  for (const key of retired) if (Array.isArray(result[key])) {
    result[key] = (result[key] as unknown[]).filter((row: unknown) => (row as { pluginId: string }).pluginId !== id)
  }
  return result
}
export function discardRetiredCardStore(store: RecordStore) {
  store.statement("DELETE FROM records WHERE collection IN ('giftCards','giftCardBatches')").run()
  for (const collection of retired) store.statement("DELETE FROM records WHERE collection=? AND json_extract(json,'$.pluginId')=?").run(collection, id)
}
