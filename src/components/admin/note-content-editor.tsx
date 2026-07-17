'use client'

/**
 * @file note-content-editor.tsx
 * @project SlothVault
 * @module Note Content Administration
 * @description Replaces the Nuxt three-pane content workspace with React Query, Ant Design navigation, and a controlled Markdown editor.
 * @logic Navigate project-version notes, select transactional content revisions, debounce autosaves, upload images, and guard dirty transitions.
 * @dependencies Ant Design, React Query, React MD Editor wrapper, Next navigation, next-intl, api-client
 * @index_tags admin,notes,content,versions,autosave,markdown
 * @author holic512
 */
import { useCallback, useEffect, useMemo, useRef, useState } from 'react'

import { useMutation, useQuery, useQueryClient } from '@tanstack/react-query'
import {
  App,
  Alert,
  Button,
  Empty,
  Form,
  Input,
  Modal,
  Select,
  Skeleton,
  Space,
  Tag,
  Tree,
  Typography,
} from 'antd'
import type { DataNode } from 'antd/es/tree'
import {
  ArrowLeft,
  CloudUpload,
  FilePlus2,
  RefreshCw,
  Save,
  Star,
  Trash2,
} from 'lucide-react'
import { useTranslations } from 'next-intl'
import { useRouter } from 'next/navigation'

import { MarkdownContentEditor } from '@/components/admin/markdown-content-editor'
import { apiFetch } from '@/lib/api-client'

