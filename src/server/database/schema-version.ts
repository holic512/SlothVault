/**
 * @file schema-version.ts
 * @project SlothVault
 * @module Database Schema Version
 * @description Defines the single application schema revision expected by installers, startup migrations, and health checks.
 * @logic Keep version comparison constants in one dependency-free server module so migration completion and runtime readiness cannot drift.
 * @dependencies none
 * @index_tags database,migration,schema,revision
 * @author holic512
 */
import 'server-only'

export const CURRENT_SCHEMA_REVISION = 6
export const INSTALLATION_ROW_ID = 1
