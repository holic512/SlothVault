/**
 * @file tag-colors.ts
 * @project SlothVault
 * @module Tag Presentation Contract
 * @description Shares readable tag palettes, business-state colors, and stable content-tag classification.
 * @logic Keep status colors independent of the application accent, map business states explicitly, and hash case-sensitive tag names into a fixed category palette.
 * @dependencies app-theme, commission-workflow, file-business-types, backup contracts
 * @index_tags tags,theme,status,classification,accessibility
 * @author holic512
 */
import type { WorkflowStage, WorkflowSummary } from '@/lib/commission-workflow'
import type { BusinessType } from '@/lib/file-business-types'
import type { AppTheme } from '@/theme/app-theme'
import type { BackupJob, BackupKind } from '@/types/backup'

export type StatusTagColor = 'success' | 'processing' | 'warning' | 'error' | 'default'
export const contentTagColors = ['blue', 'cyan', 'purple', 'magenta', 'geekblue'] as const
export type ContentTagColor = (typeof contentTagColors)[number]
export type TagColor = StatusTagColor | ContentTagColor

export const tagPalettes = {
  light: {
    success: '#166534', processing: '#1d4ed8', warning: '#8a5700', error: '#b42318',
    blue: '#1d4ed8', cyan: '#0e7490', purple: '#6d28d9', magenta: '#a21caf', geekblue: '#4338ca',
  },
  dark: {
    success: '#72d98b', processing: '#93c5fd', warning: '#f3c367', error: '#ff9b95',
    blue: '#93c5fd', cyan: '#67e8f9', purple: '#c4b5fd', magenta: '#f0abfc', geekblue: '#a5b4fc',
  },
} as const satisfies Record<AppTheme, Record<Exclude<TagColor, 'default'>, string>>

export function getContentTagColor(name: string): ContentTagColor {
  const normalized = name.trim()
  let hash = 2166136261
  for (let index = 0; index < normalized.length; index += 1) {
    hash = Math.imul(hash ^ normalized.charCodeAt(index), 16777619)
  }
  return contentTagColors[(hash >>> 0) % contentTagColors.length]
}

export const accessTagColors = {
  PUBLIC: 'cyan', LOGIN: 'blue', MEMBERSHIPS: 'purple', FOLLOW_READ: 'geekblue', DISABLED: 'warning',
} as const

export const fileTagColors = {
  SystemLogo: 'geekblue', SystemFavicon: 'geekblue', ProjectAvatar: 'purple', UserAvatar: 'purple',
  ArticleCover: 'magenta', ArticleImage: 'magenta', NoteImage: 'magenta',
  ArticleAttachment: 'cyan', NoteAttachment: 'cyan', HomeworkFile: 'cyan',
  ContractAttachment: 'cyan', CommissionAttachment: 'cyan', Markdown: 'blue',
  TempFile: 'default', Other: 'default',
} as const satisfies Record<BusinessType, TagColor>

export const backupKindTagColors = {
  manual: 'blue', scheduled: 'cyan', protect: 'purple', imported: 'geekblue',
} as const satisfies Record<BackupKind, ContentTagColor>

export const backupStatusTagColors = {
  queued: 'warning', running: 'processing', succeeded: 'success', failed: 'error', interrupted: 'warning',
} as const satisfies Record<BackupJob['status'], StatusTagColor>

const workflowStageTagColors = {
  DRAFT: 'warning', REQUESTED: 'warning', ACCEPTED: 'processing', CONTRACT_PENDING: 'warning',
  READY: 'warning', IN_PROGRESS: 'processing', MAINTENANCE: 'processing', COMPLETED: 'success', TERMINATED: 'error',
} as const satisfies Record<WorkflowStage, StatusTagColor>

export function getWorkflowTagColor(workflow: Pick<WorkflowSummary, 'stage' | 'archived' | 'paused'>): StatusTagColor {
  if (workflow.archived) return 'default'
  if (workflow.paused) return 'warning'
  return workflowStageTagColors[workflow.stage] ?? 'default'
}

export const agreementTagColors: Readonly<Record<string, StatusTagColor>> = {
  DRAFT: 'warning', PENDING: 'warning', CONFIRMED: 'success', DECLINED: 'error', SUPERSEDED: 'default',
}
export const issueTagColors: Readonly<Record<string, StatusTagColor>> = {
  OPEN: 'warning', RESOLVED: 'processing', CLOSED: 'success',
}
export const evidenceProofTagColors: Readonly<Record<string, StatusTagColor>> = {
  PREPARED: 'warning', SUBMITTED: 'processing', FINALIZED: 'success', FAILED: 'error', CANCELLED: 'default',
}
