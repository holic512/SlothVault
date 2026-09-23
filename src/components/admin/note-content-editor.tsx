'use client'

/**
 * @file note-content-editor.tsx
 * @project SlothVault
 * @module Unified Note Workspace
 * @description Owns project-version lifecycle actions and the linear project-to-Markdown administration flow in one responsive workspace.
 * @logic Resolve deep links, bind lifecycle actions to the selected version, guard context changes and publication against unsaved content, and keep published trees read-only.
 * @dependencies Ant Design, React Query, React MD Editor wrapper, Next navigation, next-intl, api-client
 * @index_tags admin,notes,workspace,project-versions,categories,content-versions,autosave,responsive
 * @author holic512
 */
import { useCallback, useEffect, useMemo, useRef, useState } from 'react'

import { useQuery, useQueryClient } from '@tanstack/react-query'
import {
  App,
  Alert,
  Button,
  Dropdown,
  Empty,
  Input,
  InputNumber,
  Modal,
  Select,
  Skeleton,
  Space,
  Switch,
  Tag,
  Tree,
  Typography,
} from 'antd'
import {
  BookOpenText,
  Braces,
  ChevronRight,
  CloudUpload,
  Clipboard,
  Download,
  Ellipsis,
  Eye,
  EyeOff,
  FilePenLine,
  FilePlus2,
  Folder,
  FolderOpen,
  FolderPlus,
  FolderTree,
  GitFork,
  Pencil,
  Plus,
  RefreshCw,
  Rocket,
  Save,
  ShieldCheck,
  Star,
  Trash2,
} from 'lucide-react'
import { useLocale, useTranslations } from 'next-intl'
import { useRouter, useSearchParams } from 'next/navigation'

import { MarkdownContentEditor } from '@/components/admin/markdown-content-editor'
import { formatAdminDate, formatAdminError } from '@/lib/admin-localization'
import { apiFetch, ApiClientError } from '@/lib/api-client'

type Project = { id: string; projectName: string }
type ProjectVersion = {
  id: string
  projectId: string
  version: string
  description: string | null
  weight: number
  status: number
  releaseId: string | null
  releaseHash: string | null
  publishedAt: string | null
  isDeleted: boolean
}
type Category = {
  id: string
  projectVersionId: string
  categoryName: string
  weight: number
  status: number
  isDeleted: boolean
}
type NoteInfo = {
  id: string
  categoryId: string
  noteTitle: string
  weight: number
  status: number
  isDeleted: boolean
  contentCount?: number
  category?: {
    id: string
    categoryName: string
    projectVersionId: string
    projectVersion?: {
      id: string
      version: string
      projectId: string
      publishedAt: string | null
      project?: { id: string; projectName: string } | null
    } | null
  } | null
}
type NoteContent = {
  id: string
  noteInfoId: string
  content: string
  versionNote: string | null
  isPrimary: boolean
  status: number
  createdAt: string
  updatedAt: string
  isDeleted: boolean
}
type UploadedFile = { url: string }
type EntityDialog = {
  kind: 'category' | 'note'
  mode: 'create' | 'edit'
  id?: string
  name: string
  weight: number
  status: number
}
type RevisionDialog = {
  mode: 'create' | 'edit'
  id?: string
  versionNote: string
  status: number
}
type MobilePane = 'tree' | 'versions' | 'content'
type VersionDialog = {
  mode: 'create' | 'edit' | 'clone'
  sourceId?: string
  version: string
  description: string
  weight: number
}
type VersionAction = 'create' | 'edit' | 'publish' | 'delete' | 'clone' | 'hide' | 'show' | 'copyHash' | 'manifest' | 'integrity'
const releaseIssueKeys = {
  PROJECT_INACTIVE: 'projectInactive',
  NO_ENABLED_CATEGORY: 'noEnabledCategory',
  CATEGORY_NO_ENABLED_NOTE: 'categoryNoEnabledNote',
  NOTE_PRIMARY_COUNT: 'notePrimaryCount',
  NOTE_PRIMARY_DISABLED: 'notePrimaryDisabled',
  NOTE_PRIMARY_EMPTY: 'notePrimaryEmpty',
  RELEASE_METADATA_INCOMPLETE: 'metadataIncomplete',
  MANIFEST_VERSION_UNSUPPORTED: 'manifestUnsupported',
  RELEASE_HASH_MISMATCH: 'hashMismatch',
} as const

export function getProjectVersionActions(projectId: string, version?: Pick<ProjectVersion, 'publishedAt' | 'status'>): VersionAction[] {
  if (!projectId) return []
  if (!version) return ['create']
  return version.publishedAt
    ? ['create', 'clone', version.status === 1 ? 'hide' : 'show', 'copyHash', 'manifest', 'integrity']
    : ['create', 'edit', 'publish', 'delete']
}

export async function loadProjectVersions(projectId: string) {
  const list: ProjectVersion[] = []
  for (let page = 1; ; page += 1) {
    const data = await apiFetch<{ list: ProjectVersion[]; total: number }>(
      `/api/admin/mm/projectVersion/byProject/${projectId}?page=${page}&pageSize=100&orderBy=id&order=asc`,
    )
    list.push(...data.list)
    if (!data.list.length || list.length >= data.total) return { list }
  }
}

function pageUrl(projectId: string, versionId: string, categoryId = '') {
  const params = new URLSearchParams()
  if (projectId) params.set('projectId', projectId)
  if (versionId) params.set('versionId', versionId)
  if (categoryId) params.set('categoryId', categoryId)
  const query = params.toString()
  return `/admin/mm/notes${query ? `?${query}` : ''}`
}

