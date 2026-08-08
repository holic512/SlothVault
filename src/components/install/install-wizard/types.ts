/**
 * @file types.ts
 * @project SlothVault
 * @module First-run Installation
 * @description Defines the installation workflow states, form values, database configuration, and translation contract.
 * @logic Provide type-only boundaries shared by the installation orchestrator, helpers, shell, and stages.
 * @dependencies next-intl
 * @index_tags install,types,database,status,forms
 * @author holic512
 */
import type { useTranslations } from 'next-intl'

export type DatabaseProvider = 'sqlite' | 'mysql' | 'postgresql'

export type InstallationStatus =
  | 'UNCONFIGURED'
  | 'CONFIGURING'
  | 'SCHEMA_READY'
  | 'INSTALLED'
  | 'MAINTENANCE'

export type InstallStatusResponse = {
  status: InstallationStatus
  provider?: DatabaseProvider | null
  message?: string | null
  error?: string | null
}

export type ConnectionValues = {
  host?: string
  port?: number
  database?: string
  username?: string
  password?: string
  tlsEnabled?: boolean
  caPem?: string
}

export type AdminValues = {
  username: string
  password: string
  confirmPassword: string
}

export type DatabaseConfig = Record<string, string | number | boolean>
export type ConnectionDraft = { provider: DatabaseProvider; config: DatabaseConfig }
export type PendingAction = 'status' | 'test' | 'initialize' | 'admin' | 'reset' | null
export type Translation = ReturnType<typeof useTranslations<'Install'>>
