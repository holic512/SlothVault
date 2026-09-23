'use client'

/**
 * @file projects-manager.tsx
 * @project SlothVault
 * @module Project Administration
 * @description Provides administrator-only project management and the unified content-editor entry point.
 * @logic Query projects, edit metadata, manage availability, and navigate to the version-aware content workspace.
 * @dependencies Ant Design, React Query, next-intl, api-client
 * @index_tags admin,projects,crud
 * @author holic512
 */
import { useState } from 'react'

import { useMutation, useQuery, useQueryClient } from '@tanstack/react-query'
import {
  App,
  Avatar,
  Button,
  Dropdown,
  Form,
  Input,
  InputNumber,
  Modal,
  Select,
  Space,
  Switch,
  Table,
  Tag,
  Upload,
} from 'antd'
import type { ColumnsType } from 'antd/es/table'
import { BookOpenText, Ellipsis, Home, ImageUp, Import, Plus, RefreshCw, RotateCcw, Trash2 } from 'lucide-react'
import { useLocale, useTranslations } from 'next-intl'
import { useRouter } from 'next/navigation'

import { formatAdminDate, formatAdminError } from '@/lib/admin-localization'
import { apiFetch } from '@/lib/api-client'
import { AdminPage, AdminPageActions } from '@/components/admin/admin-page'
import { ProjectMenuManager } from '@/components/admin/project-menu-manager'

type ProjectDto = {
  id: string
  projectName: string
  avatar: string | null
  weight: number
  status: number
  createdAt: string
  updatedAt: string
  isDeleted: boolean
  latestVersion: string | null
  latestVersionId: string | null
  categoryCount: number
}

type ProjectListData = { list: ProjectDto[]; page: number; pageSize: number; total: number }
type ProjectForm = Pick<ProjectDto, 'projectName' | 'weight' | 'status'> & { avatar?: string }

