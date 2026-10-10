/**
 * @file file-business-types.ts
 * @project SlothVault
 * @module Managed File Classification
 * @description Shares upload categories and format constraints between the website, MCP, and database upgrades.
 * @logic Separate article and project-note images from downloads; normalize only legacy image metadata without moving files.
 * @dependencies none
 * @index_tags files,upload,classification,compatibility
 * @author holic512
 */
export const IMAGE_EXTENSIONS = new Set(['jpg', 'jpeg', 'png', 'gif', 'webp'])
export const SAFE_FILE_EXTENSIONS = new Set([...IMAGE_EXTENSIONS, 'pdf', 'txt', 'md', 'json', 'zip', 'docx', 'xlsx', 'pptx'])

export const BUSINESS_TYPE_CONFIG = {
  SystemLogo: { dir: 'system-logo', imagesOnly: true },
  SystemFavicon: { dir: 'system-favicon', imagesOnly: false },
  ProjectAvatar: { dir: 'project-avatar', imagesOnly: true },
  UserAvatar: { dir: 'user-avatar', imagesOnly: true },
  ArticleCover: { dir: 'article-cover', imagesOnly: true },
  ArticleImage: { dir: 'article-image', imagesOnly: true },
  ArticleAttachment: { dir: 'article-attachment', imagesOnly: false },
  NoteImage: { dir: 'note-image', imagesOnly: true },
  NoteAttachment: { dir: 'note-attachment', imagesOnly: false },
  HomeworkFile: { dir: 'homework', imagesOnly: false },
  ContractAttachment: { dir: 'contract-attachment', imagesOnly: false },
  CommissionAttachment: { dir: 'commission-attachment', imagesOnly: false },
  Markdown: { dir: 'markdown', imagesOnly: false },
  TempFile: { dir: 'temp', imagesOnly: false },
  Other: { dir: 'other', imagesOnly: false },
} as const

export type BusinessType = keyof typeof BUSINESS_TYPE_CONFIG
export const VALID_BUSINESS_TYPES = Object.keys(BUSINESS_TYPE_CONFIG) as BusinessType[]
export const MCP_CONTENT_BUSINESS_TYPES = ['ProjectAvatar', 'ArticleCover', 'ArticleImage', 'ArticleAttachment', 'NoteImage', 'NoteAttachment', 'HomeworkFile', 'Markdown', 'Other'] as const
export const ADMIN_UPLOAD_BUSINESS_TYPES = VALID_BUSINESS_TYPES.filter((type) => type !== 'ContractAttachment' && type !== 'CommissionAttachment')

export function allowedFileExtensions(type: BusinessType): ReadonlySet<string> {
  return type === 'SystemFavicon' ? new Set(['ico']) : BUSINESS_TYPE_CONFIG[type].imagesOnly ? IMAGE_EXTENSIONS : SAFE_FILE_EXTENSIONS
}

/** Only call for pre-2.12 backups or pre-revision-12 database records. */
export function normalizeLegacyFileBusinessType(type: string, fileName: string) {
  const extension = fileName.split('.').pop()?.toLowerCase() || ''
  if (!IMAGE_EXTENSIONS.has(extension)) return type
  if (type === 'ArticleAttachment') return 'ArticleImage'
  if (type === 'NoteAttachment') return 'NoteImage'
  return type
}
