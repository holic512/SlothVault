/**
 * @file project-documentation.ts
 * @project SlothVault
 * @module Project Documentation Service
 * @description Owns bounded document reads and atomic, revision-protected draft synchronization.
 * @logic Return permanent UUID reading links and separate draft preview URLs, resolve version-local stable keys, and synchronize revision-protected bodies atomically.
 * @dependencies Prisma unit-of-work, project-version-release, admin-notes, project-documentation contracts
 * @index_tags documentation,mcp,batch,revision,baseline,transaction
 * @author holic512
 */
import 'server-only'
import { Buffer } from 'node:buffer'
import type { Prisma } from '@generated/prisma-postgresql/client'
import { applyDocumentationDraftSchema, changelogContainsVersion, DOCUMENTATION_BODY_MAX_BYTES, readDocumentationState, documentationStateSchema, type DocumentationChange, type DocumentationState } from '@/lib/project-documentation'
import { readNoteTags } from '@/lib/note-tags'
import { HttpError } from '@/server/http/errors'
import { prisma } from '@/server/prisma'
import { unitOfWork } from '@/server/database/unit-of-work'
import { databaseSnapshotIsolationLevel } from '@/server/database/client'
import { buildPublishableRelease, executeVersionWrite, loadReleaseTree } from './project-version-release'
import { noteContentDto, writeDraftPrimaryContent } from './admin-notes'
import { invalidatePublicProjectCache } from './public-project-cache'

const same = (left: unknown, right: unknown) => JSON.stringify(left) === JSON.stringify(right)
function fail(reason: string, status = 409): never {
  throw new HttpError(reason, status, status, { reason })
}
function stateFrom(raw: string | null | undefined) {
  try { return readDocumentationState(raw) } catch { return fail('DOCUMENTATION_STATE_INVALID') }
}
const activeParent = { isDeleted: false, category: { isDeleted: false, projectVersion: { isDeleted: false, project: { isDeleted: false } } } } as const

export async function getDocumentationOutline(projectVersionId: number, page: number, pageSize: number) {
  if (!Number.isInteger(page) || page < 1 || page > 10000 || !Number.isInteger(pageSize) || pageSize < 1 || pageSize > 50) fail('DOCUMENTATION_PAGE_INVALID', 400)
  return unitOfWork.execute(async tx => {
    const version = await tx.projectVersion.findFirst({ where: { id: projectVersionId, isDeleted: false, project: { isDeleted: false } },
      select: { id: true, publicId: true, projectId: true, project: { select: { publicId: true } }, version: true, publishedAt: true, documentRevision: true, documentationStateJson: true } })
    if (!version) fail('VERSION_NOT_FOUND', 404)
    const state = stateFrom(version.documentationStateJson)
    const where = { ...activeParent, category: { ...activeParent.category, projectVersionId } }
    const [total, notes] = await Promise.all([
      tx.noteInfo.count({ where }),
      tx.noteInfo.findMany({ where, skip: (page - 1) * pageSize, take: pageSize,
        orderBy: [{ category: { weight: 'desc' } }, { weight: 'desc' }, { id: 'asc' }],
        select: { id: true, publicId: true, noteTitle: true, categoryId: true, status: true, weight: true, tagsJson: true, contentRevision: true,
          contents: { where: { isDeleted: false, isPrimary: true }, take: 2, select: { id: true, status: true } } } }),
    ])
    const categories = await tx.category.findMany({ where: { projectVersionId, isDeleted: false },
      select: { id: true, categoryName: true, weight: true, status: true }, orderBy: [{ weight: 'desc' }, { id: 'asc' }] })
    const noteIds = new Set(notes.map(note => String(note.id)))
    return { projectVersionId: String(version.id), projectId: String(version.projectId), version: version.version,
      publishedAt: version.publishedAt, documentRevision: version.documentRevision,
      documentationState: { ...state, documents: state.documents.filter(doc => noteIds.has(doc.noteId)) },
      categories: categories.map(item => ({ ...item, id: String(item.id), key: state.categories.find(binding => binding.categoryId === String(item.id))?.key ?? null })),
      list: notes.map(note => ({ id: String(note.id), categoryId: String(note.categoryId), noteTitle: note.noteTitle, status: note.status,
        weight: note.weight, tags: readNoteTags(note.tagsJson), contentRevision: note.contentRevision,
        key: state.documents.find(doc => doc.noteId === String(note.id))?.key ?? null,
        primaryContentId: note.contents.length === 1 ? String(note.contents[0].id) : null,
        primaryContentStatus: note.contents.length === 1 ? note.contents[0].status : null,
        url: `/project/${version.project.publicId}/v/${version.publicId}/docs/${note.publicId}`,
        previewUrl: version.publishedAt ? null : `/preview/project/${version.projectId}/v/${version.id}/docs/${note.id}`,
      })), page, pageSize, total }
  }, { mode: 'read', isolationLevel: databaseSnapshotIsolationLevel() })
}