export function NoteContentEditor({ noteId }: { noteId?: string }) {
  const t = useTranslations('AdminMM.notes.workspace')
  const vt = useTranslations('AdminMM.projects.versionRelease')
  const contentT = useTranslations('AdminMM.notes.content')
  const errorT = useTranslations('AdminMM.errors')
  const locale = useLocale()
  const router = useRouter()
  const searchParams = useSearchParams()
  const queryClient = useQueryClient()
  const { message, modal } = App.useApp()
  const [projectId, setProjectId] = useState(searchParams.get('projectId') || '')
  const [versionId, setVersionId] = useState(searchParams.get('versionId') || '')
  const [selectedCategoryId, setSelectedCategoryId] = useState(searchParams.get('categoryId') || '')
  const [selectedNoteId, setSelectedNoteId] = useState(noteId || '')
  const [selectedContentId, setSelectedContentId] = useState('')
  const [keyword, setKeyword] = useState('')
  const [collapsedCategories, setCollapsedCategories] = useState<Record<string, boolean>>({})
  const [dirty, setDirty] = useState(false)
  const [mobilePane, setMobilePane] = useState<MobilePane>(noteId ? 'content' : 'tree')
  const [entityDialog, setEntityDialog] = useState<EntityDialog | null>(null)
  const [revisionDialog, setRevisionDialog] = useState<RevisionDialog | null>(null)
  const [versionDialog, setVersionDialog] = useState<VersionDialog | null>(null)
  const [busy, setBusy] = useState(false)

  const projectsQuery = useQuery({
    queryKey: ['admin-note-workspace-projects'],
    queryFn: () => apiFetch<{ list: Project[] }>('/api/admin/mm/project?pageSize=100'),
  })
  const deepNoteQuery = useQuery({
    queryKey: ['admin-note', noteId],
    enabled: Boolean(noteId),
    queryFn: () => apiFetch<NoteInfo>(`/api/admin/mm/note/${noteId}`),
  })
  const deepParent = deepNoteQuery.data?.category?.projectVersion
  const currentProjectId = deepParent?.projectId || projectId
  const currentVersionId = deepParent?.id || versionId
  const currentCategoryId = deepNoteQuery.data?.categoryId || selectedCategoryId
  const versionsQuery = useQuery({
    queryKey: ['admin-note-workspace-versions', currentProjectId],
    enabled: Boolean(currentProjectId),
    queryFn: () => loadProjectVersions(currentProjectId),
  })

  const selectedVersion = versionsQuery.data?.list.find((item) => item.id === currentVersionId)
  const readOnly = Boolean(selectedVersion?.publishedAt || (deepParent?.id === currentVersionId && deepParent.publishedAt))

  const categoriesQuery = useQuery({
    queryKey: ['admin-note-workspace-categories', currentVersionId],
    enabled: Boolean(currentVersionId),
    queryFn: () => apiFetch<{ list: Category[] }>(
      `/api/admin/mm/category/byProjectVersion/${currentVersionId}?pageSize=100`,
    ),
  })
  const notesQuery = useQuery({
    queryKey: ['admin-note-workspace-notes', currentVersionId],
    enabled: Boolean(currentVersionId),
    queryFn: async () => {
      const result: NoteInfo[] = []
      for (let page = 1; page <= 50; page += 1) {
        const data = await apiFetch<{ list: NoteInfo[]; total: number }>(
          `/api/admin/mm/note?page=${page}&pageSize=100&projectVersionId=${currentVersionId}`,
        )
        result.push(...data.list)
        if (!data.list.length || result.length >= data.total) break
      }
      return result
    },
  })
  const selectedNote = notesQuery.data?.find((item) => item.id === selectedNoteId)
    || (deepNoteQuery.data?.id === selectedNoteId ? deepNoteQuery.data : undefined)
  const contentsQuery = useQuery({
    queryKey: ['admin-note-contents', selectedNoteId],
    enabled: Boolean(selectedNoteId && selectedNote && !selectedNote.isDeleted),
    queryFn: () => apiFetch<{ list: NoteContent[] }>(
      `/api/admin/mm/noteContent?noteInfoId=${selectedNoteId}`,
    ),
  })
  const contents = contentsQuery.data?.list || []
  const selectedContent = contents.find((item) => item.id === selectedContentId)
    || contents.find((item) => item.isPrimary && !item.isDeleted)
    || contents.find((item) => !item.isDeleted)
    || contents[0]
    || null

  const confirmDiscard = useCallback(() => new Promise<boolean>((resolve) => {
    if (!dirty) {
      resolve(true)
      return
    }
    modal.confirm({
      title: contentT('messages.unsavedConfirmTitle'),
      content: contentT('messages.unsavedConfirm'),
      okText: contentT('messages.discardButton'),
      cancelText: contentT('messages.cancelButton'),
      onOk: () => resolve(true),
      onCancel: () => resolve(false),
    })
  }), [contentT, dirty, modal])

  const moveContext = async (action: () => void) => {
    if (!(await confirmDiscard())) return
    setDirty(false)
    action()
  }
  const refreshWorkspace = async () => {
    await Promise.all([
      queryClient.invalidateQueries({ queryKey: ['admin-projects'] }),
      queryClient.invalidateQueries({ queryKey: ['admin-note-workspace-projects'] }),
      queryClient.invalidateQueries({ queryKey: ['admin-note-workspace-versions'] }),
      queryClient.invalidateQueries({ queryKey: ['admin-note-workspace-categories'] }),
      queryClient.invalidateQueries({ queryKey: ['admin-note-workspace-notes'] }),
      queryClient.invalidateQueries({ queryKey: ['admin-note-contents'] }),
    ])
  }

  const chooseProject = (nextProjectId: string) => void moveContext(() => {
    setProjectId(nextProjectId)
    setVersionId('')
    setSelectedCategoryId('')
    setSelectedNoteId('')
    setSelectedContentId('')
    router.push(pageUrl(nextProjectId, ''))
  })
  const chooseVersion = (nextVersionId: string) => void moveContext(() => {
    setVersionId(nextVersionId)
    setSelectedCategoryId('')
    setSelectedNoteId('')
    setSelectedContentId('')
    router.push(pageUrl(currentProjectId, nextVersionId))
  })
  const chooseCategory = (categoryId: string) => void moveContext(() => {
    setSelectedCategoryId(categoryId)
    setSelectedNoteId('')
    setSelectedContentId('')
    setMobilePane('tree')
    router.push(pageUrl(currentProjectId, currentVersionId, categoryId))
  })
  const chooseNote = (nextNoteId: string) => void moveContext(() => {
    setSelectedNoteId(nextNoteId)
    setSelectedContentId('')
    setMobilePane('versions')
    router.push(`/admin/mm/notes/${nextNoteId}/content`)
  })
  const chooseRevision = (contentId: string) => void moveContext(() => {
    setSelectedContentId(contentId)
    setMobilePane('content')
  })

  const openCategory = (category?: Category) => {
    if (readOnly || !currentVersionId) return
    setEntityDialog({
      kind: 'category',
      mode: category ? 'edit' : 'create',
      id: category?.id,
      name: category?.categoryName || '',
      weight: category?.weight || 0,
      status: category?.status ?? 1,
    })
  }
  const openNote = (categoryId: string, note?: NoteInfo) => {
    if (readOnly || !categoryId) return
    setSelectedCategoryId(categoryId)
    setEntityDialog({
      kind: 'note',
      mode: note ? 'edit' : 'create',
      id: note?.id,
      name: note?.noteTitle || '',
      weight: note?.weight || 0,
      status: note?.status ?? 1,
    })
  }

  const saveEntity = async () => {
    if (!entityDialog || !entityDialog.name.trim()) return
    setBusy(true)
    try {
      const editing = entityDialog.mode === 'edit'
      if (entityDialog.kind === 'category') {
        const saved = await apiFetch<Category>(
          editing ? `/api/admin/mm/category/${entityDialog.id}` : '/api/admin/mm/category',
          {
            method: editing ? 'PUT' : 'POST',
            body: JSON.stringify({
              categoryName: entityDialog.name.trim(),
              weight: entityDialog.weight,
              status: entityDialog.status,
              ...(editing ? {} : { projectVersionId: currentVersionId }),
            }),
          },
        )
        await queryClient.invalidateQueries({ queryKey: ['admin-note-workspace-categories'] })
        setSelectedCategoryId(saved.id)
        router.replace(pageUrl(currentProjectId, currentVersionId, saved.id))
      } else {
        const saved = await apiFetch<NoteInfo>(
          editing ? `/api/admin/mm/note/${entityDialog.id}` : '/api/admin/mm/note',
          {
            method: editing ? 'PUT' : 'POST',
            body: JSON.stringify({
              noteTitle: entityDialog.name.trim(),
              weight: entityDialog.weight,
              status: entityDialog.status,
              ...(editing ? {} : { categoryId: currentCategoryId }),
            }),
          },
        )
        await queryClient.invalidateQueries({ queryKey: ['admin-note-workspace-notes'] })
        setSelectedNoteId(saved.id)
        setSelectedContentId('')
        setMobilePane('versions')
        router.push(`/admin/mm/notes/${saved.id}/content`)
      }
      setEntityDialog(null)
      message.success(editing ? t('saved') : t('created'))
    } catch (error) {
      message.error(formatAdminError(error, errorT))
    } finally {
      setBusy(false)
    }
  }

  const toggleEntityDeleted = async (kind: 'category' | 'note', item: Category | NoteInfo) => {
    if (readOnly) return
    if ((kind === 'note' && item.id === selectedNoteId) && !(await confirmDiscard())) return
    const label = kind === 'category' ? (item as Category).categoryName : (item as NoteInfo).noteTitle
    const execute = async () => {
      try {
        await apiFetch(`/api/admin/mm/${kind}/${item.id}`, { method: 'DELETE' })
        setDirty(false)
        if (kind === 'category' && item.id === currentCategoryId) {
          setSelectedCategoryId('')
          setSelectedNoteId('')
          router.push(pageUrl(currentProjectId, currentVersionId))
        }
        if (kind === 'note' && item.id === selectedNoteId) {
          setSelectedNoteId('')
          router.push(pageUrl(currentProjectId, currentVersionId, currentCategoryId))
        }
        await refreshWorkspace()
        message.success(t('deleted'))
      } catch (error) {
        message.error(formatAdminError(error, errorT))
      }
    }
    modal.confirm({
      title: t('deleteTitle'),
      content: t('deleteDescription', { name: label }),
      okButtonProps: { danger: true },
      okText: t('delete'),
      cancelText: t('cancel'),
      onOk: execute,
    })
  }

  const selectVersionContext = (nextVersionId: string) => {
    setVersionId(nextVersionId)
    setSelectedCategoryId('')
    setSelectedNoteId('')
    setSelectedContentId('')
    setMobilePane('tree')
    router.push(pageUrl(currentProjectId, nextVersionId))
  }

  const openVersionDialog = (mode: VersionDialog['mode'], source?: ProjectVersion) => {
    setVersionDialog({
      mode,
      sourceId: source?.id,
      version: mode === 'clone' ? `${source?.version || ''}-next` : mode === 'edit' ? source?.version || '' : '',
      description: mode === 'create' ? '' : source?.description || '',
      weight: mode === 'create' ? 0 : source?.weight || 0,
    })
  }

  const saveProjectVersion = async () => {
    if (!versionDialog || !currentProjectId || !versionDialog.version.trim()) return
    if (versionDialog.mode !== 'edit' && !(await confirmDiscard())) return
    setBusy(true)
    try {
      const { mode, sourceId } = versionDialog
      const saved = await apiFetch<ProjectVersion>(
        mode === 'create' ? '/api/admin/mm/projectVersion'
          : mode === 'clone' ? `/api/admin/mm/projectVersion/${sourceId}/clone`
            : `/api/admin/mm/projectVersion/${sourceId}`,
        {
          method: mode === 'edit' ? 'PUT' : 'POST',
          body: JSON.stringify({
            ...(mode === 'create' ? { projectId: currentProjectId, status: 0 } : {}),
            version: versionDialog.version.trim(),
            description: mode === 'edit' ? versionDialog.description.trim() : versionDialog.description.trim() || null,
            weight: versionDialog.weight,
          }),
        },
      )
      setVersionDialog(null)
      if (mode !== 'edit') {
        setDirty(false)
        selectVersionContext(saved.id)
      }
      await refreshWorkspace()
      message.success(mode === 'create' ? t('versionCreated') : mode === 'clone' ? vt('messages.cloned') : vt('messages.saved'))
    } catch (error) {
      message.error(formatAdminError(error, errorT))
    } finally {
      setBusy(false)
    }
  }

  const renderReleaseIssues = (issues: Array<{ code: string }>) => (
    <ul>{issues.map((issue, index) => (
      <li key={`${issue.code}:${index}`}>{vt(`validation.${releaseIssueKeys[issue.code as keyof typeof releaseIssueKeys] || 'unknown'}`)}</li>
    ))}</ul>
  )

  const showReleaseIssues = (error: unknown) => {
    const issues = error instanceof ApiClientError && error.data && typeof error.data === 'object' && 'issues' in error.data
      ? (error.data as { issues?: Array<{ code: string }> }).issues || []
      : []
    if (!issues.length) {
      message.error(formatAdminError(error, errorT))
      return
    }
    modal.error({
      title: vt('messages.publishValidationFailed'),
      content: renderReleaseIssues(issues),
    })
  }

  const runVersionAction = (action: VersionAction) => {
    if (action === 'create') {
      openVersionDialog('create')
      return
    }
    const version = selectedVersion
    if (!version) return
    if (action === 'edit' || action === 'clone') {
      openVersionDialog(action, version)
      return
    }
    if (action === 'publish' || action === 'delete') {
      if (dirty) {
        message.warning(t('saveBeforeVersionAction'))
        return
      }
      modal.confirm({
        title: action === 'publish' ? t('publishConfirm', { version: version.version }) : vt('deleteConfirm', { version: version.version }),
        content: action === 'publish' ? t('publishImmutable') : t('versionDeleteDescription'),
        okText: action === 'publish' ? vt('actions.publish') : vt('actions.delete'),
        okButtonProps: { danger: action === 'delete' },
        onOk: async () => {
          try {
            await apiFetch(`/api/admin/mm/projectVersion/${version.id}${action === 'publish' ? '/publish' : ''}`, {
              method: action === 'publish' ? 'POST' : 'DELETE',
            })
            if (action === 'delete') selectVersionContext('')
            await refreshWorkspace()
            message.success(action === 'publish' ? vt('messages.published') : t('deleted'))
          } catch (error) {
            if (action === 'publish') showReleaseIssues(error)
            else message.error(formatAdminError(error, errorT))
          }
        },
      })
      return
    }
    void (async () => {
      try {
        if (action === 'hide' || action === 'show') {
          await apiFetch(`/api/admin/mm/projectVersion/${version.id}`, {
            method: 'PUT',
            body: JSON.stringify({ status: action === 'show' ? 1 : 0 }),
          })
          await refreshWorkspace()
          message.success(vt(action === 'show' ? 'messages.restored' : 'messages.hidden'))
        } else if (action === 'copyHash') {
          await navigator.clipboard.writeText(version.releaseHash || '')
          message.success(vt('messages.hashCopied'))
        } else if (action === 'manifest') {
          const response = await fetch(`/api/admin/mm/projectVersion/${version.id}/manifest`, { credentials: 'same-origin' })
          if (!response.ok) throw new Error(vt('messages.manifestFailed'))
          const url = URL.createObjectURL(await response.blob())
          const anchor = document.createElement('a')
          anchor.href = url
          anchor.download = `slothvault-${version.releaseId}.manifest.json`
          anchor.click()
          URL.revokeObjectURL(url)
        } else if (action === 'integrity') {
          const result = await apiFetch<{ valid: boolean; computedHash: string | null; issues: Array<{ code: string }> }>(
            `/api/admin/mm/projectVersion/${version.id}/integrity`,
          )
          modal[result.valid ? 'success' : 'error']({
            title: vt(result.valid ? 'messages.integrityVerified' : 'messages.integrityFailed'),
            content: result.valid
              ? <code className="release-hash-block">{result.computedHash}</code>
              : renderReleaseIssues(result.issues),
          })
        }
      } catch (error) {
        message.error(action === 'copyHash' ? vt('messages.copyFailed') : formatAdminError(error, errorT))
      }
    })()
  }

  const saveRevision = async () => {
    if (!revisionDialog || !selectedNoteId) return
    setBusy(true)
    try {
      const editing = revisionDialog.mode === 'edit'
      const saved = await apiFetch<NoteContent>(
        editing ? `/api/admin/mm/noteContent/${revisionDialog.id}` : '/api/admin/mm/noteContent',
        {
          method: editing ? 'PUT' : 'POST',
          body: JSON.stringify({
            ...(editing ? {} : { noteInfoId: selectedNoteId, content: '' }),
            versionNote: revisionDialog.versionNote.trim() || null,
            status: revisionDialog.status,
          }),
        },
      )
      setRevisionDialog(null)
      setSelectedContentId(saved.id)
      setMobilePane('content')
      await queryClient.invalidateQueries({ queryKey: ['admin-note-contents', selectedNoteId] })
      message.success(editing ? t('saved') : t('revisionCreated'))
    } catch (error) {
      message.error(formatAdminError(error, errorT))
    } finally {
      setBusy(false)
    }
  }

  const updateRevision = async (item: NoteContent, data: Record<string, unknown>) => {
    try {
      await apiFetch(`/api/admin/mm/noteContent/${item.id}`, {
        method: 'PUT',
        body: JSON.stringify(data),
      })
      await queryClient.invalidateQueries({ queryKey: ['admin-note-contents', selectedNoteId] })
      message.success(t('saved'))
    } catch (error) {
      message.error(formatAdminError(error, errorT))
    }
  }
  const toggleRevisionDeleted = async (item: NoteContent) => {
    if (item.id === selectedContent?.id && !(await confirmDiscard())) return
    modal.confirm({
      title: t('deleteTitle'),
      content: t('deleteDescription', { name: item.versionNote || contentT('unnamedVersion') }),
      okText: t('delete'),
      cancelText: t('cancel'),
      okButtonProps: { danger: true },
      onOk: async () => {
        await apiFetch(`/api/admin/mm/noteContent/${item.id}`, { method: 'DELETE' })
        setDirty(false)
        setSelectedContentId('')
        await queryClient.invalidateQueries({ queryKey: ['admin-note-contents', selectedNoteId] })
        message.success(t('deleted'))
      },
    })
  }

  const filteredCategories = useMemo(() => {
    const normalized = keyword.trim().toLocaleLowerCase()
    return (categoriesQuery.data?.list || []).filter((category) => {
      if (!normalized) return true
      const notes = notesQuery.data?.filter((note) => note.categoryId === category.id) || []
      return category.categoryName.toLocaleLowerCase().includes(normalized)
        || notes.some((note) => note.noteTitle.toLocaleLowerCase().includes(normalized))
    })
  }, [categoriesQuery.data?.list, keyword, notesQuery.data])

  const expandedCategoryKeys = filteredCategories
    .filter((category) => keyword.trim() || !collapsedCategories[`${currentVersionId}:${category.id}`])
    .map((category) => `category:${category.id}`)

  const renderTreeActions = (category: Category, note?: NoteInfo) => {
    if (readOnly) return null
    const item = note || category
    const kind = note ? 'note' : 'category'
    return (
      <span className="note-tree-actions" onClick={(event) => event.stopPropagation()} onKeyDown={(event) => event.stopPropagation()}>
        {!note && !item.isDeleted ? <Button type="text" size="small" title={t('createNote')} aria-label={t('createNote')} icon={<Plus size={14} />} onClick={() => openNote(category.id)} /> : null}
        {!item.isDeleted ? <Button type="text" size="small" title={t(`entityDialog.${kind}.edit`)} aria-label={t(`entityDialog.${kind}.edit`)} icon={<Pencil size={14} />} onClick={() => note ? openNote(category.id, note) : openCategory(category)} /> : null}
        <Button type="text" size="small" title={t('delete')} aria-label={t('delete')} danger icon={<Trash2 size={14} />} onClick={() => void toggleEntityDeleted(kind, item)} />
      </span>
    )
  }

  const treeData = filteredCategories.map((category) => {
    const categoryNotes = (notesQuery.data || []).filter((note) => note.categoryId === category.id)
      .filter((note) => !keyword.trim() || category.categoryName.toLocaleLowerCase().includes(keyword.trim().toLocaleLowerCase()) || note.noteTitle.toLocaleLowerCase().includes(keyword.trim().toLocaleLowerCase()))
    const expanded = expandedCategoryKeys.includes(`category:${category.id}`)
    return {
      key: `category:${category.id}`,
      className: category.isDeleted ? 'is-deleted' : '',
      title: (
        <span className="note-tree-node-title">
          {expanded ? <FolderOpen size={16} /> : <Folder size={16} />}
          <span className="note-tree-label" title={category.categoryName}>{category.categoryName}</span>
          <span className="note-tree-count">{categoryNotes.length}</span>
          {renderTreeActions(category)}
        </span>
      ),
      children: categoryNotes.length ? categoryNotes.map((note) => ({
        key: `note:${note.id}`,
        isLeaf: true,
        selectable: !note.isDeleted,
        className: note.isDeleted ? 'is-deleted' : '',
        title: (
          <span className="note-tree-node-title">
            <FilePenLine size={15} />
            <span className="note-tree-label" title={note.noteTitle}>{note.noteTitle}</span>
            <span className="note-tree-count" title={t('revisions')}>{note.contentCount || 0}</span>
            {renderTreeActions(category, note)}
          </span>
        ),
      })) : !category.isDeleted && !readOnly ? [{
        key: `create:${category.id}`,
        isLeaf: true,
        selectable: false,
        title: <button className="note-tree-inline-create" type="button" onClick={(event) => { event.stopPropagation(); openNote(category.id) }}><Plus size={14} />{t('createNote')}</button>,
      }] : [],
    }
  })

  const loadingDeepLink = Boolean(noteId && deepNoteQuery.isLoading && !currentVersionId)
  if (loadingDeepLink || projectsQuery.isLoading) {
    return <div className="admin-editor-loading"><Skeleton active paragraph={{ rows: 12 }} /></div>
  }
  if (deepNoteQuery.isError) {
    return <Alert showIcon type="error" title={contentT('messages.fetchNoteFailed')} description={formatAdminError(deepNoteQuery.error, errorT)} />
  }

  const emptyStep = !currentProjectId
    ? { icon: <FolderTree size={32} />, text: t('empty.project'), action: t('empty.manageProjects'), run: () => router.push('/admin/mm/projects'), disabled: false }
    : !currentVersionId
      ? { icon: <FolderTree size={32} />, text: t('empty.version'), action: t('empty.createVersion'), run: () => openVersionDialog('create'), disabled: false }
      : !(categoriesQuery.data?.list || []).some((item) => !item.isDeleted)
        ? { icon: <FolderPlus size={32} />, text: t('empty.category'), action: t('empty.createCategory'), run: () => openCategory(), disabled: readOnly }
        : !currentCategoryId
          ? { icon: <FolderTree size={32} />, text: t('empty.selectCategory'), action: t('empty.selectFromTree'), run: () => setMobilePane('tree'), disabled: false }
          : !(notesQuery.data || []).some((item) => item.categoryId === currentCategoryId && !item.isDeleted)
            ? { icon: <BookOpenText size={32} />, text: t('empty.note'), action: t('empty.createNote'), run: () => openNote(currentCategoryId), disabled: readOnly }
            : !selectedNote
              ? { icon: <BookOpenText size={32} />, text: t('empty.selectNote'), action: t('empty.selectFromTree'), run: () => setMobilePane('tree'), disabled: false }
              : !selectedContent
                ? { icon: <CloudUpload size={32} />, text: t('empty.revision'), action: t('empty.createRevision'), run: () => setRevisionDialog({ mode: 'create', versionNote: '', status: 1 }), disabled: readOnly || selectedNote.isDeleted }
                : null

  const actionIcons = {
    create: <Plus size={14} />,
    edit: <Pencil size={14} />,
    publish: <Rocket size={14} />,
    delete: <Trash2 size={14} />,
    clone: <GitFork size={14} />,
    hide: <EyeOff size={14} />,
    show: <Eye size={14} />,
    copyHash: <Clipboard size={14} />,
    manifest: <Download size={14} />,
    integrity: <ShieldCheck size={14} />,
  }
  const versionTag = (version: ProjectVersion) => (
    <span className="note-version-tags" style={{ display: 'inline-flex', alignItems: 'center', gap: 4 }} title={version.publishedAt ? contentT('releasedReadOnly') : undefined}>
      <Tag style={{ marginInlineEnd: 0 }} color={version.publishedAt ? 'success' : 'default'}>{vt(version.publishedAt ? 'status.published' : 'status.draft')}</Tag>
      {version.publishedAt && version.status !== 1 ? <Tag style={{ marginInlineEnd: 0 }} color="warning">{vt('status.hidden')}</Tag> : null}
    </span>
  )

  return (
    <div className="note-editor-page">
      <div className="note-editor-topbar">
        <div className="note-context-selectors">
          <Select
            showSearch
            value={currentProjectId || undefined}
            placeholder={t('selectProject')}
            optionFilterProp="label"
            options={(projectsQuery.data?.list || []).map((item) => ({ value: item.id, label: item.projectName }))}
            onChange={chooseProject}
          />
          <ChevronRight size={14} />
          <Select
            showSearch
            disabled={!currentProjectId}
            value={selectedVersion?.id}
            placeholder={t('selectVersion')}
            optionFilterProp="label"
            options={(versionsQuery.data?.list || []).map((item) => ({
              value: item.id,
              label: item.version,
            }))}
            optionRender={(option) => {
              const version = versionsQuery.data?.list.find((item) => item.id === option.value)
              return <span className="note-version-option" style={{ display: 'flex', width: '100%', alignItems: 'center', justifyContent: 'space-between', gap: 4 }}><span>{option.label}</span>{version ? versionTag(version) : null}</span>
            }}
            onChange={chooseVersion}
          />
          <Dropdown menu={{ items: getProjectVersionActions(currentProjectId, selectedVersion).map((action) => ({
            key: action,
            icon: actionIcons[action],
            danger: action === 'delete',
            disabled: action === 'copyHash' && !selectedVersion?.releaseHash,
            label: action === 'create' ? t('newBlankDraft') : vt(`actions.${action}`),
            onClick: () => runVersionAction(action),
          })) }} disabled={!currentProjectId}>
            <Button icon={<Ellipsis size={15} />}>{t('versionActions')}</Button>
          </Dropdown>
        </div>
        <Space wrap className="note-version-status">
          {dirty ? <Tag color="warning">{contentT('unsaved')}</Tag> : null}
          <Button icon={<RefreshCw size={15} />} onClick={() => void refreshWorkspace()}>{t('refresh')}</Button>
          {selectedVersion ? versionTag(selectedVersion) : null}
        </Space>
      </div>

      <div className="note-mobile-tabs" role="tablist" aria-label={t('mobileNavigation')}>
        {(['tree', 'versions', 'content'] as MobilePane[]).map((pane) => (
          <button key={pane} type="button" className={mobilePane === pane ? 'is-active' : ''} onClick={() => setMobilePane(pane)}>
            {t(`mobile.${pane}`)}
          </button>
        ))}
      </div>

      <div className="note-editor-workspace" data-mobile-pane={mobilePane}>
        <aside className="note-library-panel">
          <div className="note-panel-header">
            <Typography.Text strong>{t('structure')}</Typography.Text>
            <Button type="text" size="small" icon={<FolderPlus size={14} />} disabled={!currentVersionId || readOnly} onClick={() => openCategory()}>{t('category')}</Button>
          </div>
          <div className="note-library-controls">
            <Input.Search allowClear value={keyword} placeholder={t('search')} onChange={(event) => setKeyword(event.target.value)} />
          </div>
          <div className="note-tree-scroll">
            {filteredCategories.length ? (
              <Tree
                className="note-library-tree"
                aria-label={t('structure')}
                blockNode
                virtual={false}
                treeData={treeData}
                expandedKeys={expandedCategoryKeys}
                selectedKeys={selectedNoteId ? [`note:${selectedNoteId}`] : currentCategoryId ? [`category:${currentCategoryId}`] : []}
                onExpand={(keys) => setCollapsedCategories((previous) => ({
                  ...previous,
                  ...Object.fromEntries(filteredCategories.map((category) => [
                    `${currentVersionId}:${category.id}`,
                    !keys.includes(`category:${category.id}`),
                  ])),
                }))}
                onSelect={(_, { node }) => {
                  const [kind, id] = String(node.key).split(':')
                  if (kind === 'category') chooseCategory(id)
                  if (kind === 'note') chooseNote(id)
                }}
              />
            ) : <Empty image={Empty.PRESENTED_IMAGE_SIMPLE} description={currentVersionId ? t('empty.category') : t('empty.version')} />}
          </div>
        </aside>

        <aside className="note-revision-panel">
          <div className="note-panel-header">
            <Typography.Text strong>{t('revisions')}</Typography.Text>
            <Button type="primary" size="small" icon={<FilePlus2 size={13} />} disabled={!selectedNote || selectedNote.isDeleted || readOnly} onClick={() => setRevisionDialog({ mode: 'create', versionNote: '', status: 1 })}>{t('newRevision')}</Button>
          </div>
          <div className="note-revision-list">
            {contents.length ? contents.map((item) => (
              <div key={item.id} className={`note-revision-card ${selectedContent?.id === item.id ? 'is-active' : ''} ${item.isDeleted ? 'is-deleted' : ''}`}>
                <button type="button" className="note-revision-copy" aria-pressed={selectedContent?.id === item.id} onClick={() => chooseRevision(item.id)}>
                  <strong>{item.isPrimary ? <Star size={13} fill="currentColor" /> : null}{item.versionNote || contentT('unnamedVersion')}</strong>
                  <small>{item.status === 1 ? t('enabled') : t('disabled')} · {formatAdminDate(locale, item.updatedAt)}</small>
                </button>
                <span className="note-revision-actions">
                  {!item.isDeleted ? <Button type="text" size="small" aria-label={t('revisionDialog.edit')} icon={<Pencil size={12} />} disabled={readOnly} onClick={() => setRevisionDialog({ mode: 'edit', id: item.id, versionNote: item.versionNote || '', status: item.status })} /> : null}
                  {!item.isDeleted && !item.isPrimary ? <Button type="text" size="small" aria-label={contentT('setPrimary')} icon={<Star size={12} />} disabled={readOnly} onClick={() => void updateRevision(item, { isPrimary: true })} /> : null}
                  <Button type="text" size="small" aria-label={t('delete')} danger icon={<Trash2 size={12} />} disabled={readOnly} onClick={() => void toggleRevisionDeleted(item)} />
                </span>
              </div>
            )) : <Empty image={Empty.PRESENTED_IMAGE_SIMPLE} description={selectedNote ? t('empty.revision') : t('empty.selectNote')} />}
          </div>
        </aside>

        <main className="note-writing-panel">
          {selectedNote && contents.length ? (
            <div className="note-compact-revision-control">
              <Select value={selectedContent?.id} options={contents.map((item) => ({ value: item.id, label: `${item.isPrimary ? '★ ' : ''}${item.versionNote || contentT('unnamedVersion')}` }))} onChange={chooseRevision} />
              <Button icon={<FilePlus2 size={13} />} disabled={readOnly || selectedNote.isDeleted} onClick={() => setRevisionDialog({ mode: 'create', versionNote: '', status: 1 })}>{t('newRevision')}</Button>
            </div>
          ) : null}
          {selectedContent && !selectedContent.isDeleted ? (
            <RevisionEditor
              key={`${selectedNoteId}:${selectedContent.id}`}
              item={selectedContent}
              readOnly={readOnly}
              onDirtyChange={setDirty}
              onSaved={(updated) => queryClient.setQueryData<{ list: NoteContent[] }>(
                ['admin-note-contents', selectedNoteId],
                (current) => ({ list: (current?.list || []).map((item) => item.id === updated.id ? updated : item) }),
              )}
            />
          ) : emptyStep ? (
            <div className="note-editor-empty">
              {emptyStep.icon}
              <Typography.Text>{emptyStep.text}</Typography.Text>
              <Button type="primary" disabled={emptyStep.disabled} onClick={emptyStep.run}>{emptyStep.action}</Button>
            </div>
          ) : null}
        </main>
      </div>

      <Modal open={Boolean(versionDialog)} title={versionDialog?.mode === 'edit' ? vt('form.editTitle') : versionDialog?.mode === 'clone' ? vt('clone.title', { version: selectedVersion?.version || '' }) : t('versionDialog.title')} okText={versionDialog?.mode === 'create' ? t('create') : t('save')} cancelText={t('cancel')} confirmLoading={busy} okButtonProps={{ disabled: !versionDialog?.version.trim() }} onCancel={() => setVersionDialog(null)} onOk={() => void saveProjectVersion()}>
        {versionDialog ? <div className="note-dialog-fields">
          <label><span>{vt('form.version')}</span><Input value={versionDialog.version} maxLength={64} placeholder={t('versionDialog.placeholder')} onChange={(event) => setVersionDialog({ ...versionDialog, version: event.target.value })} /></label>
          <label><span>{vt('form.description')}</span><Input.TextArea rows={3} value={versionDialog.description} onChange={(event) => setVersionDialog({ ...versionDialog, description: event.target.value })} /></label>
          <label><span>{vt('form.weight')}</span><InputNumber value={versionDialog.weight} min={0} onChange={(value) => setVersionDialog({ ...versionDialog, weight: value ?? 0 })} /></label>
        </div> : null}
      </Modal>
      <Modal open={Boolean(entityDialog)} title={entityDialog ? t(`entityDialog.${entityDialog.kind}.${entityDialog.mode}`) : ''} okText={t('save')} cancelText={t('cancel')} confirmLoading={busy} okButtonProps={{ disabled: !entityDialog?.name.trim() }} onCancel={() => setEntityDialog(null)} onOk={() => void saveEntity()}>
        {entityDialog ? <div className="note-dialog-fields">
          <label><span>{entityDialog.kind === 'category' ? t('categoryName') : t('noteTitle')}</span><Input value={entityDialog.name} maxLength={entityDialog.kind === 'category' ? 64 : 255} onChange={(event) => setEntityDialog({ ...entityDialog, name: event.target.value })} /></label>
          <label><span>{t('weight')}</span><InputNumber value={entityDialog.weight} onChange={(value) => setEntityDialog({ ...entityDialog, weight: value || 0 })} /></label>
          <label className="note-dialog-switch"><span>{t('enabled')}</span><Switch checked={entityDialog.status === 1} onChange={(checked) => setEntityDialog({ ...entityDialog, status: checked ? 1 : 0 })} /></label>
        </div> : null}
      </Modal>
      <Modal open={Boolean(revisionDialog)} title={revisionDialog ? t(`revisionDialog.${revisionDialog.mode}`) : ''} okText={t('save')} cancelText={t('cancel')} confirmLoading={busy} onCancel={() => setRevisionDialog(null)} onOk={() => void saveRevision()}>
        {revisionDialog ? <div className="note-dialog-fields">
          <label><span>{t('revisionNote')}</span><Input value={revisionDialog.versionNote} maxLength={255} onChange={(event) => setRevisionDialog({ ...revisionDialog, versionNote: event.target.value })} /></label>
          <label className="note-dialog-switch"><span>{t('enabled')}</span><Switch checked={revisionDialog.status === 1} onChange={(checked) => setRevisionDialog({ ...revisionDialog, status: checked ? 1 : 0 })} /></label>
        </div> : null}
      </Modal>
    </div>
  )
}

