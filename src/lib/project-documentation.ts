/**
 * @file project-documentation.ts
 * @project SlothVault
 * @module Project Documentation Contracts
 * @description Defines version-local source baselines, stable document bindings, and bounded draft batch inputs.
 * @logic Validate portable metadata, distinguish confirmed and pending baselines, and remap cloned or restored entity IDs.
 * @dependencies zod, note-tags, document-content
 * @index_tags documentation,baseline,batch,revision,clone,backup
 * @author holic512
 */
import { z } from 'zod'
import { noteTagsSchema } from './note-tags'
import { DOCUMENT_CONTENT_MAX_CHARACTERS } from './document-content'

export const DOCUMENTATION_BATCH_LIMIT = 20
export const DOCUMENTATION_BODY_MAX_BYTES = 512 * 1024
export const documentationIdSchema = z.string().regex(/^\d+$/).refine(value => Number(value) >= 1 && Number(value) <= 2147483647)
export const documentationKeySchema = z.string().regex(/^[a-zA-Z0-9][a-zA-Z0-9_./:-]{0,119}$/)
const sourcePathSchema = z
  .string()
  .min(1)
  .max(256)
  .refine(value => !value.startsWith('/') && !value.includes('\\') && !value.split('/').includes('..') &&
    !value.includes('\0'))
