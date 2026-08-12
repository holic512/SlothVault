'use client'

/**
 * @file categories-manager.tsx
 * @project SlothVault
 * @module Category Administration
 * @description Provides a project/version-aware Ant Design category administration table.
 * @logic Keep route-selected versions synchronized with filters, fetch the appropriate endpoint, and run create/update/delete/restore mutations.
 * @dependencies Ant Design, React Query, Next navigation, api-client
 * @index_tags admin,categories,versions,crud
 * @author holic512
 */
import { useEffect, useState } from 'react'

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
} from 'antd'
import type { ColumnsType } from 'antd/es/table'
import { NotebookTabs, Plus, RefreshCw, RotateCcw, Trash2 } from 'lucide-react'
import { useTranslations } from 'next-intl'
import { useRouter, useSearchParams } from 'next/navigation'

import { AdminPage, AdminPageActions } from '@/components/admin/admin-page'
import { apiFetch } from '@/lib/api-client'

type ProjectDto = { id: string; projectName: string }
type VersionDto = { id: string; projectId: string; version: string; description: string | null; weight: number; status: number }
type CategoryDto = {
  id: string
  projectVersionId: string
  categoryName: string
  weight: number
  status: number
  createdAt: string
  updatedAt: string
  isDeleted: boolean
  projectVersion?: {
    id: string
    version: string
    projectId: string
    project?: { id: string; projectName: string } | null
  } | null
}
type CategoryListData = { list: CategoryDto[]; page: number; pageSize: number; total: number; projectVersion?: VersionDto }
type CategoryForm = { categoryName: string; weight: number; status: number }

