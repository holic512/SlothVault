/**
 * @file legacy-business-preflight.ts
 * @project SlothVault
 * @module Database Retirement Safety
 * @description Clears explicitly retired host contract/commission data before schema deployment.
 * @logic Discover existing allowlisted tables, delete child rows before parents in one transaction, and leave the original guarded migrations to drop the empty tables; failures roll back cleanup and abort deployment.
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

type Client = Pick<AppPrismaClient, '$queryRawUnsafe' | '$transaction'>

export async function clearRetiredHostTables(client: Client, provider: DatabaseProvider) {
  const catalogQuery = provider === 'sqlite'
    ? "SELECT name FROM sqlite_master WHERE type = 'table'"
    : provider === 'mysql'
      ? 'SELECT TABLE_NAME AS name FROM information_schema.TABLES WHERE TABLE_SCHEMA = DATABASE()'
      : 'SELECT tablename AS name FROM pg_catalog.pg_tables WHERE schemaname = current_schema()'
  const existing = new Set((await client.$queryRawUnsafe<Array<{ name: string }>>(catalogQuery)).map(row => row.name))
  const tables = RETIRED_HOST_TABLES.filter(table => existing.has(table))
  if (!tables.length) return
  // This allowlist is ordered by foreign-key dependencies. Keep constraints enabled:
  // an unexpected external reference must roll back all deletions, never cascade.
  await client.$transaction(async tx => {
    for (const table of tables) {
      const identifier = provider === 'mysql' ? `\`${table}\`` : `"${table}"`
      await tx.$executeRawUnsafe(`DELETE FROM ${identifier}`)
    }
  }, { timeout: 120_000 })
}