type NoteInfo = {
  id: string
  categoryId: string
  noteTitle: string
  weight: number
  status: number
  category?: {
    id: string
    categoryName: string
    projectVersionId: string
    projectVersion?: {
      id: string
      version: string
      projectId: string
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
type ProjectVersion = {
  id: string
  projectId: string
  version: string
  project?: { id: string; projectName: string } | null
}
type Category = {
  id: string
  projectVersionId: string
  categoryName: string
  weight: number
  status: number
}
type NavNote = {
  id: string
  categoryId: string
  noteTitle: string
  weight: number
  contentCount: number
}
type UploadedFile = { url: string }

export function NoteContentEditor({ noteId }: { noteId: string }) {
  const contentT = useTranslations('AdminMM.notes.content')
  const router = useRouter()
  const queryClient = useQueryClient()
  const { message, modal } = App.useApp()
  const [selectedContentId, setSelectedContentId] = useState<string | null>(null)
  const [selectedNavVersionId, setSelectedNavVersionId] = useState<string | null>(null)
  const [treeKeyword, setTreeKeyword] = useState('')
  const [dirty, setDirty] = useState(false)
  const [newVersionOpen, setNewVersionOpen] = useState(false)
  const [versionNote, setVersionNote] = useState('')

  const noteQuery = useQuery({
    queryKey: ['admin-note', noteId],
    queryFn: () => apiFetch<NoteInfo>(`/api/admin/mm/note/${noteId}`),
  })
  const contentsQuery = useQuery({
    queryKey: ['admin-note-contents', noteId],
    queryFn: () =>
      apiFetch<{ list: NoteContent[] }>(`/api/admin/mm/noteContent?noteInfoId=${noteId}`),
  })
  const versionsQuery = useQuery({
    queryKey: ['admin-note-editor-versions'],
    queryFn: async () => {
      const result: ProjectVersion[] = []
      for (let page = 1; page <= 20; page += 1) {
        const data = await apiFetch<{
          list: ProjectVersion[]
          total: number
        }>(`/api/admin/mm/projectVersion?page=${page}&pageSize=100&includeProject=1`)
        result.push(...data.list)
        if (!data.list.length || result.length >= data.total) break
      }
      return result
    },
  })

  const currentVersionId = noteQuery.data?.category?.projectVersion?.id || ''
  const navVersionId = selectedNavVersionId ?? currentVersionId
  const categoriesQuery = useQuery({
    queryKey: ['admin-note-editor-categories', navVersionId],
    enabled: Boolean(navVersionId),
    queryFn: () =>
      apiFetch<{ list: Category[] }>(
        `/api/admin/mm/category/byProjectVersion/${navVersionId}?pageSize=100`,
      ),
  })
  const navNotesQuery = useQuery({
    queryKey: ['admin-note-editor-nav-notes', navVersionId],
    enabled: Boolean(navVersionId),
    queryFn: async () => {
      const result: NavNote[] = []
      for (let page = 1; page <= 50; page += 1) {
        const data = await apiFetch<{ list: NavNote[]; total: number }>(
          `/api/admin/mm/note?page=${page}&pageSize=100&projectVersionId=${navVersionId}`,
        )
        result.push(...data.list)
        if (!data.list.length || result.length >= data.total) break
      }
      return result
    },
  })

  const contents = contentsQuery.data?.list || []
  const selectedContent =
    contents.find((item) => item.id === selectedContentId) ||
    contents.find((item) => item.isPrimary) ||
    contents[0] ||
    null

  const treeData = useMemo<DataNode[]>(() => {
    const normalizedKeyword = treeKeyword.trim().toLocaleLowerCase()
    const nodes: DataNode[] = []
    for (const category of categoriesQuery.data?.list || []) {
      const children: DataNode[] = (navNotesQuery.data || [])
        .filter((note) => note.categoryId === category.id)
        .filter((note) =>
          normalizedKeyword ? note.noteTitle.toLocaleLowerCase().includes(normalizedKeyword) : true,
        )
        .sort((left, right) => right.weight - left.weight)
        .map((note) => ({
          key: `note-${note.id}`,
          title: (
            <span className="note-tree-title">
              <span>{note.noteTitle}</span>
              <Tag bordered={false}>{note.contentCount}</Tag>
            </span>
          ),
          isLeaf: true,
        }))
      const categoryMatches = normalizedKeyword
        ? category.categoryName.toLocaleLowerCase().includes(normalizedKeyword)
        : true
      if (categoryMatches || children.length) {
        nodes.push({
          key: `category-${category.id}`,
          title: category.categoryName,
          children,
        })
      }
    }
    return nodes
  }, [categoriesQuery.data?.list, navNotesQuery.data, treeKeyword])

  const confirmDiscard = useCallback(
    () =>
      new Promise<boolean>((resolve) => {
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
      }),
    [contentT, dirty, modal],
  )

  const createVersion = useMutation({
    mutationFn: () =>
      apiFetch<NoteContent>('/api/admin/mm/noteContent', {
        method: 'POST',
        body: JSON.stringify({ noteInfoId: noteId, content: '', versionNote: versionNote || null, status: 1 }),
      }),
    onSuccess: async (created) => {
      setNewVersionOpen(false)
      setVersionNote('')
      setDirty(false)
      setSelectedContentId(created.id)
      await queryClient.invalidateQueries({ queryKey: ['admin-note-contents', noteId] })
      message.success(contentT('messages.createSuccess'))
    },
    onError: (error) => message.error(error.message),
  })
  const setPrimary = useMutation({
    mutationFn: (contentId: string) =>
      apiFetch<NoteContent>(`/api/admin/mm/noteContent/${contentId}`, {
        method: 'PUT',
        body: JSON.stringify({ isPrimary: true }),
      }),
    onSuccess: async () => {
      await queryClient.invalidateQueries({ queryKey: ['admin-note-contents', noteId] })
      message.success(contentT('messages.setPrimarySuccess'))
    },
    onError: (error) => message.error(error.message),
  })

  const deleteVersion = (item: NoteContent) => {
    modal.confirm({
      title: contentT('messages.deleteConfirmTitle'),
      content: contentT('messages.deleteConfirm', {
        name: item.versionNote || contentT('unnamedVersion'),
      }),
      okText: contentT('messages.deleteButton'),
      okButtonProps: { danger: true },
      cancelText: contentT('messages.cancelButton'),
      onOk: async () => {
        await apiFetch(`/api/admin/mm/noteContent/${item.id}`, { method: 'DELETE' })
        if (selectedContent?.id === item.id) setSelectedContentId(null)
        setDirty(false)
        await queryClient.invalidateQueries({ queryKey: ['admin-note-contents', noteId] })
        message.success(contentT('messages.deleted'))
      },
    })
  }

  const selectRevision = async (item: NoteContent) => {
    if (item.id === selectedContent?.id) return
    if (!(await confirmDiscard())) return
    setDirty(false)
    setSelectedContentId(item.id)
  }

  const navigateToNote = async (nextNoteId: string) => {
    if (nextNoteId === noteId || !(await confirmDiscard())) return
    router.push(`/admin/mm/notes/${nextNoteId}/content`)
  }

  if (noteQuery.isLoading || contentsQuery.isLoading) {
    return <div className="admin-editor-loading"><Skeleton active paragraph={{ rows: 12 }} /></div>
  }
  if (noteQuery.isError || !noteQuery.data) {
    return <Alert showIcon type="error" message={contentT('messages.fetchNoteFailed')} description={noteQuery.error?.message} />
  }

  const path = [
    noteQuery.data.category?.projectVersion?.project?.projectName,
    noteQuery.data.category?.projectVersion?.version,
    noteQuery.data.category?.categoryName,
  ].filter(Boolean)

  return (
    <div className="note-editor-page">
      <div className="note-editor-topbar">
        <div className="note-editor-heading">
          <Button
            type="text"
            icon={<ArrowLeft size={16} />}
            onClick={() => router.push('/admin/mm/notes')}
          />
          <div>
            <Typography.Title level={4}>{noteQuery.data.noteTitle}</Typography.Title>
            <Typography.Text type="secondary">{path.join(' / ')}</Typography.Text>
          </div>
        </div>
        <Space wrap>
          {dirty ? <Tag color="warning">{contentT('unsaved')}</Tag> : null}
          <Button
            icon={<RefreshCw size={15} />}
            onClick={() => {
              void noteQuery.refetch()
              void contentsQuery.refetch()
              void categoriesQuery.refetch()
              void navNotesQuery.refetch()
            }}
          >
            {contentT('actions.refresh')}
          </Button>
        </Space>
      </div>

      <div className="note-editor-workspace">
        <aside className="note-library-panel">
          <div className="note-panel-header">
            <Typography.Text strong>{contentT('navTitle')}</Typography.Text>
          </div>
          <div className="note-library-controls">
            <Select
              showSearch
              value={navVersionId || undefined}
              placeholder={contentT('navSelectVersion')}
              optionFilterProp="label"
              options={(versionsQuery.data || []).map((version) => ({
                value: version.id,
                label: `${version.project?.projectName ? `${version.project.projectName} / ` : ''}${version.version}`,
              }))}
              onChange={(value) => setSelectedNavVersionId(value)}
            />
            <Input.Search
              allowClear
              value={treeKeyword}
              placeholder={contentT('navSearchPlaceholder')}
              onChange={(event) => setTreeKeyword(event.target.value)}
            />
          </div>
          <div className="note-tree-scroll">
            {treeData.length ? (
              <Tree
                blockNode
                defaultExpandAll
                treeData={treeData}
                selectedKeys={[`note-${noteId}`]}
                onSelect={(keys) => {
                  const key = String(keys[0] || '')
                  if (key.startsWith('note-')) void navigateToNote(key.slice(5))
                }}
              />
            ) : (
              <Empty image={Empty.PRESENTED_IMAGE_SIMPLE} description={contentT('navEmptyTip')} />
            )}
          </div>
        </aside>

        <aside className="note-revision-panel">
          <div className="note-panel-header">
            <Typography.Text strong>{contentT('sidebarTitle')}</Typography.Text>
            <Button
              type="primary"
              size="small"
              icon={<FilePlus2 size={13} />}
              onClick={() => setNewVersionOpen(true)}
            >
              {contentT('newVersion')}
            </Button>
          </div>
          <div className="note-revision-list">
            {contents.length ? (
              contents.map((item) => (
                <button
                  key={item.id}
                  type="button"
                  className={`note-revision-card ${selectedContent?.id === item.id ? 'is-active' : ''}`}
                  onClick={() => void selectRevision(item)}
                >
                  <span className="note-revision-copy">
                    <strong>
                      {item.isPrimary ? <Star size={13} fill="currentColor" /> : null}
                      {item.versionNote || contentT('unnamedVersion')}
                    </strong>
                    <small>{new Date(item.updatedAt).toLocaleString()}</small>
                  </span>
                  <span className="note-revision-actions" onClick={(event) => event.stopPropagation()}>
                    {!item.isPrimary ? (
                      <Button
                        type="text"
                        size="small"
                        aria-label={contentT('setPrimary')}
                        icon={<Star size={13} />}
                        onClick={() => setPrimary.mutate(item.id)}
                      />
                    ) : null}
                    <Button
                      type="text"
                      danger
                      size="small"
                      aria-label={contentT('delete')}
                      icon={<Trash2 size={13} />}
                      onClick={() => deleteVersion(item)}
                    />
                  </span>
                </button>
              ))
            ) : (
              <Empty image={Empty.PRESENTED_IMAGE_SIMPLE} description={contentT('emptyTip')} />
            )}
          </div>
        </aside>

        <main className="note-writing-panel">
          {selectedContent ? (
            <RevisionEditor
              key={`${noteId}:${selectedContent.id}`}
              item={selectedContent}
              onDirtyChange={setDirty}
              onSaved={(updated) => {
                queryClient.setQueryData<{ list: NoteContent[] }>(
                  ['admin-note-contents', noteId],
                  (current) => ({
                    list: (current?.list || []).map((item) =>
                      item.id === updated.id ? updated : item,
                    ),
                  }),
                )
              }}
            />
          ) : (
            <div className="note-editor-empty">
              <CloudUpload size={30} />
              <Typography.Text>{contentT('selectOrCreate')}</Typography.Text>
              <Button type="primary" onClick={() => setNewVersionOpen(true)}>
                {contentT('newVersion')}
              </Button>
            </div>
          )}
        </main>
      </div>

      <Modal
        open={newVersionOpen}
        title={contentT('newVersionDialog.title')}
        okText={contentT('newVersionDialog.create')}
        cancelText={contentT('newVersionDialog.cancel')}
        confirmLoading={createVersion.isPending}
        onCancel={() => setNewVersionOpen(false)}
        onOk={() => createVersion.mutate()}
      >
        <Form layout="vertical">
          <Form.Item label={contentT('newVersionDialog.versionNote')}>
            <Input
              value={versionNote}
              maxLength={255}
              showCount
              placeholder={contentT('newVersionDialog.placeholder')}
              onChange={(event) => setVersionNote(event.target.value)}
            />
          </Form.Item>
        </Form>
      </Modal>
    </div>
  )
}

function RevisionEditor({
  item,
  onDirtyChange,
  onSaved,
}: {
  item: NoteContent
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
  const savingRef = useRef(false)

  const save = useCallback(
    async (silent = false) => {
      const contentToSave = draftRef.current
      if (savingRef.current || contentToSave === savedDraft) {
        if (!silent && contentToSave === savedDraft) message.info(contentT('messages.noChanges'))
        return
      }
      savingRef.current = true
      setSaving(true)
      try {
        const updated = await apiFetch<NoteContent>(`/api/admin/mm/noteContent/${item.id}`, {
          method: 'PUT',
          body: JSON.stringify({ content: contentToSave }),
        })
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
    },
    [contentT, item.id, message, onDirtyChange, onSaved, savedDraft],
  )

  useEffect(() => {
    if (draft === savedDraft) return
    const timer = window.setTimeout(() => void save(true), 3000)
    return () => window.clearTimeout(timer)
  }, [draft, save, savedDraft])

  useEffect(() => {
    const handleKeydown = (event: KeyboardEvent) => {
      if ((event.ctrlKey || event.metaKey) && event.key.toLocaleLowerCase() === 's') {
        event.preventDefault()
        void save(false)
      }
    }
    window.addEventListener('keydown', handleKeydown)
    return () => window.removeEventListener('keydown', handleKeydown)
  }, [save])

  useEffect(() => {
    const handleBeforeUnload = (event: BeforeUnloadEvent) => {
      if (draftRef.current === savedDraft) return
      event.preventDefault()
    }
    window.addEventListener('beforeunload', handleBeforeUnload)
    return () => window.removeEventListener('beforeunload', handleBeforeUnload)
  }, [savedDraft])

  const uploadImages = async (files: File[]) => {
    const formData = new FormData()
    files.forEach((file) => formData.append('file', file))
    try {
      const uploaded = await apiFetch<UploadedFile[]>(
        '/api/admin/mm/file?businessType=NoteAttachment',
        { method: 'POST', body: formData },
      )
      return uploaded.map((file) => file.url)
    } catch (error) {
      message.error(error instanceof Error ? error.message : contentT('messages.uploadFailed'))
      return []
    }
  }

  return (
    <>
      <div className="note-writing-toolbar">
        <div>
          <Tag color={item.isPrimary ? 'gold' : 'default'}>
            {item.isPrimary ? contentT('setPrimary') : item.versionNote || contentT('unnamedVersion')}
          </Tag>
          {lastSavedAt ? (
            <Typography.Text type="secondary">
              {contentT('saved')} {lastSavedAt.toLocaleTimeString()}
            </Typography.Text>
          ) : null}
        </div>
        <Space>
          <Typography.Text type="secondary">{contentT('saveHint')}</Typography.Text>
          <Button
            type="primary"
            icon={<Save size={14} />}
            loading={saving}
            disabled={draft === savedDraft}
            onClick={() => void save(false)}
          >
            {contentT('save')}
          </Button>
        </Space>
      </div>
      <MarkdownContentEditor
        value={draft}
        onChange={(value) => {
          draftRef.current = value
          setDraft(value)
          onDirtyChange(value !== savedDraft)
        }}
        onUpload={uploadImages}
      />
    </>
  )
}
