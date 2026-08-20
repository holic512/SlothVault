'use client'

/**
 * @file note-content-editor.tsx
 * @project SlothVault
 * @module Unified Note Workspace
 * @description Owns the linear project-to-Markdown administration flow in one responsive workspace.
 * @logic Resolve deep-link or query context, guard every context transition with the same dirty check, manage category/note/content revisions in place, and keep published versions read-only.
 * @dependencies Ant Design, React Query, React MD Editor wrapper, Next navigation, next-intl, api-client
 * @index_tags admin,notes,workspace,categories,content-versions,autosave,responsive
 * @author holic512
 */
import { useCallback, useEffect, useMemo, useRef, useState } from 'react'

import { useQuery, useQueryClient } from '@tanstack/react-query'
import {
  App,
  Alert,
  Button,
  Empty,
  Input,
  InputNumber,
  Modal,
  Select,
  Skeleton,
  Space,
  Switch,
  Tag,
  Typography,
} from 'antd'
import {
  BookOpenText,
  ChevronRight,
  CloudUpload,
  FilePenLine,
  FilePlus2,
  FolderPlus,
  FolderTree,
  Pencil,
  Plus,
  RefreshCw,
  RotateCcw,
  Save,
  Star,
  Trash2,
} from 'lucide-react'
import { useTranslations } from 'next-intl'
import { useRouter, useSearchParams } from 'next/navigation'

import { MarkdownContentEditor } from '@/components/admin/markdown-content-editor'
import { apiFetch } from '@/lib/api-client'