export function CategoriesManager() {
  const t = useTranslations('AdminMM.categories')
  const router = useRouter()
  const searchParams = useSearchParams()
  const queryClient = useQueryClient()
  const { message, modal } = App.useApp()
  const [form] = Form.useForm<CategoryForm>()
  const [projectId, setProjectId] = useState('')
  const [versionId, setVersionId] = useState(searchParams.get('versionId') || '')
  const [keyword, setKeyword] = useState('')
  const [status, setStatus] = useState<string>()
  const [includeDeleted, setIncludeDeleted] = useState(false)
  const [page, setPage] = useState(1)
  const [pageSize, setPageSize] = useState(20)
  const [editing, setEditing] = useState<CategoryDto | null>(null)
  const [formOpen, setFormOpen] = useState(false)

  const projectsQuery = useQuery({
    queryKey: ['admin-project-options'],
    queryFn: () => apiFetch<{ list: ProjectDto[] }>('/api/admin/mm/project?pageSize=100'),
  })
  const versionsQuery = useQuery({
    queryKey: ['admin-version-options', projectId],
    enabled: Boolean(projectId),
    queryFn: () => apiFetch<{ list: VersionDto[] }>(`/api/admin/mm/projectVersion/byProject/${projectId}?pageSize=100`),
  })

  useEffect(() => {
    const selectedVersion = searchParams.get('versionId')
    if (!selectedVersion) return
    void apiFetch<CategoryListData>(`/api/admin/mm/category/byProjectVersion/${selectedVersion}?pageSize=1&includeProjectVersionInfo=1`)
      .then((data) => {
        if (data.projectVersion) {
          setProjectId(data.projectVersion.projectId)
          setVersionId(data.projectVersion.id)
        }
      })
      .catch(() => undefined)
  }, [searchParams])

  const listQuery = useQuery({
    queryKey: ['admin-categories', projectId, versionId, keyword, status, includeDeleted, page, pageSize],
    queryFn: () => {
      const params = new URLSearchParams({
        page: String(page),
        pageSize: String(pageSize),
        includeProjectVersion: '1',
      })
      if (keyword) params.set('keyword', keyword)
      if (status) params.set('status', status)
      if (includeDeleted) params.set('includeDeleted', '1')
      if (projectId && !versionId) params.set('projectId', projectId)
      const base = versionId
        ? `/api/admin/mm/category/byProjectVersion/${versionId}`
        : '/api/admin/mm/category'
      return apiFetch<CategoryListData>(`${base}?${params}`)
    },
  })

  const refresh = () => queryClient.invalidateQueries({ queryKey: ['admin-categories'] })
  const save = useMutation({
    mutationFn: (values: CategoryForm) => {
      if (!editing && !versionId) throw new Error(t('messages.selectVersionFirst'))
      return apiFetch<CategoryDto>(editing ? `/api/admin/mm/category/${editing.id}` : '/api/admin/mm/category', {
        method: editing ? 'PUT' : 'POST',
        body: JSON.stringify({ ...values, ...(editing ? {} : { projectVersionId: versionId }) }),
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

  const openForm = (category?: CategoryDto) => {
    if (!category && !versionId) return message.warning(t('messages.selectVersionFirst'))
    setEditing(category || null)
    form.setFieldsValue(
      category
        ? { categoryName: category.categoryName, weight: category.weight, status: category.status }
        : { categoryName: '', weight: 0, status: 1 },
    )
    setFormOpen(true)
  }

  const remove = (category: CategoryDto) => {
    modal.confirm({
      title: t('messages.deleteConfirmTitle'),
      content: t('messages.deleteConfirm', { name: category.categoryName }),
      okText: t('messages.deleteButton'),
      okButtonProps: { danger: true },
      cancelText: t('messages.cancelButton'),
      onOk: async () => {
        await apiFetch(`/api/admin/mm/category/${category.id}`, { method: 'DELETE' })
        message.success(t('messages.deleted'))
        await refresh()
      },
    })
  }

  const restore = async (category: CategoryDto) => {
    await apiFetch(`/api/admin/mm/category/${category.id}`, {
      method: 'PUT',
      body: JSON.stringify({ isDeleted: false, status: 1 }),
    })
    message.success(t('messages.restored'))
    await refresh()
  }

  const columns: ColumnsType<CategoryDto> = [
      { title: t('table.categoryName'), dataIndex: 'categoryName', minWidth: 190 },
      {
        title: t('table.project'),
        width: 160,
        render: (_value, row) => row.projectVersion?.project?.projectName || '-',
      },
      { title: t('table.version'), width: 110, render: (_value, row) => row.projectVersion?.version || '-' },
      { title: t('table.weight'), dataIndex: 'weight', width: 85, align: 'center' },
      {
        title: t('table.status'),
        width: 100,
        render: (_value, row) =>
          row.isDeleted ? <Tag>{t('statusTag.deleted')}</Tag> : row.status === 1 ? <Tag color="success">{t('statusTag.enabled')}</Tag> : <Tag color="warning">{t('statusTag.disabled')}</Tag>,
      },
      { title: t('table.updatedAt'), dataIndex: 'updatedAt', width: 170, render: (value) => new Date(value).toLocaleString() },
      {
        title: t('table.operations'),
        fixed: 'right',
        width: 260,
        render: (_value, row) => (
          <Space size={2}>
            <Button type="link" icon={<NotebookTabs size={14} />} onClick={() => router.push(`/admin/mm/notes?categoryId=${row.id}`)}>{t('operations.noteManage')}</Button>
            <Button type="link" onClick={() => openForm(row)}>{t('operations.edit')}</Button>
            {row.isDeleted ? (
              <Button type="link" icon={<RotateCcw size={14} />} onClick={() => void restore(row)}>{t('operations.restore')}</Button>
            ) : (
              <Button type="link" danger icon={<Trash2 size={14} />} onClick={() => remove(row)}>{t('operations.delete')}</Button>
            )}
          </Space>
        ),
      },
    ]

  return (
    <AdminPage>
      <AdminPageActions>
        <Space>
          <Button icon={<RefreshCw size={15} />} onClick={() => void refresh()}>{t('actions.search')}</Button>
          <Button type="primary" icon={<Plus size={15} />} onClick={() => openForm()}>{t('actions.create')}</Button>
        </Space>
      </AdminPageActions>

      <div className="admin-toolbar-card">
        <div className="admin-filters admin-filters--wide">
          <Select
            allowClear
            showSearch
            value={projectId || undefined}
            placeholder={t('filters.selectProject')}
            optionFilterProp="label"
            options={(projectsQuery.data?.list || []).map((project) => ({ label: project.projectName, value: project.id }))}
            onChange={(value) => { setProjectId(value || ''); setVersionId(''); setPage(1) }}
          />
          <Select
            allowClear
            showSearch
            disabled={!projectId}
            value={versionId || undefined}
            placeholder={t('filters.selectVersion')}
            optionFilterProp="label"
            options={(versionsQuery.data?.list || []).map((version) => ({ label: version.version, value: version.id }))}
            onChange={(value) => { setVersionId(value || ''); setPage(1) }}
          />
          <Input.Search allowClear value={keyword} placeholder={t('filters.keyword')} onChange={(event) => setKeyword(event.target.value)} onSearch={() => setPage(1)} />
          <Select allowClear value={status} placeholder={t('filters.status')} options={[{ label: t('status.enabled'), value: '1' }, { label: t('status.disabled'), value: '0' }]} onChange={(value) => { setStatus(value); setPage(1) }} />
          <label className="admin-switch-label"><Switch checked={includeDeleted} onChange={(value) => { setIncludeDeleted(value); setPage(1) }} />{t('filters.includeDeleted')}</label>
        </div>
      </div>

      <div className="admin-table-card">
        <Table
          rowKey="id"
          scroll={{ x: 1050 }}
          loading={listQuery.isLoading}
          dataSource={listQuery.data?.list || []}
          columns={columns}
          pagination={{ current: page, pageSize, total: listQuery.data?.total || 0, showSizeChanger: true, onChange: (nextPage, nextPageSize) => { setPage(nextPage); setPageSize(nextPageSize) } }}
        />
      </div>

      <Modal open={formOpen} title={editing ? t('dialog.editTitle') : t('dialog.createTitle')} okText={t('dialog.save')} cancelText={t('dialog.cancel')} confirmLoading={save.isPending} onCancel={() => setFormOpen(false)} onOk={() => form.submit()}>
        <Form form={form} layout="vertical" onFinish={(values) => save.mutate(values)}>
          <Form.Item name="categoryName" label={t('dialog.categoryName')} rules={[{ required: true, message: t('validation.categoryNameRequired') }]}><Input /></Form.Item>
          <div className="admin-form-grid">
            <Form.Item name="weight" label={t('dialog.weight')}><InputNumber min={0} className="full-width" /></Form.Item>
            <Form.Item name="status" label={t('dialog.status')}><Select options={[{ label: t('status.enabled'), value: 1 }, { label: t('status.disabled'), value: 0 }]} /></Form.Item>
          </div>
        </Form>
      </Modal>
    </AdminPage>
  )
}
