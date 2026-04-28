'use client'

import {
  App,
  Button,
  Card,
  Empty,
  Flex,
  Form,
  Input,
  InputNumber,
  List,
  Modal,
  Select,
  Space,
  Spin,
  Tabs,
  Tag,
  Typography
} from 'antd'
import { useMutation, useQuery, useQueryClient } from '@tanstack/react-query'
import dayjs from 'dayjs'
import { usePathname, useRouter, useSearchParams } from 'next/navigation'
import { useEffect, useMemo, useState } from 'react'

import { apiFetch, ApiError } from '@/lib/http'
import { AdminPageHeader } from '@/components/admin/admin-page-header'
import { AdminStatusSelect, renderAuthTag, renderStatusBadge } from '@/components/admin/admin-status'
import { MarkdownEditor } from '@/components/admin/markdown-editor'

type WorkspaceTab = 'content' | 'home' | 'settings'
type WorkspaceFocus = 'version' | 'category' | 'note'

type Project = {
  id: string
  projectName: string
  avatar: string | null
  weight: number
  status: number
  requireAuth: boolean
  accessPriceSol: string | null
  purchaseEnabled: boolean
  updatedAt: string
}

type Version = {
  id: string
  projectId: string
  version: string
  description: string | null
  weight: number
  status: number
  updatedAt: string
}

type Category = {
  id: string
  projectVersionId: string
  categoryName: string
  weight: number
  status: number
  updatedAt: string
}

type NoteInfo = {
  id: string
  categoryId: string
  noteTitle: string
  weight: number
  status: number
  updatedAt: string
  contentCount: number
}

type NoteContent = {
  id: string
  noteInfoId: string
  content: string
  versionNote: string | null
  isPrimary: boolean
  status: number
  updatedAt: string
}

type ProjectHome = {
  id: string
  projectId: string
  content: string
  status: number
}

type DetailMode = 'create' | 'edit'

const RIGHT_PANEL_MIN_HEIGHT = 680

function formatTime(value?: string | null) {
  return value ? dayjs(value).format('YYYY-MM-DD HH:mm') : '-'
}

function useWorkspaceQueryState() {
  const router = useRouter()
  const pathname = usePathname()
  const searchParams = useSearchParams()

  const tab = (searchParams.get('tab') as WorkspaceTab | null) || 'content'
  const versionId = searchParams.get('versionId')
  const categoryId = searchParams.get('categoryId')
  const noteId = searchParams.get('noteId')
  const contentId = searchParams.get('contentId')
  const focus = searchParams.get('focus') as WorkspaceFocus | null

  const setQuery = (patch: Record<string, string | null | undefined>) => {
    const next = new URLSearchParams(searchParams.toString())
    Object.entries(patch).forEach(([key, value]) => {
      if (!value) {
        next.delete(key)
      } else {
        next.set(key, value)
      }
    })
    const nextQuery = next.toString()
    const currentQuery = searchParams.toString()
    if (nextQuery === currentQuery) return
    router.replace(nextQuery ? `${pathname}?${nextQuery}` : pathname, { scroll: false })
  }

  return {
    tab,
    versionId,
    categoryId,
    noteId,
    contentId,
    focus,
    setQuery
  }
}

