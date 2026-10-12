/**
 * @file backup.ts
 * @project SlothVault
 * @module Backup API Contracts
 * @description Shares portable backup metadata, settings, and task states with the administration UI.
 * @logic Describe generated and imported snapshots, data-version compatibility, durable tasks, and administrator-bound restore previews.
 * @dependencies none
 * @index_tags backup,api,types,scheduler,restore
 * @author holic512
 */
export type BackupSettings = { enabled: boolean; dailyTime: string; timeZone: string; retentionCount: number }
export type BackupGenerationKind = 'manual' | 'scheduled' | 'protect'
export type BackupKind = BackupGenerationKind | 'imported'
export type BackupPhase = 'queued' | 'copying' | 'compressing' | 'validating' | 'protecting' | 'restoring' | 'cleaning' | 'complete'
export type BackupProgress = { processedFiles: number; processedRecords: number; processedBytes: number; totalFiles?: number; totalBytes?: number }
export type BackupJob = {
  id: string
  kind: BackupGenerationKind | 'import' | 'restore' | 'preview'
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
  progress?: BackupProgress
  preview?: RestorePreview
}
export type BackupFile = { path: string; size: number; sha256: string }
export type BackupEntryDigest = { size: number; sha256: string }
export type BackupManifest = {
  formatVersion: 2
  id: string
  createdAt: string
  appVersion: string
  databaseVersion: string
  counts: Record<string, number>
  database: Record<string, BackupEntryDigest>
  filesIndex: BackupEntryDigest
  fileCount: number
  entryCount: number
  totalFileBytes: number
}
export type BackupCompatibility = {
  status: 'current' | 'convertible' | 'unsupported'
  sourceVersion: string
  targetVersion: string
  reason: 'format' | 'data-version' | null
}
export type BackupSnapshot = { id: string; kind: BackupKind; createdAt: string; importedAt?: string; fileName?: string; size: number; sha256: string; manifest: BackupManifest; warnings?: string[] }
export type BackupSnapshotSummary = Omit<BackupSnapshot, 'manifest'> & {
  restorable: boolean
  compatibility: BackupCompatibility
  manifest: BackupManifest | { formatVersion: number; databaseVersion: string; counts: Record<string, number>; fileCount: number }
}
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
export type BackupUpload = { importId: string; size: number; offset: number; chunkSize: number; fingerprint: string; fileName: string; lastModified: number; expiresAt: string; state: 'uploading' | 'uploaded'; importJobId?: string; snapshotId?: string }