export function ProjectsManager() {
  const t = useTranslations('AdminMM.projects')
  const errorT = useTranslations('AdminMM.errors')
  const locale = useLocale()
  const router = useRouter()
  const queryClient = useQueryClient()
  const { message, modal } = App.useApp()
  const [form] = Form.useForm<ProjectForm>()
  const [page, setPage] = useState(1)
  const [pageSize, setPageSize] = useState(20)
  const [keyword, setKeyword] = useState('')
  const [status, setStatus] = useState<string>()
  const [includeDeleted, setIncludeDeleted] = useState(false)
  const [selectedIds, setSelectedIds] = useState<React.Key[]>([])
  const [editing, setEditing] = useState<ProjectDto | null>(null)
  const [formOpen, setFormOpen] = useState(false)
  const [menuProject, setMenuProject] = useState<ProjectDto | null>(null)
  const [uploadingAvatar, setUploadingAvatar] = useState(false)

  const listQuery = useQuery({
    queryKey: ['admin-projects', page, pageSize, keyword, status, includeDeleted],
    queryFn: () => {
      const params = new URLSearchParams({ page: String(page), pageSize: String(pageSize) })
      if (keyword) params.set('keyword', keyword)
      if (status) params.set('status', status)
      if (includeDeleted) params.set('includeDeleted', '1')
      return apiFetch<ProjectListData>(`/api/admin/mm/project?${params}`)
    },
  })

  const refresh = () => queryClient.invalidateQueries({ queryKey: ['admin-projects'] })
  const saveMutation = useMutation({
    mutationFn: (values: ProjectForm) =>
      apiFetch<ProjectDto>(editing ? `/api/admin/mm/project/${editing.id}` : '/api/admin/mm/project', {
        method: editing ? 'PUT' : 'POST',
        body: JSON.stringify({ ...values, avatar: values.avatar || null }),
      }),
    onSuccess: async () => {
      message.success(editing ? t('messages.saveSuccess') : t('messages.createSuccess'))
      setFormOpen(false)
      setEditing(null)
      form.resetFields()
      await refresh()
    },
    onError: (error) => message.error(formatAdminError(error, errorT)),
  })

  const batchMutation = useMutation({
    mutationFn: (payload: { action: string; ids: string[]; status?: number }) =>
      apiFetch<{ count: number }>('/api/admin/mm/project/batch', {
        method: 'POST',
        body: JSON.stringify(payload),
      }),
    onSuccess: async (data) => {
      message.success(t('messages.batchUpdated', { count: data.count }))
      setSelectedIds([])
      await refresh()
    },
    onError: (error) => message.error(formatAdminError(error, errorT)),
  })

  const openCreate = () => {
    setEditing(null)
    form.setFieldsValue({ projectName: '', avatar: '', weight: 0, status: 1 })
    setFormOpen(true)
  }
  const openEdit = (project: ProjectDto) => {
    setEditing(project)
    form.setFieldsValue({
      projectName: project.projectName,
      avatar: project.avatar || '',
      weight: project.weight,
      status: project.status,
    })
    setFormOpen(true)
  }

  const confirmDelete = (project: ProjectDto) => {
    modal.confirm({
      title: t('messages.deleteConfirmTitle'),
      content: t('messages.deleteConfirm', { name: project.projectName }),
      okText: t('messages.deleteButton'),
      okButtonProps: { danger: true },
      cancelText: t('messages.cancelButton'),
      onOk: async () => {
        await apiFetch(`/api/admin/mm/project/${project.id}`, { method: 'DELETE' })
        message.success(t('messages.deleted'))
        await refresh()
      },
    })
  }

  const runBatch = (action: string, extra: { status?: number } = {}) => {
    const ids = selectedIds.map(String)
    if (!ids.length) return message.warning(t('messages.selectFirst'))
    batchMutation.mutate({ action, ids, ...extra })
  }

  const uploadAvatar = async (file: File) => {
    const formData = new FormData()
    formData.append('file', file)
    setUploadingAvatar(true)
    try {
      const uploaded = await apiFetch<{ url: string }>('/api/admin/mm/project/avatar', {
        method: 'POST',
        body: formData,
      })
      form.setFieldValue('avatar', uploaded.url)
      message.success(t('messages.saveSuccess'))
    } catch (error) {
      message.error(formatAdminError(error, errorT))
    } finally {
      setUploadingAvatar(false)
    }
  }

  const columns: ColumnsType<ProjectDto> = [
      {
        title: t('table.avatar'),
        dataIndex: 'avatar',
        width: 72,
        render: (_value, row) => (
          <Avatar src={row.avatar || undefined}>{row.projectName.charAt(0)}</Avatar>
        ),
      },
      { title: t('table.projectName'), dataIndex: 'projectName', minWidth: 190 },
      { title: t('table.weight'), dataIndex: 'weight', width: 82, align: 'center' },
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
        title: t('table.latestVersion'),
        dataIndex: 'latestVersion',
        width: 120,
        render: (value) => (value ? <Tag color="blue">{value}</Tag> : '-'),
      },
      { title: t('table.categoryCount'), dataIndex: 'categoryCount', width: 92, align: 'center' },
      {
        title: t('table.updatedAt'),
        dataIndex: 'updatedAt',
        width: 170,
        render: (value) => formatAdminDate(locale, value),
      },
      {
        title: t('table.operations'),
        fixed: 'right',
        width: 128,
        render: (_value, row) => (
          <Space size={4}>
            <Button type="link" onClick={() => openEdit(row)}>{t('operations.edit')}</Button>
            <Dropdown
              menu={{
                items: [
                  { key: 'menu', icon: <Ellipsis size={14} />, label: t('operations.menuConfig'), onClick: () => setMenuProject(row) },
                  { key: 'home', icon: <Home size={14} />, label: t('operations.homeEdit'), onClick: () => router.push(`/admin/mm/projects/${row.id}/home`) },
                  { key: 'content', icon: <BookOpenText size={14} />, label: t('operations.contentEdit'), onClick: () => router.push(`/admin/mm/notes?projectId=${row.id}${row.latestVersionId ? `&versionId=${row.latestVersionId}` : ''}`) },
                  { type: 'divider' },
                  row.isDeleted
                    ? { key: 'restore', icon: <RotateCcw size={14} />, label: t('operations.restore'), onClick: () => batchMutation.mutate({ action: 'restore', ids: [row.id] }) }
                    : { key: 'delete', danger: true, icon: <Trash2 size={14} />, label: t('operations.delete'), onClick: () => confirmDelete(row) },
                ],
              }}
            >
              <Button icon={<Ellipsis size={16} />} />
            </Dropdown>
          </Space>
        ),
      },
    ]

  return (
    <AdminPage>
      <AdminPageActions>
        <Space>
          <Button icon={<RefreshCw size={15} />} onClick={() => void refresh()}>{t('actions.search')}</Button>
          <Button icon={<Import size={15} />} onClick={() => router.push('/admin/mm/import')}>{t('actions.importKnowledge')}</Button>
          <Button type="primary" icon={<Plus size={15} />} onClick={openCreate}>{t('actions.create')}</Button>
        </Space>
      </AdminPageActions>

      <div className="admin-toolbar-card">
        <div className="admin-filters">
          <Input.Search
            allowClear
            value={keyword}
            placeholder={t('filters.keyword')}
            onChange={(event) => setKeyword(event.target.value)}
            onSearch={() => setPage(1)}
          />
          <Select allowClear value={status} placeholder={t('filters.status')} onChange={(value) => { setStatus(value); setPage(1) }} options={[{ label: t('status.enabled'), value: '1' }, { label: t('status.disabled'), value: '0' }]} />
          <label className="admin-switch-label"><Switch checked={includeDeleted} onChange={(value) => { setIncludeDeleted(value); setPage(1) }} />{t('filters.includeDeleted')}</label>
        </div>
        <Space wrap>
          <Button disabled={!selectedIds.length} danger onClick={() => runBatch('delete')}>{t('actions.batchDelete')}</Button>
          <Button disabled={!selectedIds.length} onClick={() => runBatch('restore')}>{t('actions.batchRestore')}</Button>
          <Button disabled={!selectedIds.length} onClick={() => runBatch('setStatus', { status: 1 })}>{t('actions.batchEnable')}</Button>
          <Button disabled={!selectedIds.length} onClick={() => runBatch('setStatus', { status: 0 })}>{t('actions.batchDisable')}</Button>
        </Space>
      </div>

      <div className="admin-table-card">
        <Table
          rowKey="id"
          scroll={{ x: 1080 }}
          loading={listQuery.isLoading}
          dataSource={listQuery.data?.list || []}
          columns={columns}
          rowSelection={{ selectedRowKeys: selectedIds, onChange: setSelectedIds }}
          pagination={{
            current: page,
            pageSize,
            total: listQuery.data?.total || 0,
            showSizeChanger: true,
            onChange: (nextPage, nextPageSize) => { setPage(nextPage); setPageSize(nextPageSize) },
          }}
        />
      </div>

      <Modal
        open={formOpen}
        title={editing ? t('dialog.editTitle') : t('dialog.createTitle')}
        okText={t('dialog.save')}
        cancelText={t('dialog.cancel')}
        confirmLoading={saveMutation.isPending}
        onCancel={() => setFormOpen(false)}
        onOk={() => form.submit()}
      >
        <Form form={form} layout="vertical" onFinish={(values) => saveMutation.mutate(values)}>
          <Form.Item name="projectName" label={t('dialog.projectName')} rules={[{ required: true, message: t('validation.projectNameRequired') }]}><Input /></Form.Item>
          <Form.Item label={t('dialog.avatar')}>
            <Space.Compact block>
              <Form.Item name="avatar" noStyle>
                <Input placeholder="/uploads/project-avatar/... or https://..." />
              </Form.Item>
              <Upload
                accept="image/jpeg,image/png,image/gif,image/webp"
                maxCount={1}
                showUploadList={false}
                beforeUpload={(file) => {
                  void uploadAvatar(file)
                  return Upload.LIST_IGNORE
                }}
              >
                <Button loading={uploadingAvatar} icon={<ImageUp size={14} />}>
                  {t('dialog.uploadAvatar')}
                </Button>
              </Upload>
            </Space.Compact>
          </Form.Item>
          <div className="admin-form-grid">
            <Form.Item name="weight" label={t('dialog.weight')}><InputNumber min={0} max={999999} className="full-width" /></Form.Item>
            <Form.Item name="status" label={t('dialog.status')}><Select options={[{ label: t('status.enabled'), value: 1 }, { label: t('status.disabled'), value: 0 }]} /></Form.Item>
          </div>
        </Form>
      </Modal>

      <ProjectMenuManager project={menuProject} onClose={() => setMenuProject(null)} />
    </AdminPage>
  )
}