function RevisionEditor({ item, readOnly, onDirtyChange, onSaved }: {
  item: NoteContent
  readOnly: boolean
  onDirtyChange: (dirty: boolean) => void
  onSaved: (item: NoteContent) => void
}) {
  const contentT = useTranslations('AdminMM.notes.content')
  const documentT = useTranslations('DocumentEditor')
  const errorT = useTranslations('AdminMM.errors')
  const locale = useLocale()
  const { message } = App.useApp()
  const [draft, setDraft] = useState(item.content)
  const [savedDraft, setSavedDraft] = useState(item.content)
  const [saving, setSaving] = useState(false)
  const [lastSavedAt, setLastSavedAt] = useState<Date | null>(null)
  const draftRef = useRef(draft)
  const savedDraftRef = useRef(savedDraft)
  const savingRef = useRef(false)

  useEffect(() => { savedDraftRef.current = savedDraft }, [savedDraft])
  const save = useCallback(async (silent = false) => {
    const contentToSave = draftRef.current
    if (savingRef.current || contentToSave === savedDraftRef.current) {
      if (!silent && contentToSave === savedDraftRef.current) message.info(contentT('messages.noChanges'))
      return
    }
    savingRef.current = true
    setSaving(true)
    try {
      const updated = await apiFetch<NoteContent>(`/api/admin/mm/noteContent/${item.id}`, {
        method: 'PUT',
        body: JSON.stringify({ content: contentToSave }),
      })
      savedDraftRef.current = contentToSave
      setSavedDraft(contentToSave)
      setLastSavedAt(new Date())
      onSaved(updated)
      onDirtyChange(draftRef.current !== contentToSave)
      if (!silent) message.success(contentT('messages.saveSuccess'))
    } catch (error) {
      message.error(formatAdminError(error, errorT))
    } finally {
      savingRef.current = false
      setSaving(false)
    }
  }, [contentT, errorT, item.id, message, onDirtyChange, onSaved])

  useEffect(() => {
    if (readOnly || draft === savedDraft) return
    const timer = window.setTimeout(() => void save(true), 3000)
    return () => window.clearTimeout(timer)
  }, [draft, readOnly, save, savedDraft])
  useEffect(() => {
    const handleKeydown = (event: KeyboardEvent) => {
      if (!readOnly && (event.ctrlKey || event.metaKey) && event.key.toLocaleLowerCase() === 's') {
        event.preventDefault()
        void save(false)
      }
    }
    window.addEventListener('keydown', handleKeydown)
    return () => window.removeEventListener('keydown', handleKeydown)
  }, [readOnly, save])
  useEffect(() => {
    const handleBeforeUnload = (event: BeforeUnloadEvent) => {
      if (draftRef.current === savedDraftRef.current) return
      event.preventDefault()
    }
    window.addEventListener('beforeunload', handleBeforeUnload)
    return () => window.removeEventListener('beforeunload', handleBeforeUnload)
  }, [])

  const uploadImages = async (files: File[]) => {
    const formData = new FormData()
    files.forEach((file) => formData.append('file', file))
    try {
      const uploaded = await apiFetch<UploadedFile[]>('/api/admin/mm/file?businessType=NoteAttachment', { method: 'POST', body: formData })
      return uploaded.map((file) => file.url)
    } catch (error) {
      message.error(formatAdminError(error, errorT))
      return []
    }
  }

  return <>
    <MarkdownContentEditor
      fillContainer
      header={(
        <div className="note-writing-header">
          <div className="note-writing-version">
            <Tag color={item.isPrimary ? 'gold' : 'default'}>{item.isPrimary ? contentT('setPrimary') : item.versionNote || contentT('unnamedVersion')}</Tag>
            {lastSavedAt ? <Typography.Text type="secondary">{contentT('saved')} {formatAdminDate(locale, lastSavedAt)}</Typography.Text> : null}
          </div>
          <span className="note-writing-divider" aria-hidden="true" />
          <div className="document-editor-mode">
            <span className="document-editor-mode-icon" aria-hidden="true"><Braces size={15} /></span>
            <span>
              <strong>{documentT('title')}</strong>
              <small>{documentT('description')}</small>
            </span>
          </div>
        </div>
      )}
      headerActions={(
        <Space size={6} className="note-writing-actions">
          <Typography.Text type="secondary">{contentT('saveHint')}</Typography.Text>
          <Button type="primary" icon={<Save size={14} />} loading={saving} disabled={readOnly || draft === savedDraft} onClick={() => void save(false)}>{contentT('save')}</Button>
        </Space>
      )}
      value={draft}
      onChange={(value) => {
        draftRef.current = value
        setDraft(value)
        onDirtyChange(value !== savedDraftRef.current)
      }}
      onUpload={uploadImages}
      readOnly={readOnly}
    />
  </>
}
