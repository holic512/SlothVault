/**
 * @file recovery-state.ts
 * @project SlothVault
 * @module Backup Recovery Gate
 * @description Blocks business traffic when coordinated recovery cannot establish a consistent state.
 * @logic Share a credential-free recovery error without importing the backup runtime into request locks.
 * @dependencies process global object
 * @index_tags backup,recovery,maintenance,gate
 * @author holic512
 */
import 'server-only'
const state = globalThis as unknown as { slothVaultBackupRecoveryError?: string }
export function backupRecoveryError() { return state.slothVaultBackupRecoveryError ?? null }
export function setBackupRecoveryError(error: string | null) { state.slothVaultBackupRecoveryError = error ?? undefined }