type Project = { id: string; projectName: string }
type ProjectVersion = {
  id: string
  projectId: string
  version: string
  description: string | null
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
  const contentT = useTranslations('AdminMM.notes.content')
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
  const [includeDeleted, setIncludeDeleted] = useState(false)
  const [dirty, setDirty] = useState(false)
  const [mobilePane, setMobilePane] = useState<MobilePane>(noteId ? 'content' : 'tree')
  const [entityDialog, setEntityDialog] = useState<EntityDialog | null>(null)
  const [revisionDialog, setRevisionDialog] = useState<RevisionDialog | null>(null)
  const [versionDialogOpen, setVersionDialogOpen] = useState(false)
  const [newVersionLabel, setNewVersionLabel] = useState('')
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
    queryFn: () => apiFetch<{ list: ProjectVersion[] }>(
      `/api/admin/mm/projectVersion/byProject/${currentProjectId}?pageSize=100`,
    ),
  })

  const selectedVersion = versionsQuery.data?.list.find((item) => item.id === currentVersionId)
    || (deepNoteQuery.data?.category?.projectVersion?.id === currentVersionId
      ? {
          id: currentVersionId,
          projectId: currentProjectId,
          version: deepNoteQuery.data.category.projectVersion.version,
          description: null,
          publishedAt: deepNoteQuery.data.category.projectVersion.publishedAt,
          isDeleted: false,
        }
      : undefined)
  const readOnly = Boolean(selectedVersion?.publishedAt)

  const categoriesQuery = useQuery({
    queryKey: ['admin-note-workspace-categories', currentVersionId, includeDeleted],
    enabled: Boolean(currentVersionId),
    queryFn: () => apiFetch<{ list: Category[] }>(
      `/api/admin/mm/category/byProjectVersion/${currentVersionId}?pageSize=100&includeDeleted=${includeDeleted ? '1' : '0'}`,
    ),
  })
  const notesQuery = useQuery({
    queryKey: ['admin-note-workspace-notes', currentVersionId, includeDeleted],
    enabled: Boolean(currentVersionId),
    queryFn: async () => {
      const result: NoteInfo[] = []
      for (let page = 1; page <= 50; page += 1) {
        const data = await apiFetch<{ list: NoteInfo[]; total: number }>(
          `/api/admin/mm/note?page=${page}&pageSize=100&projectVersionId=${currentVersionId}&includeDeleted=${includeDeleted ? '1' : '0'}`,
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
    queryKey: ['admin-note-contents', selectedNoteId, includeDeleted],
    enabled: Boolean(selectedNoteId && selectedNote && !selectedNote.isDeleted),
    queryFn: () => apiFetch<{ list: NoteContent[] }>(
      `/api/admin/mm/noteContent?noteInfoId=${selectedNoteId}&includeDeleted=${includeDeleted ? '1' : '0'}`,
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
      message.error(error instanceof Error ? error.message : t('operationFailed'))
    } finally {
      setBusy(false)
    }
  }

  const toggleEntityDeleted = async (kind: 'category' | 'note', item: Category | NoteInfo) => {
    if (readOnly) return
    if ((kind === 'note' && item.id === selectedNoteId) && !(await confirmDiscard())) return
    const deleted = item.isDeleted
    const label = kind === 'category' ? (item as Category).categoryName : (item as NoteInfo).noteTitle
    const execute = async () => {
      try {
        await apiFetch(`/api/admin/mm/${kind}/${item.id}`, deleted
          ? { method: 'PUT', body: JSON.stringify({ isDeleted: false, status: 1 }) }
          : { method: 'DELETE' })
        if (!deleted) {
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
        }
        await refreshWorkspace()
        message.success(deleted ? t('restored') : t('deleted'))
      } catch (error) {
        message.error(error instanceof Error ? error.message : t('operationFailed'))
      }
    }
    if (deleted) return execute()
    modal.confirm({
      title: t('deleteTitle'),
      content: t('deleteDescription', { name: label }),
      okButtonProps: { danger: true },
      okText: t('delete'),
      cancelText: t('cancel'),
      onOk: execute,
    })
  }

  const createProjectVersion = async () => {
    if (!currentProjectId || !newVersionLabel.trim()) return
    setBusy(true)
    try {
      const created = await apiFetch<ProjectVersion>('/api/admin/mm/projectVersion', {
        method: 'POST',
        body: JSON.stringify({ projectId: currentProjectId, version: newVersionLabel.trim(), status: 0 }),
      })
      setVersionDialogOpen(false)
      setNewVersionLabel('')
      await queryClient.invalidateQueries({ queryKey: ['admin-note-workspace-versions', currentProjectId] })
      setVersionId(created.id)
      router.push(pageUrl(currentProjectId, created.id))
      message.success(t('versionCreated'))
    } catch (error) {
      message.error(error instanceof Error ? error.message : t('operationFailed'))
    } finally {
      setBusy(false)
    }
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
      message.error(error instanceof Error ? error.message : t('operationFailed'))
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
      message.error(error instanceof Error ? error.message : t('operationFailed'))
    }
  }
  const toggleRevisionDeleted = async (item: NoteContent) => {
    if (item.id === selectedContent?.id && !(await confirmDiscard())) return
    if (item.isDeleted) return updateRevision(item, { isDeleted: false, status: 1 })
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

  const loadingDeepLink = Boolean(noteId && deepNoteQuery.isLoading && !currentVersionId)
  if (loadingDeepLink || projectsQuery.isLoading) {
    return <div className="admin-editor-loading"><Skeleton active paragraph={{ rows: 12 }} /></div>
  }
  if (deepNoteQuery.isError) {
    return <Alert showIcon type="error" message={contentT('messages.fetchNoteFailed')} description={deepNoteQuery.error.message} />
  }

  const path = [
    projectsQuery.data?.list.find((item) => item.id === currentProjectId)?.projectName
      || deepNoteQuery.data?.category?.projectVersion?.project?.projectName,
    selectedVersion?.version,
    selectedNote?.category?.categoryName
      || categoriesQuery.data?.list.find((item) => item.id === currentCategoryId)?.categoryName,
    selectedNote?.noteTitle,
  ].filter(Boolean)

  const emptyStep = !currentProjectId
    ? { icon: <FolderTree size={32} />, text: t('empty.project'), action: t('empty.manageProjects'), run: () => router.push('/admin/mm/projects'), disabled: false }
    : !currentVersionId
      ? { icon: <FolderTree size={32} />, text: t('empty.version'), action: t('empty.createVersion'), run: () => setVersionDialogOpen(true), disabled: false }
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
            value={currentVersionId || undefined}
            placeholder={t('selectVersion')}
            optionFilterProp="label"
            options={(versionsQuery.data?.list || []).map((item) => ({
              value: item.id,
              label: `${item.version}${item.publishedAt ? ` · ${t('published')}` : ''}`,
            }))}
            onChange={chooseVersion}
          />
          <Button
            icon={<Plus size={15} />}
            disabled={!currentProjectId}
            onClick={() => setVersionDialogOpen(true)}
          >{t('quickVersion')}</Button>
        </div>
        <Space wrap>
          {dirty ? <Tag color="warning">{contentT('unsaved')}</Tag> : null}
          {readOnly ? <Tag color="blue">{contentT('releasedReadOnly')}</Tag> : null}
          <Button icon={<RefreshCw size={15} />} onClick={() => void refreshWorkspace()}>{t('refresh')}</Button>
        </Space>
      </div>

      {path.length ? <div className="note-workspace-path">{path.join(' / ')}</div> : null}
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
            <label className="note-deleted-toggle"><Switch size="small" checked={includeDeleted} onChange={setIncludeDeleted} /><span>{t('showDeleted')}</span></label>
          </div>
          <div className="note-tree-scroll">
            {filteredCategories.length ? filteredCategories.map((category) => {
              const categoryNotes = (notesQuery.data || []).filter((note) => note.categoryId === category.id)
                .filter((note) => !keyword.trim() || category.categoryName.toLocaleLowerCase().includes(keyword.trim().toLocaleLowerCase()) || note.noteTitle.toLocaleLowerCase().includes(keyword.trim().toLocaleLowerCase()))
              return (
                <div className={`note-tree-category ${category.id === currentCategoryId ? 'is-selected' : ''} ${category.isDeleted ? 'is-deleted' : ''}`} key={category.id}>
                  <div className="note-tree-category-row">
                    <button type="button" onClick={() => chooseCategory(category.id)}><FolderTree size={14} /><span>{category.categoryName}</span></button>
                    <span className="note-tree-actions">
                      {!category.isDeleted ? <Button type="text" size="small" icon={<Plus size={12} />} disabled={readOnly} onClick={() => openNote(category.id)} /> : null}
                      {!category.isDeleted ? <Button type="text" size="small" icon={<Pencil size={12} />} disabled={readOnly} onClick={() => openCategory(category)} /> : null}
                      <Button type="text" size="small" danger={!category.isDeleted} icon={category.isDeleted ? <RotateCcw size={12} /> : <Trash2 size={12} />} disabled={readOnly} onClick={() => void toggleEntityDeleted('category', category)} />
                    </span>
                  </div>
                  <div className="note-tree-notes">
                    {categoryNotes.map((note) => (
                      <div className={`note-tree-note-row ${note.id === selectedNoteId ? 'is-active' : ''} ${note.isDeleted ? 'is-deleted' : ''}`} key={note.id}>
                        <button type="button" disabled={note.isDeleted} onClick={() => chooseNote(note.id)}><FilePenLine size={13} /><span>{note.noteTitle}</span><Tag bordered={false}>{note.contentCount || 0}</Tag></button>
                        <span className="note-tree-actions">
                          {!note.isDeleted ? <Button type="text" size="small" icon={<Pencil size={12} />} disabled={readOnly} onClick={() => openNote(category.id, note)} /> : null}
                          <Button type="text" size="small" danger={!note.isDeleted} icon={note.isDeleted ? <RotateCcw size={12} /> : <Trash2 size={12} />} disabled={readOnly} onClick={() => void toggleEntityDeleted('note', note)} />
                        </span>
                      </div>
                    ))}
                    {!categoryNotes.length && !category.isDeleted ? <button className="note-tree-inline-create" type="button" disabled={readOnly} onClick={() => openNote(category.id)}><Plus size={12} />{t('createNote')}</button> : null}
                  </div>
                </div>
              )
            }) : <Empty image={Empty.PRESENTED_IMAGE_SIMPLE} description={currentVersionId ? t('empty.category') : t('empty.version')} />}
          </div>
        </aside>

        <aside className="note-revision-panel">
          <div className="note-panel-header">
            <Typography.Text strong>{t('revisions')}</Typography.Text>
            <Button type="primary" size="small" icon={<FilePlus2 size={13} />} disabled={!selectedNote || selectedNote.isDeleted || readOnly} onClick={() => setRevisionDialog({ mode: 'create', versionNote: '', status: 1 })}>{t('newRevision')}</Button>
          </div>
          <div className="note-revision-list">
            {contents.length ? contents.map((item) => (
              <button key={item.id} type="button" className={`note-revision-card ${selectedContent?.id === item.id ? 'is-active' : ''} ${item.isDeleted ? 'is-deleted' : ''}`} onClick={() => chooseRevision(item.id)}>
                <span className="note-revision-copy">
                  <strong>{item.isPrimary ? <Star size={13} fill="currentColor" /> : null}{item.versionNote || contentT('unnamedVersion')}</strong>
                  <small>{item.status === 1 ? t('enabled') : t('disabled')} · {new Date(item.updatedAt).toLocaleString()}</small>
                </span>
                <span className="note-revision-actions" onClick={(event) => event.stopPropagation()}>
                  {!item.isDeleted ? <Button type="text" size="small" icon={<Pencil size={12} />} disabled={readOnly} onClick={() => setRevisionDialog({ mode: 'edit', id: item.id, versionNote: item.versionNote || '', status: item.status })} /> : null}
                  {!item.isDeleted && !item.isPrimary ? <Button type="text" size="small" icon={<Star size={12} />} disabled={readOnly} onClick={() => void updateRevision(item, { isPrimary: true })} /> : null}
                  <Button type="text" size="small" danger={!item.isDeleted} icon={item.isDeleted ? <RotateCcw size={12} /> : <Trash2 size={12} />} disabled={readOnly} onClick={() => void toggleRevisionDeleted(item)} />
                </span>
              </button>
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
                ['admin-note-contents', selectedNoteId, includeDeleted],
                (current) => ({ list: (current?.list || []).map((item) => item.id === updated.id ? updated : item) }),
              )}
            />
          ) : emptyStep ? (
            <div className="note-editor-empty">
              {emptyStep.icon}
              <Typography.Text>{emptyStep.text}</Typography.Text>
              <Button type="primary" disabled={emptyStep.disabled} onClick={emptyStep.run}>{emptyStep.action}</Button>
            </div>
          ) : selectedContent?.isDeleted ? (
            <div className="note-editor-empty"><Trash2 size={32} /><Typography.Text>{t('deletedRevision')}</Typography.Text><Button disabled={readOnly} onClick={() => void toggleRevisionDeleted(selectedContent)}>{t('restore')}</Button></div>
          ) : null}
        </main>
      </div>

      <Modal open={versionDialogOpen} title={t('versionDialog.title')} okText={t('create')} cancelText={t('cancel')} confirmLoading={busy} okButtonProps={{ disabled: !newVersionLabel.trim() }} onCancel={() => setVersionDialogOpen(false)} onOk={() => void createProjectVersion()}>
        <Input value={newVersionLabel} maxLength={64} placeholder={t('versionDialog.placeholder')} onChange={(event) => setNewVersionLabel(event.target.value)} />
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
      message.error(error instanceof Error ? error.message : contentT('messages.saveFailed'))
    } finally {
      savingRef.current = false
      setSaving(false)
    }
  }, [contentT, item.id, message, onDirtyChange, onSaved])

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
      message.error(error instanceof Error ? error.message : contentT('messages.uploadFailed'))
      return []
    }
  }

  return <>
    <div className="note-writing-toolbar">
      <div><Tag color={item.isPrimary ? 'gold' : 'default'}>{item.isPrimary ? contentT('setPrimary') : item.versionNote || contentT('unnamedVersion')}</Tag>{lastSavedAt ? <Typography.Text type="secondary">{contentT('saved')} {lastSavedAt.toLocaleTimeString()}</Typography.Text> : null}</div>
      <Space><Typography.Text type="secondary">{contentT('saveHint')}</Typography.Text><Button type="primary" icon={<Save size={14} />} loading={saving} disabled={readOnly || draft === savedDraft} onClick={() => void save(false)}>{contentT('save')}</Button></Space>
    </div>
    <MarkdownContentEditor
      fillContainer
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