export function ProjectWorkspace({ projectId }: { projectId: string }) {
  const { message, modal } = App.useApp()
  const queryClient = useQueryClient()
  const workspace = useWorkspaceQueryState()

  const [versionForm] = Form.useForm()
  const [categoryForm] = Form.useForm()
  const [noteForm] = Form.useForm()
  const [settingsForm] = Form.useForm()

  const [versionDialog, setVersionDialog] = useState<{ mode: DetailMode; record?: Version } | null>(null)
  const [categoryDialog, setCategoryDialog] = useState<{ mode: DetailMode; record?: Category } | null>(null)
  const [noteDialog, setNoteDialog] = useState<{ mode: DetailMode; record?: NoteInfo } | null>(null)

  const [homeId, setHomeId] = useState<string | null>(null)
  const [homeContent, setHomeContent] = useState('')
  const [contentDraftMode, setContentDraftMode] = useState(false)
  const [contentForm, setContentForm] = useState({
    versionNote: '',
    status: 1,
    isPrimary: false,
    content: ''
  })

  const projectQuery = useQuery({
    queryKey: ['admin-project', projectId],
    queryFn: () => apiFetch<Project>(`/api/admin/mm/project/${projectId}`)
  })

  const versionsQuery = useQuery({
    queryKey: ['admin-project-versions', projectId],
    queryFn: () =>
      apiFetch<{ list: Version[] }>(`/api/admin/mm/projectVersion/byProject/${projectId}?page=1&pageSize=100`).then(
        (res) => res.list
      )
  })

  const categoriesQuery = useQuery({
    queryKey: ['admin-version-categories', workspace.versionId],
    enabled: Boolean(workspace.versionId),
    queryFn: () =>
      apiFetch<{ list: Category[] }>(
        `/api/admin/mm/category/byProjectVersion/${workspace.versionId}?page=1&pageSize=100`
      ).then((res) => res.list)
  })

  const notesQuery = useQuery({
    queryKey: ['admin-category-notes', workspace.categoryId, workspace.versionId, projectId],
    enabled: Boolean(workspace.versionId),
    queryFn: () => {
      const params = new URLSearchParams({ page: '1', pageSize: '100', projectId })
      if (workspace.versionId) params.set('projectVersionId', workspace.versionId)
      if (workspace.categoryId) params.set('categoryId', workspace.categoryId)
      return apiFetch<{ list: NoteInfo[] }>(`/api/admin/mm/note?${params.toString()}`).then((res) => res.list)
    }
  })

  const noteDetailQuery = useQuery({
    queryKey: ['admin-note-detail', workspace.noteId],
    enabled: Boolean(workspace.noteId),
    queryFn: () => apiFetch<NoteInfo>(`/api/admin/mm/note/${workspace.noteId}`)
  })

  const noteContentsQuery = useQuery({
    queryKey: ['admin-note-contents', workspace.noteId],
    enabled: Boolean(workspace.noteId),
    queryFn: () =>
      apiFetch<{ list: NoteContent[] }>(`/api/admin/mm/noteContent?noteInfoId=${workspace.noteId}&includeDeleted=1`).then(
        (res) => res.list
      )
  })

  const homeQuery = useQuery({
    queryKey: ['admin-project-home', projectId],
    queryFn: async () => {
      try {
        return await apiFetch<ProjectHome>(`/api/admin/mm/home?projectId=${projectId}`)
      } catch (error) {
        if (error instanceof ApiError && error.status === 404) return null
        throw error
      }
    }
  })

  const versions = versionsQuery.data || []
  const categories = categoriesQuery.data || []
  const notes = notesQuery.data || []
  const noteContents = noteContentsQuery.data || []

  const selectedVersion = useMemo(
    () => versions.find((item) => item.id === workspace.versionId) || null,
    [versions, workspace.versionId]
  )
  const selectedCategory = useMemo(
    () => categories.find((item) => item.id === workspace.categoryId) || null,
    [categories, workspace.categoryId]
  )
  const selectedNote = noteDetailQuery.data || notes.find((item) => item.id === workspace.noteId) || null
  const selectedContent = useMemo(
    () => noteContents.find((item) => item.id === workspace.contentId) || null,
    [noteContents, workspace.contentId]
  )

  useEffect(() => {
    if (projectQuery.data) {
      settingsForm.setFieldsValue({
        projectName: projectQuery.data.projectName,
        avatar: projectQuery.data.avatar,
        weight: projectQuery.data.weight,
        status: projectQuery.data.status,
        requireAuth: projectQuery.data.requireAuth,
        accessPriceSol: projectQuery.data.accessPriceSol
      })
    }
  }, [projectQuery.data, settingsForm])

  useEffect(() => {
    setHomeId(homeQuery.data?.id || null)
    setHomeContent(homeQuery.data?.content || '')
  }, [homeQuery.data?.content, homeQuery.data?.id])

  useEffect(() => {
    if (!workspace.versionId && versions.length > 0) {
      workspace.setQuery({
        versionId: versions[0].id,
        categoryId: workspace.focus === 'version' ? null : undefined,
        noteId: workspace.focus === 'version' ? null : undefined,
        contentId: workspace.focus === 'version' ? null : undefined,
        focus: workspace.focus || 'note'
      })
      return
    }
    if (workspace.versionId && !selectedVersion) {
      workspace.setQuery({
        versionId: versions[0]?.id || null,
        categoryId: null,
        noteId: null,
        contentId: null
      })
    }
  }, [selectedVersion, versions, workspace])

  useEffect(() => {
    if (!workspace.versionId || workspace.focus === 'version') return
    if (!workspace.categoryId && categories.length > 0) {
      workspace.setQuery({
        categoryId: categories[0].id,
        noteId: workspace.focus === 'category' ? null : undefined,
        contentId: workspace.focus === 'category' ? null : undefined,
        focus: workspace.focus || 'note'
      })
      return
    }
    if (workspace.categoryId && !selectedCategory) {
      workspace.setQuery({
        categoryId: categories[0]?.id || null,
        noteId: null,
        contentId: null
      })
    }
  }, [categories, selectedCategory, workspace])

  useEffect(() => {
    if (!workspace.categoryId || workspace.focus === 'version' || workspace.focus === 'category') return
    if (!workspace.noteId && notes.length > 0) {
      workspace.setQuery({
        noteId: notes[0].id,
        focus: 'note'
      })
      return
    }
    if (workspace.noteId && !selectedNote) {
      workspace.setQuery({
        noteId: notes[0]?.id || null,
        contentId: null
      })
    }
  }, [notes, selectedNote, workspace])

  useEffect(() => {
    if (!workspace.noteId) {
      setContentDraftMode(false)
      setContentForm({ versionNote: '', status: 1, isPrimary: false, content: '' })
      return
    }
    if (contentDraftMode) return
    if (!workspace.contentId && noteContents.length > 0) {
      workspace.setQuery({ contentId: noteContents[0].id })
      return
    }
    if (workspace.contentId && !selectedContent) {
      workspace.setQuery({ contentId: noteContents[0]?.id || null })
    }
  }, [contentDraftMode, noteContents, selectedContent, workspace])

  useEffect(() => {
    if (contentDraftMode) {
      setContentForm({
        versionNote: '',
        status: 1,
        isPrimary: noteContents.length === 0,
        content: ''
      })
      return
    }
    if (selectedContent) {
      setContentForm({
        versionNote: selectedContent.versionNote || '',
        status: selectedContent.status,
        isPrimary: selectedContent.isPrimary,
        content: selectedContent.content
      })
      return
    }
    if (workspace.noteId && noteContents.length === 0) {
      setContentForm({
        versionNote: '',
        status: 1,
        isPrimary: true,
        content: ''
      })
    }
  }, [contentDraftMode, noteContents.length, selectedContent, workspace.noteId])

  const refreshProjectWorkspace = async () => {
    await Promise.all([
      queryClient.invalidateQueries({ queryKey: ['admin-project', projectId] }),
      queryClient.invalidateQueries({ queryKey: ['admin-project-versions', projectId] }),
      queryClient.invalidateQueries({ queryKey: ['projects'] })
    ])
  }

  const versionMutation = useMutation({
    mutationFn: async (values: any) => {
      if (versionDialog?.mode === 'edit' && versionDialog.record) {
        return apiFetch<Version>(`/api/admin/mm/projectVersion/${versionDialog.record.id}`, {
          method: 'PUT',
          headers: { 'Content-Type': 'application/json' },
          body: JSON.stringify(values)
        })
      }
      return apiFetch<Version>('/api/admin/mm/projectVersion', {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({ ...values, projectId })
      })
    },
    onSuccess: async (result) => {
      message.success(versionDialog?.mode === 'edit' ? 'Version updated' : 'Version created')
      setVersionDialog(null)
      versionForm.resetFields()
      await refreshProjectWorkspace()
      workspace.setQuery({
        tab: 'content',
        versionId: result.id,
        categoryId: null,
        noteId: null,
        contentId: null,
        focus: versionDialog?.mode === 'edit' ? workspace.focus || 'version' : 'version'
      })
      if (versionDialog?.mode !== 'edit') {
        openCreateCategory()
      }
    }
  })

  const categoryMutation = useMutation({
    mutationFn: async (values: any) => {
      if (categoryDialog?.mode === 'edit' && categoryDialog.record) {
        return apiFetch<Category>(`/api/admin/mm/category/${categoryDialog.record.id}`, {
          method: 'PUT',
          headers: { 'Content-Type': 'application/json' },
          body: JSON.stringify(values)
        })
      }
      return apiFetch<Category>('/api/admin/mm/category', {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({ ...values, projectVersionId: workspace.versionId })
      })
    },
    onSuccess: async (result) => {
      message.success(categoryDialog?.mode === 'edit' ? 'Category updated' : 'Category created')
      setCategoryDialog(null)
      categoryForm.resetFields()
      await queryClient.invalidateQueries({ queryKey: ['admin-version-categories', workspace.versionId] })
      workspace.setQuery({
        categoryId: result.id,
        noteId: null,
        contentId: null,
        focus: categoryDialog?.mode === 'edit' ? workspace.focus || 'category' : 'category'
      })
      if (categoryDialog?.mode !== 'edit') {
        openCreateNote()
      }
    }
  })

  const noteMutation = useMutation({
    mutationFn: async (values: any) => {
      if (noteDialog?.mode === 'edit' && noteDialog.record) {
        return apiFetch<NoteInfo>(`/api/admin/mm/note/${noteDialog.record.id}`, {
          method: 'PUT',
          headers: { 'Content-Type': 'application/json' },
          body: JSON.stringify(values)
        })
      }
      return apiFetch<NoteInfo>('/api/admin/mm/note', {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({ ...values, categoryId: workspace.categoryId })
      })
    },
    onSuccess: async (result) => {
      message.success(noteDialog?.mode === 'edit' ? 'Note updated' : 'Note created')
      setNoteDialog(null)
      noteForm.resetFields()
      await queryClient.invalidateQueries({ queryKey: ['admin-category-notes', workspace.categoryId, workspace.versionId, projectId] })
      await queryClient.invalidateQueries({ queryKey: ['admin-note-detail', result.id] })
      workspace.setQuery({
        noteId: result.id,
        contentId: null,
        focus: 'note'
      })
      if (noteDialog?.mode !== 'edit') {
        setContentDraftMode(true)
      }
    }
  })

  const settingsMutation = useMutation({
    mutationFn: async (values: any) =>
      apiFetch<Project>(`/api/admin/mm/project/${projectId}`, {
        method: 'PUT',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify(values)
      }),
    onSuccess: async () => {
      message.success('Project settings saved')
      await refreshProjectWorkspace()
    }
  })

  const homeMutation = useMutation({
    mutationFn: async () => {
      if (homeId) {
        return apiFetch<ProjectHome>(`/api/admin/mm/home/${homeId}`, {
          method: 'PUT',
          headers: { 'Content-Type': 'application/json' },
          body: JSON.stringify({ content: homeContent, status: 1 })
        })
      }
      return apiFetch<ProjectHome>('/api/admin/mm/home', {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({ projectId, content: homeContent, status: 1 })
      })
    },
    onSuccess: async (result) => {
      message.success('Project home saved')
      setHomeId(result.id)
      await queryClient.invalidateQueries({ queryKey: ['admin-project-home', projectId] })
    }
  })

  const contentMutation = useMutation({
    mutationFn: async () => {
      if (!workspace.noteId) return null
      const payload = {
        versionNote: contentForm.versionNote || null,
        status: contentForm.status,
        isPrimary: contentForm.isPrimary,
        content: contentForm.content
      }
      if (!contentDraftMode && selectedContent) {
        return apiFetch<NoteContent>(`/api/admin/mm/noteContent/${selectedContent.id}`, {
          method: 'PUT',
          headers: { 'Content-Type': 'application/json' },
          body: JSON.stringify(payload)
        })
      }
      return apiFetch<NoteContent>('/api/admin/mm/noteContent', {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({ ...payload, noteInfoId: workspace.noteId })
      })
    },
    onSuccess: async (result) => {
      if (!result) return
      message.success(contentDraftMode ? 'Content version created' : 'Content version saved')
      setContentDraftMode(false)
      await queryClient.invalidateQueries({ queryKey: ['admin-note-contents', workspace.noteId] })
      await queryClient.invalidateQueries({ queryKey: ['admin-note-detail', workspace.noteId] })
      workspace.setQuery({ contentId: result.id, focus: 'note' })
    }
  })

  const archiveRecord = async ({
    title,
    content,
    request,
    invalidate
  }: {
    title: string
    content: string
    request: () => Promise<unknown>
    invalidate: () => Promise<void>
  }) => {
    await modal.confirm({
      title,
      content,
      okText: 'Archive',
      okButtonProps: { danger: true },
      cancelText: 'Cancel',
      onOk: async () => {
        await request()
        await invalidate()
      }
    })
  }

  const openCreateVersion = () => {
    versionForm.setFieldsValue({ version: '', description: '', weight: 0, status: 1 })
    setVersionDialog({ mode: 'create' })
  }

  const openEditVersion = (record: Version) => {
    versionForm.setFieldsValue(record)
    setVersionDialog({ mode: 'edit', record })
  }

  const openCreateCategory = () => {
    categoryForm.setFieldsValue({ categoryName: '', weight: 0, status: 1 })
    setCategoryDialog({ mode: 'create' })
  }

  const openEditCategory = (record: Category) => {
    categoryForm.setFieldsValue(record)
    setCategoryDialog({ mode: 'edit', record })
  }

  const openCreateNote = () => {
    noteForm.setFieldsValue({ noteTitle: '', weight: 0, status: 1 })
    setNoteDialog({ mode: 'create' })
  }

  const openEditNote = (record: NoteInfo) => {
    noteForm.setFieldsValue(record)
    setNoteDialog({ mode: 'edit', record })
  }

  const versionCountTag = <Tag color="blue">{versions.length} versions</Tag>
  const categoryCountTag = <Tag color="cyan">{categories.length} categories</Tag>
  const noteCountTag = <Tag color="geekblue">{notes.length} notes</Tag>

  if (projectQuery.isLoading) {
    return (
      <Flex align="center" justify="center" style={{ minHeight: '70vh' }}>
        <Spin size="large" />
      </Flex>
    )
  }

  const project = projectQuery.data
  if (!project) {
    return <Empty description="Project not found" />
  }

  const renderVersionPanel = () => (
    <Card
      title="Versions"
      extra={<Button type="primary" onClick={openCreateVersion}>New Version</Button>}
      styles={{ body: { padding: 0 } }}
    >
      {versionsQuery.isLoading ? <Flex justify="center" style={{ padding: 32 }}><Spin /></Flex> : null}
      {!versionsQuery.isLoading && versions.length === 0 ? (
        <Empty
          image={Empty.PRESENTED_IMAGE_SIMPLE}
          description="Start by creating the first version for this project."
          style={{ marginBlock: 32 }}
        >
          <Button type="primary" onClick={openCreateVersion}>Create First Version</Button>
        </Empty>
      ) : null}
      <List
        dataSource={versions}
        renderItem={(item) => (
          <List.Item
            style={{
              cursor: 'pointer',
              paddingInline: 16,
              background: workspace.versionId === item.id ? 'rgba(22, 119, 255, 0.08)' : undefined
            }}
            actions={[
              <a
                key="edit"
                onClick={(event) => {
                  event.preventDefault()
                  event.stopPropagation()
                  openEditVersion(item)
                }}
              >
                Edit
              </a>,
              <a
                key="archive"
                onClick={async (event) => {
                  event.preventDefault()
                  event.stopPropagation()
                  await archiveRecord({
                    title: 'Archive version',
                    content: `Archive ${item.version}? Related categories and notes stay intact but the version leaves the active workspace list.`,
                    request: () => apiFetch(`/api/admin/mm/projectVersion/${item.id}`, { method: 'DELETE' }),
                    invalidate: async () => {
                      message.success('Version moved to archive')
                      await refreshProjectWorkspace()
                      if (workspace.versionId === item.id) {
                        workspace.setQuery({
                          versionId: versions.find((entry) => entry.id !== item.id)?.id || null,
                          categoryId: null,
                          noteId: null,
                          contentId: null,
                          focus: 'version'
                        })
                      }
                    }
                  })
                }}
              >
                Archive
              </a>
            ]}
            onClick={() =>
              workspace.setQuery({
                versionId: item.id,
                categoryId: null,
                noteId: null,
                contentId: null,
                focus: 'version'
              })
            }
          >
            <List.Item.Meta
              title={
                <Space>
                  <span>{item.version}</span>
                  {renderStatusBadge(item.status)}
                </Space>
              }
              description={item.description || `Updated ${formatTime(item.updatedAt)}`}
            />
          </List.Item>
        )}
      />
    </Card>
  )

  const renderCategoryAndNotePanel = () => (
    <Flex vertical gap={16}>
      <Card
        title="Categories"
        extra={<Button disabled={!workspace.versionId} onClick={openCreateCategory}>New Category</Button>}
        styles={{ body: { padding: 0 } }}
      >
        {!workspace.versionId ? (
          <Empty image={Empty.PRESENTED_IMAGE_SIMPLE} description="Choose a version first." style={{ marginBlock: 32 }} />
        ) : categoriesQuery.isLoading ? (
          <Flex justify="center" style={{ padding: 32 }}><Spin /></Flex>
        ) : categories.length === 0 ? (
          <Empty
            image={Empty.PRESENTED_IMAGE_SIMPLE}
            description="No categories yet for the selected version."
            style={{ marginBlock: 32 }}
          >
            <Button type="primary" onClick={openCreateCategory}>Create Category</Button>
          </Empty>
        ) : (
          <List
            dataSource={categories}
            renderItem={(item) => (
              <List.Item
                style={{
                  cursor: 'pointer',
                  paddingInline: 16,
                  background: workspace.categoryId === item.id ? 'rgba(22, 119, 255, 0.08)' : undefined
                }}
                actions={[
                  <a
                    key="edit"
                    onClick={(event) => {
                      event.preventDefault()
                      event.stopPropagation()
                      openEditCategory(item)
                    }}
                  >
                    Edit
                  </a>,
                  <a
                    key="archive"
                    onClick={async (event) => {
                      event.preventDefault()
                      event.stopPropagation()
                      await archiveRecord({
                        title: 'Archive category',
                        content: `Archive ${item.categoryName}?`,
                        request: () => apiFetch(`/api/admin/mm/category/${item.id}`, { method: 'DELETE' }),
                        invalidate: async () => {
                          message.success('Category moved to archive')
                          await queryClient.invalidateQueries({ queryKey: ['admin-version-categories', workspace.versionId] })
                          if (workspace.categoryId === item.id) {
                            workspace.setQuery({
                              categoryId: categories.find((entry) => entry.id !== item.id)?.id || null,
                              noteId: null,
                              contentId: null,
                              focus: 'category'
                            })
                          }
                        }
                      })
                    }}
                  >
                    Archive
                  </a>
                ]}
                onClick={() =>
                  workspace.setQuery({
                    categoryId: item.id,
                    noteId: null,
                    contentId: null,
                    focus: 'category'
                  })
                }
              >
                <List.Item.Meta
                  title={
                    <Space>
                      <span>{item.categoryName}</span>
                      {renderStatusBadge(item.status)}
                    </Space>
                  }
                  description={`Updated ${formatTime(item.updatedAt)}`}
                />
              </List.Item>
            )}
          />
        )}
      </Card>

      <Card
        title="Notes"
        extra={<Button disabled={!workspace.categoryId} onClick={openCreateNote}>New Note</Button>}
        styles={{ body: { padding: 0 } }}
      >
        {!workspace.categoryId ? (
          <Empty image={Empty.PRESENTED_IMAGE_SIMPLE} description="Choose a category first." style={{ marginBlock: 32 }} />
        ) : notesQuery.isLoading ? (
          <Flex justify="center" style={{ padding: 32 }}><Spin /></Flex>
        ) : notes.length === 0 ? (
          <Empty image={Empty.PRESENTED_IMAGE_SIMPLE} description="No notes yet in this category." style={{ marginBlock: 32 }}>
            <Button type="primary" onClick={openCreateNote}>Create Note</Button>
          </Empty>
        ) : (
          <List
            dataSource={notes}
            renderItem={(item) => (
              <List.Item
                style={{
                  cursor: 'pointer',
                  paddingInline: 16,
                  background: workspace.noteId === item.id ? 'rgba(22, 119, 255, 0.08)' : undefined
                }}
                actions={[
                  <a
                    key="edit"
                    onClick={(event) => {
                      event.preventDefault()
                      event.stopPropagation()
                      openEditNote(item)
                    }}
                  >
                    Edit
                  </a>,
                  <a
                    key="archive"
                    onClick={async (event) => {
                      event.preventDefault()
                      event.stopPropagation()
                      await archiveRecord({
                        title: 'Archive note',
                        content: `Archive ${item.noteTitle}?`,
                        request: () => apiFetch(`/api/admin/mm/note/${item.id}`, { method: 'DELETE' }),
                        invalidate: async () => {
                          message.success('Note moved to archive')
                          await queryClient.invalidateQueries({
                            queryKey: ['admin-category-notes', workspace.categoryId, workspace.versionId, projectId]
                          })
                          if (workspace.noteId === item.id) {
                            workspace.setQuery({
                              noteId: notes.find((entry) => entry.id !== item.id)?.id || null,
                              contentId: null,
                              focus: 'note'
                            })
                          }
                        }
                      })
                    }}
                  >
                    Archive
                  </a>
                ]}
                onClick={() =>
                  workspace.setQuery({
                    noteId: item.id,
                    contentId: null,
                    focus: 'note'
                  })
                }
              >
                <List.Item.Meta
                  title={
                    <Space>
                      <span>{item.noteTitle}</span>
                      <Tag>{item.contentCount} versions</Tag>
                    </Space>
                  }
                  description={`Updated ${formatTime(item.updatedAt)}`}
                />
              </List.Item>
            )}
          />
        )}
      </Card>
    </Flex>
  )

  const renderContentDetail = () => {
    if (!workspace.versionId) {
      return (
        <Card style={{ minHeight: RIGHT_PANEL_MIN_HEIGHT }}>
          <Empty description="Create a version to start the content chain." />
        </Card>
      )
    }

    if (workspace.focus === 'version' || !workspace.categoryId) {
      return (
        <Card
          title={selectedVersion?.version || 'Version'}
          extra={
            <Space>
              <Button onClick={() => selectedVersion && openEditVersion(selectedVersion)} disabled={!selectedVersion}>
                Edit Version
              </Button>
              <Button type="primary" onClick={openCreateCategory}>New Category</Button>
            </Space>
          }
          style={{ minHeight: RIGHT_PANEL_MIN_HEIGHT }}
        >
          <Flex vertical gap={16}>
            <Space size={[8, 8]} wrap>
              {renderStatusBadge(selectedVersion?.status)}
              <Tag color="blue">Weight {selectedVersion?.weight ?? 0}</Tag>
              <Tag>Updated {formatTime(selectedVersion?.updatedAt)}</Tag>
            </Space>
            <Typography.Paragraph type="secondary">
              {selectedVersion?.description || 'Use this step to define the version before organizing categories and notes.'}
            </Typography.Paragraph>
            <Empty
              image={Empty.PRESENTED_IMAGE_SIMPLE}
              description="Select or create a category to continue building the document structure."
            />
          </Flex>
        </Card>
      )
    }

    if (workspace.focus === 'category' || !workspace.noteId) {
      return (
        <Card
          title={selectedCategory?.categoryName || 'Category'}
          extra={
            <Space>
              <Button onClick={() => selectedCategory && openEditCategory(selectedCategory)} disabled={!selectedCategory}>
                Edit Category
              </Button>
              <Button type="primary" onClick={openCreateNote}>New Note</Button>
            </Space>
          }
          style={{ minHeight: RIGHT_PANEL_MIN_HEIGHT }}
        >
          <Flex vertical gap={16}>
            <Space size={[8, 8]} wrap>
              {renderStatusBadge(selectedCategory?.status)}
              <Tag color="cyan">Weight {selectedCategory?.weight ?? 0}</Tag>
              <Tag>Updated {formatTime(selectedCategory?.updatedAt)}</Tag>
            </Space>
            <Typography.Paragraph type="secondary">
              {notes.length > 0
                ? 'Choose a note from the list or create another one in this category.'
                : 'This category is empty. Create the first note to continue the content chain.'}
            </Typography.Paragraph>
            <Empty image={Empty.PRESENTED_IMAGE_SIMPLE} description="Select or create a note to edit markdown content." />
          </Flex>
        </Card>
      )
    }

    return (
      <Flex vertical gap={16}>
        <Card
          title={selectedNote?.noteTitle || 'Note'}
          extra={
            <Space>
              <Button onClick={() => selectedNote && openEditNote(selectedNote)} disabled={!selectedNote}>
                Edit Note
              </Button>
              <Button
                onClick={() => {
                  setContentDraftMode(true)
                  workspace.setQuery({ contentId: null, focus: 'note' })
                }}
              >
                New Content Version
              </Button>
            </Space>
          }
        >
          <Space size={[8, 8]} wrap>
            {renderStatusBadge(selectedNote?.status)}
            <Tag color="geekblue">Weight {selectedNote?.weight ?? 0}</Tag>
            <Tag>{noteContents.length} content versions</Tag>
            <Tag>Updated {formatTime(selectedNote?.updatedAt)}</Tag>
          </Space>
        </Card>

        <Card
          title="Content Versions"
          extra={
            <Typography.Text type="secondary">
              Primary versions are shown to readers by default.
            </Typography.Text>
          }
          styles={{ body: { padding: 0 } }}
        >
          {noteContentsQuery.isLoading ? <Flex justify="center" style={{ padding: 32 }}><Spin /></Flex> : null}
          {!noteContentsQuery.isLoading && noteContents.length === 0 ? (
            <Empty image={Empty.PRESENTED_IMAGE_SIMPLE} description="No content versions yet. Save the first markdown version below." style={{ marginBlock: 32 }} />
          ) : (
            <List
              dataSource={noteContents}
              renderItem={(item) => (
                <List.Item
                  style={{
                    cursor: 'pointer',
                    paddingInline: 16,
                    background: !contentDraftMode && workspace.contentId === item.id ? 'rgba(22, 119, 255, 0.08)' : undefined
                  }}
                  actions={[
                    <a
                      key="select"
                      onClick={(event) => {
                        event.preventDefault()
                        event.stopPropagation()
                        setContentDraftMode(false)
                        workspace.setQuery({ contentId: item.id, focus: 'note' })
                      }}
                    >
                      Open
                    </a>,
                    <a
                      key="archive"
                      onClick={async (event) => {
                        event.preventDefault()
                        event.stopPropagation()
                        await archiveRecord({
                          title: 'Archive content version',
                          content: item.isPrimary
                            ? 'Archive this primary version? The latest valid version will become primary automatically.'
                            : 'Archive this content version?',
                          request: () => apiFetch(`/api/admin/mm/noteContent/${item.id}`, { method: 'DELETE' }),
                          invalidate: async () => {
                            message.success('Content version moved to archive')
                            await queryClient.invalidateQueries({ queryKey: ['admin-note-contents', workspace.noteId] })
                            if (workspace.contentId === item.id) {
                              setContentDraftMode(false)
                              workspace.setQuery({
                                contentId: noteContents.find((entry) => entry.id !== item.id)?.id || null
                              })
                            }
                          }
                        })
                      }}
                    >
                      Archive
                    </a>
                  ]}
                  onClick={() => {
                    setContentDraftMode(false)
                    workspace.setQuery({ contentId: item.id, focus: 'note' })
                  }}
                >
                  <List.Item.Meta
                    title={
                      <Space>
                        <span>{item.versionNote || 'Untitled version'}</span>
                        {item.isPrimary ? <Tag color="green">Primary</Tag> : null}
                        {renderStatusBadge(item.status)}
                      </Space>
                    }
                    description={`Updated ${formatTime(item.updatedAt)}`}
                  />
                </List.Item>
              )}
            />
          )}
        </Card>

        <Card
          title={contentDraftMode ? 'New Content Version' : selectedContent ? `Editing ${selectedContent.versionNote || 'Selected Version'}` : 'Content Editor'}
          style={{ minHeight: RIGHT_PANEL_MIN_HEIGHT - 180 }}
        >
          <Flex vertical gap={16}>
            <Flex gap={16} wrap>
              <div style={{ minWidth: 220 }}>
                <Typography.Text type="secondary">Version Note</Typography.Text>
                <Input
                  value={contentForm.versionNote}
                  onChange={(event) => setContentForm((prev) => ({ ...prev, versionNote: event.target.value }))}
                  placeholder="Describe this revision"
                />
              </div>
              <div style={{ minWidth: 180 }}>
                <Typography.Text type="secondary">Status</Typography.Text>
                <AdminStatusSelect
                  value={contentForm.status}
                  onChange={(value) => setContentForm((prev) => ({ ...prev, status: value }))}
                  style={{ width: '100%' }}
                />
              </div>
              <div style={{ minWidth: 160 }}>
                <Typography.Text type="secondary">Primary</Typography.Text>
                <div style={{ marginTop: 8 }}>
                  <Button
                    type={contentForm.isPrimary ? 'primary' : 'default'}
                    onClick={() => setContentForm((prev) => ({ ...prev, isPrimary: !prev.isPrimary }))}
                  >
                    {contentForm.isPrimary ? 'Primary Version' : 'Set as Primary'}
                  </Button>
                </div>
              </div>
            </Flex>
            <MarkdownEditor modelValue={contentForm.content} onChange={(value) => setContentForm((prev) => ({ ...prev, content: value }))} />
            <Flex justify="space-between" wrap="wrap" gap={12}>
              <Typography.Text type="secondary">
                {noteContents.length === 0
                  ? 'The first saved content version becomes primary automatically.'
                  : 'Create a new content version or keep editing the selected one.'}
              </Typography.Text>
              <Space>
                {contentDraftMode ? (
                  <Button
                    onClick={() => {
                      setContentDraftMode(false)
                      workspace.setQuery({ contentId: noteContents[0]?.id || null })
                    }}
                  >
                    Cancel Draft
                  </Button>
                ) : null}
                <Button type="primary" loading={contentMutation.isPending} onClick={() => contentMutation.mutate()}>
                  {contentDraftMode || !selectedContent ? 'Save Content Version' : 'Save Changes'}
                </Button>
              </Space>
            </Flex>
          </Flex>
        </Card>
      </Flex>
    )
  }

  return (
    <div>
      <AdminPageHeader
        title={project.projectName}
        description="Project workspace"
        extra={
          <Space size={[8, 8]} wrap>
            {renderStatusBadge(project.status)}
            {renderAuthTag(project.requireAuth)}
            {project.accessPriceSol ? <Tag color="gold">{project.accessPriceSol} SOL</Tag> : null}
            <Tag>Updated {formatTime(project.updatedAt)}</Tag>
          </Space>
        }
      />

      <Card style={{ marginBottom: 24 }}>
        <Space size={[8, 8]} wrap>
          {versionCountTag}
          {categoryCountTag}
          {noteCountTag}
          <Tag color="purple">Project ID {project.id}</Tag>
        </Space>
      </Card>

      <Tabs
        activeKey={workspace.tab}
        onChange={(nextTab) => workspace.setQuery({ tab: nextTab, focus: nextTab === 'content' ? workspace.focus || 'note' : null })}
        items={[
          {
            key: 'content',
            label: 'Content',
            children: (
              <div
                style={{
                  display: 'grid',
                  gridTemplateColumns: '300px 360px minmax(420px, 1fr)',
                  gap: 16,
                  alignItems: 'start'
                }}
              >
                {renderVersionPanel()}
                {renderCategoryAndNotePanel()}
                {renderContentDetail()}
              </div>
            )
          },
          {
            key: 'home',
            label: 'Home',
            children: (
              <Card
                title="Project Home"
                extra={
                  <Button type="primary" loading={homeMutation.isPending} onClick={() => homeMutation.mutate()}>
                    Save Home
                  </Button>
                }
              >
                {homeQuery.isLoading ? <Spin /> : null}
                <MarkdownEditor modelValue={homeContent} onChange={setHomeContent} />
              </Card>
            )
          },
          {
            key: 'settings',
            label: 'Settings',
            children: (
              <Card
                title="Project Settings"
                extra={
                  <Button type="primary" loading={settingsMutation.isPending} onClick={() => settingsForm.submit()}>
                    Save Settings
                  </Button>
                }
              >
                <Form form={settingsForm} layout="vertical" onFinish={(values) => settingsMutation.mutate(values)}>
                  <Form.Item name="projectName" label="Project Name" rules={[{ required: true }]}>
                    <Input />
                  </Form.Item>
                  <Form.Item name="avatar" label="Avatar URL">
                    <Input />
                  </Form.Item>
                  <Form.Item name="weight" label="Weight">
                    <InputNumber style={{ width: '100%' }} />
                  </Form.Item>
                  <Form.Item name="status" label="Status" rules={[{ required: true }]}>
                    <AdminStatusSelect style={{ width: '100%' }} />
                  </Form.Item>
                  <Form.Item name="requireAuth" label="Access Mode" rules={[{ required: true }]}>
                    <Select
                      options={[
                        { label: 'Public', value: false },
                        { label: 'Protected', value: true }
                      ]}
                    />
                  </Form.Item>
                  <Form.Item shouldUpdate noStyle>
                    {() => (
                      <Form.Item name="accessPriceSol" label="Access Price (SOL)">
                        <InputNumber
                          stringMode
                          min="0"
                          step="0.0001"
                          disabled={!settingsForm.getFieldValue('requireAuth')}
                          style={{ width: '100%' }}
                        />
                      </Form.Item>
                    )}
                  </Form.Item>
                </Form>
              </Card>
            )
          }
        ]}
      />

      <Modal
        open={Boolean(versionDialog)}
        title={versionDialog?.mode === 'edit' ? 'Edit Version' : 'New Version'}
        onCancel={() => setVersionDialog(null)}
        onOk={() => versionForm.submit()}
        confirmLoading={versionMutation.isPending}
      >
        <Form form={versionForm} layout="vertical" onFinish={(values) => versionMutation.mutate(values)}>
          <Form.Item name="version" label="Version" rules={[{ required: true }]}>
            <Input />
          </Form.Item>
          <Form.Item name="description" label="Description">
            <Input.TextArea rows={4} />
          </Form.Item>
          <Form.Item name="weight" label="Weight" initialValue={0}>
            <InputNumber style={{ width: '100%' }} />
          </Form.Item>
          <Form.Item name="status" label="Status" initialValue={1} rules={[{ required: true }]}>
            <AdminStatusSelect style={{ width: '100%' }} />
          </Form.Item>
        </Form>
      </Modal>

      <Modal
        open={Boolean(categoryDialog)}
        title={categoryDialog?.mode === 'edit' ? 'Edit Category' : 'New Category'}
        onCancel={() => setCategoryDialog(null)}
        onOk={() => categoryForm.submit()}
        confirmLoading={categoryMutation.isPending}
      >
        <Form form={categoryForm} layout="vertical" onFinish={(values) => categoryMutation.mutate(values)}>
          <Form.Item name="categoryName" label="Category Name" rules={[{ required: true }]}>
            <Input />
          </Form.Item>
          <Form.Item name="weight" label="Weight" initialValue={0}>
            <InputNumber style={{ width: '100%' }} />
          </Form.Item>
          <Form.Item name="status" label="Status" initialValue={1} rules={[{ required: true }]}>
            <AdminStatusSelect style={{ width: '100%' }} />
          </Form.Item>
        </Form>
      </Modal>

      <Modal
        open={Boolean(noteDialog)}
        title={noteDialog?.mode === 'edit' ? 'Edit Note' : 'New Note'}
        onCancel={() => setNoteDialog(null)}
        onOk={() => noteForm.submit()}
        confirmLoading={noteMutation.isPending}
      >
        <Form form={noteForm} layout="vertical" onFinish={(values) => noteMutation.mutate(values)}>
          <Form.Item name="noteTitle" label="Note Title" rules={[{ required: true }]}>
            <Input />
          </Form.Item>
          <Form.Item name="weight" label="Weight" initialValue={0}>
            <InputNumber style={{ width: '100%' }} />
          </Form.Item>
          <Form.Item name="status" label="Status" initialValue={1} rules={[{ required: true }]}>
            <AdminStatusSelect style={{ width: '100%' }} />
          </Form.Item>
        </Form>
      </Modal>
    </div>
  )
}