export const sourceBaselineSchema = z.strictObject({
  repositoryIdentity: z
    .string()
    .min(1)
    .max(256)
    .refine(
      value => !/[\s@?#]|:\/\//.test(value),
      'Use a sanitized repository identity, not a URL or credential.'
    ),
  version: z.string().trim().min(1).max(64),
  commit: z.string().regex(/^(?:[0-9a-f]{40}|[0-9a-f]{64})$/),
  packageVersions: z.record(sourcePathSchema, z.string().min(1).max(64)).refine(value => Object.keys(value).length <= 200).default({}),
})
const documentKindSchema = z.enum(['overview', 'tutorial', 'reference', 'troubleshooting', 'changelog'])
const categoryBindingSchema = z.strictObject({ key: documentationKeySchema, categoryId: documentationIdSchema })
const documentBindingSchema = z.strictObject({
  key: documentationKeySchema, noteId: documentationIdSchema, kind: documentKindSchema.default('reference'),
  sourcePaths: z.array(sourcePathSchema).max(100).default([]), sourceNotes: z.string().max(1000).optional(),
  lastContentRevision: z.number().int().nonnegative(),
})
const keysSchema = z.array(documentationKeySchema).max(5000).refine(keys => new Set(keys).size === keys.length)
export const documentationStateSchema = z.strictObject({
  schemaVersion: z.literal(1), sourceBaseline: sourceBaselineSchema.nullable(),
  clonedFromVersionId: documentationIdSchema.nullable(),
  categories: z.array(categoryBindingSchema).max(5000), documents: z.array(documentBindingSchema).max(5000),
  pending: z.strictObject({
    targetBaseline: sourceBaselineSchema,
    plannedDocumentKeys: keysSchema,
    completedDocumentKeys: keysSchema,
  }).nullable(),
}).superRefine((state, ctx) => {
  for (const entries of [state.categories, state.documents]) {
    if (new Set(entries.map(item => item.key)).size !== entries.length) {
      ctx.addIssue({ code: 'custom', message: 'Duplicate documentation keys.' })
    }
  }
  if (new Set(state.categories.map(item => item.categoryId)).size !== state.categories.length ||
    new Set(state.documents.map(item => item.noteId)).size !== state.documents.length) {
    ctx.addIssue({ code: 'custom', message: 'Duplicate entity bindings.' })
  }
  if (state.pending?.completedDocumentKeys.some(key => !state.pending!.plannedDocumentKeys.includes(key))) {
    ctx.addIssue({ code: 'custom', message: 'Completed key was not planned.' })
  }
})
const integerSchema = z.number().int().min(-2147483648).max(2147483647)
const statusSchema = z.union([z.literal(0), z.literal(1)])
export const documentationChangeSchema = z.discriminatedUnion('type', [
  z.strictObject({
    type: z.literal('category'), key: documentationKeySchema, categoryId: documentationIdSchema.optional(),
    categoryName: z.string().trim().min(1).max(64).optional(), weight: integerSchema.optional(), status: statusSchema.optional(),
  }),
  z.strictObject({
    type: z.literal('note'), key: documentationKeySchema, noteId: documentationIdSchema.optional(), categoryKey: documentationKeySchema.optional(),
    noteTitle: z.string().trim().min(1).max(255).optional(), tags: noteTagsSchema.optional(), weight: integerSchema.optional(), status: statusSchema.optional(),
    content: z.string().max(DOCUMENT_CONTENT_MAX_CHARACTERS).optional(), versionNote: z.string().trim().max(255).nullable().optional(),
    kind: documentKindSchema.optional(), sourcePaths: z.array(sourcePathSchema).max(100).optional(), sourceNotes: z.string().max(1000).optional(),
  }),
])
export const applyDocumentationDraftSchema = z.strictObject({
  projectVersionId: documentationIdSchema, expectedRevision: z.number().int().nonnegative(),
  changes: z.array(documentationChangeSchema).max(DOCUMENTATION_BATCH_LIMIT),
  targetBaseline: sourceBaselineSchema.optional(), plannedDocumentKeys: keysSchema.optional(), finalize: z.boolean().default(false),
}).superRefine((input, ctx) => {
  if ((input.targetBaseline === undefined) !== (input.plannedDocumentKeys === undefined)) {
    ctx.addIssue({ code: 'custom', message: 'Provide targetBaseline and plannedDocumentKeys together.' })
  }
  if (new Set(input.changes.map(item => item.type + ':' + item.key)).size !== input.changes.length) {
    ctx.addIssue({ code: 'custom', message: 'Duplicate batch keys.' })
  }
})

export type DocumentationState = z.infer<typeof documentationStateSchema>

export type SourceBaseline = z.infer<typeof sourceBaselineSchema>

export type DocumentationChange = z.infer<typeof documentationChangeSchema>

export type ApplyDocumentationDraft = z.infer<typeof applyDocumentationDraftSchema>

export function emptyDocumentationState(): DocumentationState {
  return {
    schemaVersion: 1,
    sourceBaseline: null,
    clonedFromVersionId: null,
    categories: [],
    documents: [],
    pending: null,
  }
}

export function readDocumentationState(raw: string | null | undefined): DocumentationState {
  return raw == null ? emptyDocumentationState() : documentationStateSchema.parse(JSON.parse(raw))
}

/**
 * 将文档绑定迁移到克隆或恢复后的实体，移除未保留的绑定并重置正文修订号。
 * @param categories 分类旧 id 到新 id 的映射，未出现在映射中的分类绑定会被丢弃。
 * @param notes 文档旧 id 到新 id 的映射，同时用于裁剪已完成的同步计划。
 * @param versions 恢复时用于映射已有克隆来源版本；未提供时无法保留旧的来源引用。
 * @param clonedFrom 克隆时直接指定的来源版本，优先于 versions 映射。
 */
export function remapDocumentationState(
  raw: string | null | undefined,
  categories: Map<number, number>,
  notes: Map<number, number>,
  versions?: Map<number, number>,
  clonedFrom?: number
): string | null {
  if (raw == null) return null
  const state = readDocumentationState(raw)
  state.categories = state.categories
    .filter(item => categories.has(Number(item.categoryId)))
    .map(item => ({ ...item, categoryId: String(categories.get(Number(item.categoryId))) }))
  state.documents = state.documents
    .filter(item => notes.has(Number(item.noteId)))
    .map(item => ({
      ...item,
      noteId: String(notes.get(Number(item.noteId))),
      lastContentRevision: 0,
    }))
  const surviving = new Set(state.documents.map(item => item.key))
  if (state.pending) {
    state.pending.completedDocumentKeys = state.pending.completedDocumentKeys.filter(key => surviving.has(key))
  }
  state.clonedFromVersionId = clonedFrom !== undefined
    ? String(clonedFrom)
    : state.clonedFromVersionId && versions?.has(Number(state.clonedFromVersionId))
      ? String(versions.get(Number(state.clonedFromVersionId)))
      : null
  return JSON.stringify(state)
}

/**
 * 仅在代码围栏和 HTML 注释之外的 Markdown 标题中检查完整版本号。
 * @param version 可带数字版本前的 v 前缀；普通正文或示例中的提及不算更新日志记录。
 */
export function changelogContainsVersion(content: string, version: string): boolean {
  const normalized = version.replace(/^v(?=\d)/, '')
  const escaped = normalized.replace(/[.*+?^${}()|[\]\\]/g, '\\$&')
  const token = new RegExp(`^${/^\d/.test(normalized) ? 'v?' : ''}${escaped}(?=$|[\\s（(:：])`)
  let fence: { character: string; length: number } | null = null
  let comment = false
  for (let line of content.split(/\r?\n/)) {
    if (fence) {
      if (new RegExp(`^ {0,3}${fence.character}{${fence.length},}\\s*$`).test(line)) fence = null
      continue
    }
    const marker = /^ {0,3}(`{3,}|~{3,})/.exec(line)
    if (marker) {
      fence = { character: marker[1][0], length: marker[1].length }
      continue
    }
    if (comment) {
      const end = line.indexOf('-->')
      if (end < 0) continue
      line = line.slice(end + 3)
      comment = false
    }
    const begin = line.indexOf('<!--')
    if (begin >= 0) {
      comment = line.indexOf('-->', begin) < 0
      line = line.slice(0, begin)
    }
    const heading = /^ {0,3}#{1,6}[ \t]+(.*)$/.exec(line)
    if (heading && token.test(heading[1].trim().replace(/^\[([^\]]+)\]\([^)]*\)/, '$1'))) return true
  }
  return false
}

/**
 * 将同一项目源版本的站内相对文档链接指向目标预览版本，保留代码示例和未映射链接。
 * @param sourceId 被克隆的源版本 id，只有匹配该版本的链接才会改写。
 * @param targetId 目标版本 id，改写后使用 preview/project 路径。
 * @param noteIds 文档旧 id 到新 id 的映射，不包含的文档链接保持原样。
 */
export function remapDocumentationLinks(
  content: string,
  projectId: number,
  sourceId: number,
  targetId: number,
  noteIds: Map<number, number>
): string {
  const link = new RegExp(`(\\]\\(\\/(?:preview\\/)?project\\/${projectId}\\/v\\/${sourceId}\\/docs\\/)([0-9]+)(?=[?#)\\s])`, 'g')
  const rewrite = (value: string) => value.replace(link, (match, lead: string, noteId: string) => noteIds.has(Number(noteId))
    ? `${lead.replace(`/v/${sourceId}/docs/`, `/v/${targetId}/docs/`).replace(/(?<!preview)\/project\//, '/preview/project/')}${noteIds.get(Number(noteId))}` : match)
  let fence: { character: string; length: number } | null = null
  return content
    .split('\n')
    .map(line => {
      if (fence) {
        if (new RegExp(`^ {0,3}${fence.character}{${fence.length},}\\s*$`).test(line)) fence = null
        return line
      }
      const marker = /^ {0,3}(`{3,}|~{3,})/.exec(line)
      if (marker) {
        fence = { character: marker[1][0], length: marker[1].length }
        return line
      }
      if (/^(?: {4}|\t)/.test(line)) return line
      return line.split(/(`+[^`]*`+)/g).map(part => part.startsWith('`') ? part : rewrite(part)).join('')
    })
    .join('\n')
}