export async function getManyNoteContents(ids: number[]) {
  if (ids.length < 1 || ids.length > 20 || new Set(ids).size !== ids.length) fail('CONTENT_BATCH_INVALID', 400)
  const items = await prisma.noteContent.findMany({ where: { id: { in: ids }, isDeleted: false, noteInfo: activeParent } })
  if (items.length !== ids.length) fail('CONTENT_NOT_FOUND', 404)
  if (items.reduce((sum, item) => sum + Buffer.byteLength(item.content, 'utf8'), 0) > DOCUMENTATION_BODY_MAX_BYTES) fail('CONTENT_BUDGET_EXCEEDED', 413)
  const indexed = new Map(items.map(item => [item.id, item]))
  return { list: ids.map(id => noteContentDto(indexed.get(id)!)) }
}

export async function applyDocumentationDraft(raw: unknown, authorId: number) {
  const parsed = applyDocumentationDraftSchema.safeParse(raw)
  if (!parsed.success) fail('DOCUMENTATION_BATCH_INVALID', 400)
  const input = parsed.data
  const bodies = input.changes.filter((change): change is Extract<DocumentationChange, { type: 'note' }> => change.type === 'note')
  if (bodies.reduce((sum, change) => sum + Buffer.byteLength(change.content ?? '', 'utf8'), 0) > DOCUMENTATION_BODY_MAX_BYTES) fail('CONTENT_BUDGET_EXCEEDED', 413)
  const projectVersionId = Number(input.projectVersionId)
  const result = await executeVersionWrite(async tx => {
    const version = await tx.projectVersion.findFirst({ where: { id: projectVersionId, isDeleted: false, project: { isDeleted: false } } })
    if (!version) fail('VERSION_NOT_FOUND', 404)
    if (version.publishedAt) fail('VERSION_FROZEN')
    if (version.documentRevision !== input.expectedRevision) fail('VERSION_WRITE_CONFLICT')
    const state = stateFrom(version.documentationStateJson)
    const previousState = JSON.stringify(state)
    if (state.pending && state.pending.targetBaseline.version !== version.version) fail('SOURCE_VERSION_MISMATCH')
    if (input.targetBaseline) {
      if (input.targetBaseline.version !== version.version) fail('SOURCE_VERSION_MISMATCH')
      if (state.sourceBaseline && state.sourceBaseline.repositoryIdentity !== input.targetBaseline.repositoryIdentity) fail('SOURCE_IDENTITY_MISMATCH')
      if (state.pending && (!same(state.pending.targetBaseline, input.targetBaseline) || !same(state.pending.plannedDocumentKeys, input.plannedDocumentKeys))) fail('DOCUMENTATION_SYNC_IN_PROGRESS')
      if (!state.pending) state.pending = { targetBaseline: input.targetBaseline, plannedDocumentKeys: input.plannedDocumentKeys!, completedDocumentKeys: [] }
    }
    const categories = await tx.category.findMany({ where: { projectVersionId, isDeleted: false } })
    const categoryById = new Map(categories.map(item => [item.id, item]))
    const bindings = new Map(state.categories.map(item => [item.key, Number(item.categoryId)]))
    const noteBindings = new Map(state.documents.map(item => [item.key, Number(item.noteId)]))
    const requestedNoteIds = bodies.map(change => Number(change.noteId ?? noteBindings.get(change.key) ?? 0)).filter(Boolean)
    const notes = await tx.noteInfo.findMany({ where: { id: { in: requestedNoteIds }, isDeleted: false, category: { projectVersionId, isDeleted: false } } })
    const noteById = new Map(notes.map(item => [item.id, item]))
    // Only body edits select body text. A title-only batch never loads Markdown.
    const contentIds = bodies.filter(change => change.content !== undefined || change.versionNote !== undefined).map(change => Number(change.noteId ?? noteBindings.get(change.key) ?? 0)).filter(Boolean)
    const contents = contentIds.length ? await tx.noteContent.findMany({ where: { noteInfoId: { in: contentIds }, isPrimary: true, isDeleted: false } }) : []
    const primaryByNote = new Map(contents.map(item => [item.noteInfoId, item]))
    let hasWrites = false
    for (const change of input.changes) {
      if (change.type === 'category') {
        const known = bindings.get(change.key)
        if (known && change.categoryId && known !== Number(change.categoryId)) fail('DOCUMENTATION_BINDING_CONFLICT')
        const id = known ?? (change.categoryId ? Number(change.categoryId) : undefined)
        const current = id ? categoryById.get(id) : undefined
        if (id && !current) fail('CATEGORY_VERSION_MISMATCH')
        if (!current && !change.categoryName) fail('CATEGORY_NAME_REQUIRED', 400)
        if (!known && id && [...bindings.values()].includes(id)) fail('DOCUMENTATION_BINDING_CONFLICT')
        if (id && !known) { state.categories.push({ key: change.key, categoryId: String(id) }); bindings.set(change.key, id) }
        if (!current || ['categoryName', 'weight', 'status'].some(field => change[field as keyof typeof change] !== undefined && change[field as keyof typeof change] !== current[field as keyof typeof current])) hasWrites = true
      } else {
        const known = noteBindings.get(change.key)
        if (known && change.noteId && known !== Number(change.noteId)) fail('DOCUMENTATION_BINDING_CONFLICT')
        const id = known ?? (change.noteId ? Number(change.noteId) : undefined)
        const current = id ? noteById.get(id) : undefined
        if (id && !current) fail('NOTE_VERSION_MISMATCH')
        if (!current && (!change.noteTitle || !change.categoryKey || !change.content?.trim())) fail('NOTE_CREATE_FIELDS_REQUIRED', 400)
        if (!known && id && [...noteBindings.values()].includes(id)) fail('DOCUMENTATION_BINDING_CONFLICT')
        if (!known && current) noteBindings.set(change.key, current.id)
        if (change.categoryKey && !bindings.has(change.categoryKey) && !input.changes.some(item => item.type === 'category' && item.key === change.categoryKey)) fail('CATEGORY_KEY_NOT_FOUND')
        if (state.pending && !state.pending.plannedDocumentKeys.includes(change.key)) fail('DOCUMENTATION_KEY_NOT_PLANNED')
        const primary = id ? primaryByNote.get(id) : undefined
        if (!current || ['noteTitle', 'weight', 'status'].some(field => change[field as keyof typeof change] !== undefined && change[field as keyof typeof change] !== current[field as keyof typeof current]) ||
          (change.categoryKey && bindings.get(change.categoryKey) !== current?.categoryId) ||
          (change.tags !== undefined && !same(change.tags, readNoteTags(current?.tagsJson))) ||
          (change.content !== undefined && change.content !== primary?.content) ||
          (change.versionNote !== undefined && change.versionNote !== primary?.versionNote)) hasWrites = true
        const binding = state.documents.find(item => item.key === change.key)
        if (!binding && current) state.documents.push({ key: change.key, noteId: String(current.id), kind: change.kind ?? 'reference', sourcePaths: change.sourcePaths ?? [], ...(change.sourceNotes !== undefined ? { sourceNotes: change.sourceNotes } : {}), lastContentRevision: current.contentRevision })
        else if (binding) {
          if (current) binding.lastContentRevision = current.contentRevision
          if (change.kind !== undefined) binding.kind = change.kind
          if (change.sourcePaths !== undefined) binding.sourcePaths = change.sourcePaths
          if (change.sourceNotes !== undefined) binding.sourceNotes = change.sourceNotes
        }
        if (state.pending && !state.pending.completedDocumentKeys.includes(change.key)) state.pending.completedDocumentKeys.push(change.key)
      }
    }
    const needsWrite = hasWrites || JSON.stringify(state) !== previousState || input.finalize && state.pending !== null
    if (needsWrite) {
      const locked = await tx.projectVersion.updateMany({ where: { id: projectVersionId, isDeleted: false, publishedAt: null, documentRevision: input.expectedRevision }, data: { documentRevision: { increment: 1 }, updatedAt: new Date() } })
      if (locked.count !== 1) fail('VERSION_WRITE_CONFLICT')
    }
    const results: Array<{ type: 'category' | 'note'; key: string; categoryId: string; noteId?: string; primaryContentId?: string }> = []
    for (const change of input.changes) {
      if (change.type === 'category') {
        const id = bindings.get(change.key)
        const current = id ? categoryById.get(id) : undefined
        const data = { ...(change.categoryName !== undefined ? { categoryName: change.categoryName } : {}), ...(change.weight !== undefined ? { weight: change.weight } : {}), ...(change.status !== undefined ? { status: change.status } : {}) }
        const differs = !current || Object.entries(data).some(([field, value]) => current[field as keyof typeof current] !== value)
        const category = current ? differs ? await tx.category.update({ where: { id: current.id }, data }) : current : await tx.category.create({ data: { projectVersionId, categoryName: change.categoryName!, weight: change.weight ?? 0, status: change.status ?? 1 } })
        bindings.set(change.key, category.id); categoryById.set(category.id, category)
        if (!state.categories.some(item => item.key === change.key)) state.categories.push({ key: change.key, categoryId: String(category.id) })
        results.push({ type: 'category', key: change.key, categoryId: String(category.id) })
      } else {
        const id = noteBindings.get(change.key) ?? (change.noteId ? Number(change.noteId) : undefined)
        const current = id ? noteById.get(id) : undefined
        const categoryId = change.categoryKey ? bindings.get(change.categoryKey) : current?.categoryId
        if (!categoryId || !categoryById.has(categoryId)) fail('CATEGORY_KEY_NOT_FOUND')
        const data: Prisma.NoteInfoUncheckedUpdateInput = { categoryId,
          ...(change.noteTitle !== undefined ? { noteTitle: change.noteTitle } : {}), ...(change.tags !== undefined ? { tagsJson: JSON.stringify(change.tags) } : {}),
          ...(change.weight !== undefined ? { weight: change.weight } : {}), ...(change.status !== undefined ? { status: change.status } : {}) }
        const differs = !current || Object.entries(data).some(([field, value]) => current[field as keyof typeof current] !== value)
        const note = current ? differs ? await tx.noteInfo.update({ where: { id: current.id }, data }) : current : await tx.noteInfo.create({ data: { categoryId, authorId, noteTitle: change.noteTitle!, tagsJson: JSON.stringify(change.tags ?? []), weight: change.weight ?? 0, status: change.status ?? 1 } })
        let primaryContentId: string | undefined
        const primary = primaryByNote.get(note.id)
        if (change.content !== undefined || change.versionNote !== undefined) {
          if (change.content === undefined && !primary) fail('PRIMARY_CONTENT_NOT_FOUND')
          const written = await writeDraftPrimaryContent(tx, note.id, { content: change.content ?? primary!.content, ...(change.versionNote !== undefined ? { versionNote: change.versionNote } : {}) })
          primaryContentId = String(written.id)
        }
        const revision = primaryContentId ? (await tx.noteInfo.findUniqueOrThrow({ where: { id: note.id }, select: { contentRevision: true } })).contentRevision : note.contentRevision
        const entry: DocumentationState['documents'][number] = { key: change.key, noteId: String(note.id), kind: change.kind ?? state.documents.find(item => item.key === change.key)?.kind ?? 'reference', sourcePaths: change.sourcePaths ?? state.documents.find(item => item.key === change.key)?.sourcePaths ?? [],
          ...(change.sourceNotes !== undefined ? { sourceNotes: change.sourceNotes } : state.documents.find(item => item.key === change.key)?.sourceNotes !== undefined ? { sourceNotes: state.documents.find(item => item.key === change.key)!.sourceNotes } : {}), lastContentRevision: revision }
        const index = state.documents.findIndex(item => item.key === change.key)
        if (index < 0) state.documents.push(entry); else state.documents[index] = entry
        results.push({ type: 'note', key: change.key, categoryId: String(categoryId), noteId: String(note.id), ...(primaryContentId ? { primaryContentId } : {}) })
      }
    }
    if (input.finalize && state.pending) {
      if (state.pending.plannedDocumentKeys.some(key => !state.pending!.completedDocumentKeys.includes(key))) fail('DOCUMENTATION_SYNC_INCOMPLETE', 422)
      const source = await loadReleaseTree(tx, projectVersionId)
      if (!source) fail('VERSION_NOT_FOUND', 404)
      const checked = buildPublishableRelease({ ...source, documentationStateJson: null })
      if (checked.issues.length) throw new HttpError('Draft validation failed', 422, 422, { reason: 'RELEASE_VALIDATION_FAILED', issues: checked.issues })
      const changelogs = state.documents.filter(item => item.kind === 'changelog')
      const logs = await tx.noteInfo.findMany({ where: { id: { in: changelogs.map(item => Number(item.noteId)) }, status: 1, isDeleted: false, category: { projectVersionId, status: 1, isDeleted: false } }, select: { contents: { where: { isDeleted: false, isPrimary: true, status: 1 }, select: { content: true } } } })
      if (logs.length !== 1 || !logs[0].contents.some(item => changelogContainsVersion(item.content, state.pending!.targetBaseline.version))) fail('DOCUMENTATION_CHANGELOG_REQUIRED', 422)
      state.sourceBaseline = state.pending.targetBaseline; state.pending = null
    }
    if (needsWrite) {
      const serialized = JSON.stringify(documentationStateSchema.parse(state))
      if (Buffer.byteLength(serialized, 'utf8') > 2 * 1024 * 1024) fail('DOCUMENTATION_METADATA_BUDGET_EXCEEDED', 413)
      await tx.projectVersion.update({ where: { id: projectVersionId }, data: { documentationStateJson: serialized } })
    }
    return { projectVersionId: String(projectVersionId), documentRevision: version.documentRevision + (needsWrite ? 1 : 0), changed: needsWrite, results, documentationState: { ...state, documents: state.documents.filter(doc => bodies.some(change => change.key === doc.key)) } }
  })
  if (result.changed) await invalidatePublicProjectCache()
  return result
}
