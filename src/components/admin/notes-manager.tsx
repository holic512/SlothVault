'use client'

/**
 * @file notes-manager.tsx
 * @project SlothVault
 * @module Note Administration
 * @description Replaces the Nuxt note table with a project/version/category-aware Ant Design workflow.
 * @logic Resolve route-backed filters, query paginated notes, and coordinate create, edit, restore, delete, and content-editor navigation.
 * @dependencies Ant Design, React Query, Next navigation, next-intl, api-client
 * @index_tags admin,notes,filters,crud,content-navigation
 * @author holic512
 */
import { useState } from 'react'

import { useMutation, useQuery, useQueryClient } from '@tanstack/react-query'
import {
  App,
  Button,
  Form,
  Input,
  InputNumber,
  Modal,
  Select,
  Space,
  Switch,
  Table,
  Tag,
  Typography,
} from 'antd'
import type { ColumnsType } from 'antd/es/table'
import { FilePenLine, Plus, RefreshCw, RotateCcw, Trash2 } from 'lucide-react'
import { useTranslations } from 'next-intl'
import { useRouter, useSearchParams } from 'next/navigation'

import { apiFetch } from '@/lib/api-client'

type ProjectDto = { id: string; projectName: string }
type VersionDto = { id: string; projectId: string; version: string }
type CategoryDto = { id: string; projectVersionId: string; categoryName: string }
type NoteDto = {
  id: string
  categoryId: string
  noteTitle: string
  weight: number
  status: number
  createdAt: string
  updatedAt: string
  isDeleted: boolean
  contentCount: number
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
type NoteListData = { list: NoteDto[]; page: number; pageSize: number; total: number }
type NoteForm = { noteTitle: string; weight: number; status: number }

export function NotesManager() {
  const t = useTranslations('AdminMM.notes')
  const router = useRouter()
  const searchParams = useSearchParams()
  const queryClient = useQueryClient()
  const { message, modal } = App.useApp()
  const [form] = Form.useForm<NoteForm>()

  const routeProjectId = searchParams.get('projectId') || ''
  const routeVersionId = searchParams.get('versionId') || ''
  const routeCategoryId = searchParams.get('categoryId') || ''
  const [projectId, setProjectId] = useState(routeProjectId)
  const [versionId, setVersionId] = useState(routeVersionId)
  const [categoryId, setCategoryId] = useState(routeCategoryId)
  const [keyword, setKeyword] = useState('')
  const [status, setStatus] = useState<string>()
  const [includeDeleted, setIncludeDeleted] = useState(false)
  const [page, setPage] = useState(1)
  const [pageSize, setPageSize] = useState(20)
  const [editing, setEditing] = useState<NoteDto | null>(null)
  const [formOpen, setFormOpen] = useState(false)

  const projectsQuery = useQuery({
    queryKey: ['admin-note-project-options'],
    queryFn: () => apiFetch<{ list: ProjectDto[] }>('/api/admin/mm/project?pageSize=100'),
  })
  const versionsQuery = useQuery({
    queryKey: ['admin-note-version-options', projectId],
    enabled: Boolean(projectId),
    queryFn: () =>
      apiFetch<{ list: VersionDto[] }>(
        `/api/admin/mm/projectVersion/byProject/${projectId}?pageSize=100`,
      ),
  })
  const categoriesQuery = useQuery({
    queryKey: ['admin-note-category-options', versionId],
    enabled: Boolean(versionId),
    queryFn: () =>
      apiFetch<{ list: CategoryDto[] }>(
        `/api/admin/mm/category/byProjectVersion/${versionId}?pageSize=100`,
      ),
  })

  const listQuery = useQuery({
    queryKey: [
      'admin-notes',
      projectId,
      versionId,
      categoryId,
      keyword,
      status,
      includeDeleted,
      page,
      pageSize,
    ],
    queryFn: () => {
      const params = new URLSearchParams({ page: String(page), pageSize: String(pageSize) })
      if (projectId) params.set('projectId', projectId)
      if (versionId) params.set('projectVersionId', versionId)
      if (categoryId) params.set('categoryId', categoryId)
      if (keyword) params.set('keyword', keyword)
      if (status) params.set('status', status)
      if (includeDeleted) params.set('includeDeleted', '1')
      return apiFetch<NoteListData>(`/api/admin/mm/note?${params}`)
    },
  })

  const refresh = () => queryClient.invalidateQueries({ queryKey: ['admin-notes'] })
  const save = useMutation({
    mutationFn: (values: NoteForm) => {
      if (!editing && !categoryId) throw new Error(t('messages.selectCategoryFirst'))
      return apiFetch<NoteDto>(editing ? `/api/admin/mm/note/${editing.id}` : '/api/admin/mm/note', {
        method: editing ? 'PUT' : 'POST',
        body: JSON.stringify({ ...values, ...(editing ? {} : { categoryId }) }),
      })
    },
    onSuccess: async () => {
      message.success(editing ? t('messages.saveSuccess') : t('messages.createSuccess'))
      setFormOpen(false)
      setEditing(null)
      form.resetFields()
      await refresh()
    },
    onError: (error) => message.error(error.message),
  })

  const openForm = (note?: NoteDto) => {
    if (!note && !categoryId) {
      message.warning(t('messages.selectCategoryFirst'))
      return
    }
    setEditing(note || null)
    form.setFieldsValue(
      note
        ? { noteTitle: note.noteTitle, weight: note.weight, status: note.status }
        : { noteTitle: '', weight: 0, status: 1 },
    )
    setFormOpen(true)
  }

  const remove = (note: NoteDto) => {
    modal.confirm({
      title: t('messages.deleteConfirmTitle'),
      content: t('messages.deleteConfirm', { name: note.noteTitle }),
      okText: t('messages.deleteButton'),
      okButtonProps: { danger: true },
      cancelText: t('messages.cancelButton'),
      onOk: async () => {
        await apiFetch(`/api/admin/mm/note/${note.id}`, { method: 'DELETE' })
        message.success(t('messages.deleted'))
        await refresh()
      },
    })
  }

  const restore = async (note: NoteDto) => {
    await apiFetch(`/api/admin/mm/note/${note.id}`, {
      method: 'PUT',
      body: JSON.stringify({ isDeleted: false, status: 1 }),
    })
    message.success(t('messages.restored'))
    await refresh()
  }

  const reset = () => {
    setProjectId('')
    setVersionId('')
    setCategoryId('')
    setKeyword('')
    setStatus(undefined)
    setIncludeDeleted(false)
    setPage(1)
    router.replace('/admin/mm/notes')
  }

  const columns: ColumnsType<NoteDto> = [
    { title: t('table.noteTitle'), dataIndex: 'noteTitle', minWidth: 210 },
    {
      title: t('table.path'),
      minWidth: 270,
      render: (_value, row) => {
        const path = [
          row.category?.projectVersion?.project?.projectName,
          row.category?.projectVersion?.version,
          row.category?.categoryName,
        ].filter(Boolean)
        return <Typography.Text type="secondary">{path.join(' / ') || '-'}</Typography.Text>
      },
    },
    { title: t('table.weight'), dataIndex: 'weight', width: 82, align: 'center' },
    {
      title: t('table.contentVersion'),
      dataIndex: 'contentCount',
      width: 110,
      align: 'center',
      render: (value) => <Tag color={value ? 'blue' : undefined}>{value}</Tag>,
    },
    {
      title: t('table.status'),
      width: 100,
      render: (_value, row) =>
        row.isDeleted ? (
          <Tag>{t('statusTag.deleted')}</Tag>
        ) : row.status === 1 ? (
          <Tag color="success">{t('statusTag.enabled')}</Tag>
        ) : (
          <Tag color="warning">{t('statusTag.disabled')}</Tag>
        ),
    },
    {
      title: t('table.updatedAt'),
      dataIndex: 'updatedAt',
      width: 170,
      render: (value) => new Date(value).toLocaleString(),
    },
    {
      title: t('table.operations'),
      fixed: 'right',
      width: 270,
      render: (_value, row) => (
        <Space size={2}>
          <Button
            type="link"
            icon={<FilePenLine size={14} />}
            disabled={row.isDeleted}
            onClick={() => router.push(`/admin/mm/notes/${row.id}/content`)}
          >
            {t('operations.contentEdit')}
          </Button>
          <Button type="link" disabled={row.isDeleted} onClick={() => openForm(row)}>
            {t('operations.edit')}
          </Button>
          {row.isDeleted ? (
            <Button type="link" icon={<RotateCcw size={14} />} onClick={() => void restore(row)}>
              {t('operations.restore')}
            </Button>
          ) : (
            <Button type="link" danger icon={<Trash2 size={14} />} onClick={() => remove(row)}>
              {t('operations.delete')}
            </Button>
          )}
        </Space>
      ),
    },
  ]

  return (
    <div className="admin-page-stack">
      <div className="admin-page-heading">
        <div>
          <Typography.Title level={2}>{t('title')}</Typography.Title>
          <Typography.Paragraph type="secondary">{t('desc')}</Typography.Paragraph>
        </div>
        <Space>
          <Button icon={<RefreshCw size={15} />} onClick={() => void refresh()}>
            {t('actions.search')}
          </Button>
          <Button type="primary" icon={<Plus size={15} />} onClick={() => openForm()}>
            {t('actions.create')}
          </Button>
        </Space>
      </div>

      <div className="admin-toolbar-card">
        <div className="admin-filters admin-filters--notes">
          <Select
            allowClear
            showSearch
            value={projectId || undefined}
            placeholder={t('filters.selectProject')}
            optionFilterProp="label"
            options={(projectsQuery.data?.list || []).map((project) => ({ label: project.projectName, value: project.id }))}
            onChange={(value) => {
              setProjectId(value || '')
              setVersionId('')
              setCategoryId('')
              setPage(1)
            }}
          />
          <Select
            allowClear
            showSearch
            disabled={!projectId}
            value={versionId || undefined}
            placeholder={t('filters.selectVersion')}
            optionFilterProp="label"
            options={(versionsQuery.data?.list || []).map((version) => ({ label: version.version, value: version.id }))}
            onChange={(value) => {
              setVersionId(value || '')
              setCategoryId('')
              setPage(1)
            }}
          />
          <Select
            allowClear
            showSearch
            disabled={!versionId}
            value={categoryId || undefined}
            placeholder={t('filters.selectCategory')}
            optionFilterProp="label"
            options={(categoriesQuery.data?.list || []).map((category) => ({ label: category.categoryName, value: category.id }))}
            onChange={(value) => {
              setCategoryId(value || '')
              setPage(1)
            }}
          />
          <Input.Search
            allowClear
            value={keyword}
            placeholder={t('filters.keyword')}
            onChange={(event) => setKeyword(event.target.value)}
            onSearch={() => setPage(1)}
          />
          <Select
            allowClear
            value={status}
            placeholder={t('filters.status')}
            options={[
              { label: t('status.enabled'), value: '1' },
              { label: t('status.disabled'), value: '0' },
            ]}
            onChange={(value) => {
              setStatus(value)
              setPage(1)
            }}
          />
          <label className="admin-switch-label">
            <Switch
              checked={includeDeleted}
              onChange={(value) => {
                setIncludeDeleted(value)
                setPage(1)
              }}
            />
            {t('filters.includeDeleted')}
          </label>
        </div>
        <Button onClick={reset}>{t('actions.reset')}</Button>
      </div>

      <div className="admin-table-card">
        <Table
          rowKey="id"
          scroll={{ x: 1200 }}
          loading={listQuery.isLoading}
          dataSource={listQuery.data?.list || []}
          columns={columns}
          pagination={{
            current: page,
            pageSize,
            total: listQuery.data?.total || 0,
            showSizeChanger: true,
            onChange: (nextPage, nextPageSize) => {
              setPage(nextPage)
              setPageSize(nextPageSize)
            },
          }}
        />
      </div>

      <Modal
        open={formOpen}
        title={editing ? t('dialog.editTitle') : t('dialog.createTitle')}
        okText={t('dialog.save')}
        cancelText={t('dialog.cancel')}
        confirmLoading={save.isPending}
        onCancel={() => setFormOpen(false)}
        onOk={() => form.submit()}
      >
        <Form form={form} layout="vertical" onFinish={(values) => save.mutate(values)}>
          <Form.Item
            name="noteTitle"
            label={t('dialog.noteTitle')}
            rules={[{ required: true, message: t('validation.noteTitleRequired') }]}
          >
            <Input maxLength={255} showCount />
          </Form.Item>
          <div className="admin-form-grid">
            <Form.Item name="weight" label={t('dialog.weight')}>
              <InputNumber min={0} max={999999} className="full-width" />
            </Form.Item>
            <Form.Item name="status" label={t('dialog.status')}>
              <Select
                options={[
                  { label: t('status.enabled'), value: 1 },
                  { label: t('status.disabled'), value: 0 },
                ]}
              />
            </Form.Item>
          </div>
        </Form>
      </Modal>
    </div>
  )
}
