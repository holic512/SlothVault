/**
 * @file legacy-business-preflight.ts
 * @project SlothVault
 * @module Database Retirement Safety
 * @description Refuses host schema deployment while any retired contract/commission table contains data.
 * @logic Read provider metadata and query only the fixed retired-table allowlist before any migration subprocess; missing tables are safe, query failures abort deployment, and SQL guards recheck under write locks.
 * @dependencies Database provider types, Prisma raw-query interface
 * @index_tags database,migration,preflight,data-safety,retirement
 * @author holic512
 */
import 'server-only'
import type { AppPrismaClient } from './client'
import type { DatabaseProvider } from './types'

/** Fixed names only: never accept identifiers from configuration or plugin declarations. */
export const RETIRED_HOST_TABLES = [
  'contract_admin_audit',
  'contract_credential_attempt',
  'commission_settings',
  'commission_milestone',
  'commission_payment',
  'commission_change',
  'commission_issue',
  'commission_delivery_item',
  'commission_acceptance',
  'commission_event',
  'commission_invitation',
  'commission_agreement',
  'commission_proof_attempt',
  'contract_credential',
  'commission_payment_plan',
  'commission_file',
  'commission_delivery',
  'commission_submission',
  'contract',
  'commission_contract_template_version',
  'commission',
  'commission_contract_template'
] as const

type Reader = Pick<AppPrismaClient, '$queryRawUnsafe'>

export async function assertRetiredHostTablesEmpty(client: Reader, provider: DatabaseProvider) {
  const catalogQuery = provider === 'sqlite'
    ? "SELECT name FROM sqlite_master WHERE type = 'table'"
    : provider === 'mysql'
      ? 'SELECT TABLE_NAME AS name FROM information_schema.TABLES WHERE TABLE_SCHEMA = DATABASE()'
      : 'SELECT tablename AS name FROM pg_catalog.pg_tables WHERE schemaname = current_schema()'
  const existing = new Set((await client.$queryRawUnsafe<Array<{ name: string }>>(catalogQuery)).map(row => row.name))
  const occupied: string[] = []
  for (const table of RETIRED_HOST_TABLES) {
    if (!existing.has(table)) continue
    const identifier = provider === 'mysql' ? `\`${table}\`` : `"${table}"`
    const rows = await client.$queryRawUnsafe<unknown[]>(`SELECT 1 FROM ${identifier} LIMIT 1`)
    if (rows.length) occupied.push(table)
  }
  if (occupied.length) {
    throw new Error(`Database upgrade refused: non-empty retired host tables (${occupied.join(', ')}). No migrations were started. Export and resolve these records explicitly before retrying; automatic deletion is not supported.`)
  }
}
