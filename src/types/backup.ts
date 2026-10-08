/**
 * @file backup.ts
 * @project SlothVault
 * @module Backup API Contracts
 * @description Shares portable backup metadata, settings, and task states with the administration UI.
 * @logic Describe immutable snapshots, durable task progress, and administrator-bound restore previews.
 * @dependencies none
 * @index_tags backup,api,types,scheduler,restore
 * @author holic512
 */
export type BackupSettings = { enabled: boolean; dailyTime: string; timeZone: string; retentionCount: number }
export type BackupKind = 'manual' | 'scheduled' | 'protect'
export type BackupPhase = 'queued' | 'copying' | 'compressing' | 'validating' | 'protecting' | 'restoring' | 'cleaning' | 'complete'
export type BackupJob = {
  id: string
  kind: BackupKind | 'restore'
  status: 'queued' | 'running' | 'succeeded' | 'failed' | 'interrupted'
  phase: BackupPhase
  createdAt: string
  startedAt?: string
  finishedAt: string | null
  durationMs?: number
  actorUserId: number | null
  error: string | null
  warnings: string[]
  snapshotId?: string
  protectionId?: string
  source?: BackupSource
  previewId?: string
  retryOf?: string
}
export type BackupFile = { path: string; size: number; sha256: string }
export type BackupManifest = {
  formatVersion: 1
  id: string
  createdAt: string
  appVersion: string
  databaseVersion: string
  counts: Record<string, number>
  files: BackupFile[]
  databaseSha256: string
  filesSha256: string
}
export type BackupSnapshot = { id: string; kind: BackupKind; createdAt: string; size: number; sha256: string; manifest: BackupManifest; warnings?: string[] }
export type BackupSnapshotSummary = Omit<BackupSnapshot, 'manifest'> & { manifest: Omit<BackupManifest, 'files'> & { fileCount: number } }
export type BackupSource = { snapshotId: string; importId?: never } | { importId: string; snapshotId?: never }
export type RestorePreview = {
  id: string
  source: BackupSource
  manifest: BackupManifest
  warnings: string[]
  preservedAdministrator: string
  createdAt: string
  expiresAt: string
}
export type BackupSettingsResponse = { settings: BackupSettings; storage: { path: string; availableBytes: string | null; error: string | null }; nextRunAt: string | null }
export type BackupHistoryResponse = { snapshots: BackupSnapshotSummary[]; jobs: BackupJob[]; activeJob: BackupJob | null }
