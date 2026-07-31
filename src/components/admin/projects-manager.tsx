'use client'

/**
 * @file projects-manager.tsx
 * @project SlothVault
 * @module Project Administration
 * @description Provides administrator-only management for public article collections and their versions.
 * @logic Query collections, run typed create/update/batch mutations, keep every published collection publicly readable, and open scoped version management without leaving the table.
 * @dependencies Ant Design, React Query, next-intl, api-client
 * @index_tags admin,projects,versions,crud
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
  Typography,
  Upload,
} from 'antd'
import type { ColumnsType } from 'antd/es/table'
import { Boxes, Ellipsis, FolderTree, Home, ImageUp, NotebookTabs, Plus, RefreshCw, RotateCcw, Trash2 } from 'lucide-react'
import { useTranslations } from 'next-intl'
import { useRouter } from 'next/navigation'

import { apiFetch } from '@/lib/api-client'
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
  const [versionProject, setVersionProject] = useState<ProjectDto | null>(null)
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
    onError: (error) => message.error(error.message),
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
    onError: (error) => message.error(error.message),
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
      message.error(error instanceof Error ? error.message : t('messages.submitFailed'))
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
        render: (value) => new Date(value).toLocaleString(),
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
                  { key: 'versions', icon: <Boxes size={14} />, label: t('operations.versionManage'), onClick: () => setVersionProject(row) },
                  { key: 'menu', icon: <Ellipsis size={14} />, label: t('operations.menuConfig'), onClick: () => setMenuProject(row) },
                  { key: 'home', icon: <Home size={14} />, label: t('operations.homeEdit'), onClick: () => router.push(`/admin/mm/projects/${row.id}/home`) },
                  { key: 'categories', icon: <FolderTree size={14} />, label: t('operations.categoryManage'), disabled: !row.latestVersionId, onClick: () => router.push(`/admin/mm/categories?versionId=${row.latestVersionId}`) },
                  { key: 'notes', icon: <NotebookTabs size={14} />, label: t('operations.noteManage'), onClick: () => router.push(`/admin/mm/notes?projectId=${row.id}`) },
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
    <div className="admin-page-stack">
      <div className="admin-page-heading">
        <div>
          <Typography.Title level={2}>{t('title')}</Typography.Title>
          <Typography.Paragraph type="secondary">{t('desc')}</Typography.Paragraph>
        </div>
        <Space>
          <Button icon={<RefreshCw size={15} />} onClick={() => void refresh()}>{t('actions.search')}</Button>
          <Button type="primary" icon={<Plus size={15} />} onClick={openCreate}>{t('actions.create')}</Button>
        </Space>
      </div>

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
                  Upload
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

      <VersionManager project={versionProject} onClose={() => setVersionProject(null)} onUpdated={refresh} />
      <ProjectMenuManager project={menuProject} onClose={() => setMenuProject(null)} />
    </div>
  )
}

type VersionDto = {
  id: string
  projectId: string
  version: string
  description: string | null
  weight: number
  status: number
  isDeleted: boolean
  createdAt: string
  updatedAt: string
}

function VersionManager({ project, onClose, onUpdated }: { project: ProjectDto | null; onClose: () => void; onUpdated: () => unknown }) {
  const router = useRouter()
  const queryClient = useQueryClient()
  const { message, modal } = App.useApp()
  const [includeDeleted, setIncludeDeleted] = useState(false)
  const [editing, setEditing] = useState<VersionDto | null>(null)
  const [formOpen, setFormOpen] = useState(false)
  const [form] = Form.useForm<{ version: string; description?: string; weight: number; status: number }>()
  const query = useQuery({
    queryKey: ['project-versions-admin', project?.id, includeDeleted],
    enabled: Boolean(project),
    queryFn: () =>
      apiFetch<{ list: VersionDto[]; total: number }>(
        `/api/admin/mm/projectVersion/byProject/${project!.id}?pageSize=100${includeDeleted ? '&includeDeleted=1' : ''}`,
      ),
  })
  const refresh = async () => {
    await queryClient.invalidateQueries({ queryKey: ['project-versions-admin', project?.id] })
    await onUpdated()
  }
  const save = useMutation({
    mutationFn: (values: { version: string; description?: string; weight: number; status: number }) =>
      apiFetch(editing ? `/api/admin/mm/projectVersion/${editing.id}` : '/api/admin/mm/projectVersion', {
        method: editing ? 'PUT' : 'POST',
        body: JSON.stringify({ ...values, description: values.description || null, ...(editing ? {} : { projectId: project!.id }) }),
      }),
    onSuccess: async () => { message.success('Saved'); setFormOpen(false); setEditing(null); await refresh() },
    onError: (error) => message.error(error.message),
  })
  const restore = async (id: string) => {
    await apiFetch('/api/admin/mm/projectVersion/batch', { method: 'POST', body: JSON.stringify({ action: 'restore', ids: [id] }) })
    await refresh()
  }

  const openVersionForm = (version?: VersionDto) => {
    setEditing(version || null)
    form.setFieldsValue(version ? { version: version.version, description: version.description || '', weight: version.weight, status: version.status } : { version: '', description: '', weight: 0, status: 1 })
    setFormOpen(true)
  }

  return (
    <Modal open={Boolean(project)} title={`Versions · ${project?.projectName || ''}`} width={920} footer={null} onCancel={onClose}>
      <div className="inline-manager-toolbar">
        <label className="admin-switch-label"><Switch checked={includeDeleted} onChange={setIncludeDeleted} />Include deleted</label>
        <Button type="primary" icon={<Plus size={14} />} onClick={() => openVersionForm()}>New version</Button>
      </div>
      <Table<VersionDto>
        rowKey="id"
        size="small"
        loading={query.isLoading}
        dataSource={query.data?.list || []}
        pagination={false}
        columns={[
          { title: 'Version', dataIndex: 'version' },
          { title: 'Description', dataIndex: 'description', ellipsis: true },
          { title: 'Weight', dataIndex: 'weight', width: 80 },
          { title: 'Status', width: 90, render: (_, row) => row.isDeleted ? <Tag>Deleted</Tag> : row.status === 1 ? <Tag color="success">Enabled</Tag> : <Tag color="warning">Disabled</Tag> },
          {
            title: 'Actions',
            width: 245,
            render: (_, row) => (
              <Space size={2}>
                <Button type="link" onClick={() => openVersionForm(row)}>Edit</Button>
                <Button type="link" onClick={() => router.push(`/admin/mm/categories?versionId=${row.id}`)}>Categories</Button>
                {row.isDeleted ? (
                  <Button type="link" onClick={() => void restore(row.id)}>Restore</Button>
                ) : (
                  <Button type="link" danger onClick={() => modal.confirm({ title: `Delete ${row.version}?`, onOk: async () => { await apiFetch(`/api/admin/mm/projectVersion/${row.id}`, { method: 'DELETE' }); await refresh() } })}>Delete</Button>
                )}
              </Space>
            ),
          },
        ]}
      />
      <Modal open={formOpen} title={editing ? 'Edit version' : 'New version'} confirmLoading={save.isPending} onCancel={() => setFormOpen(false)} onOk={() => form.submit()}>
        <Form form={form} layout="vertical" onFinish={(values) => save.mutate(values)}>
          <Form.Item name="version" label="Version" rules={[{ required: true }]}><Input placeholder="v1.0.0" /></Form.Item>
          <Form.Item name="description" label="Description"><Input.TextArea rows={3} /></Form.Item>
          <div className="admin-form-grid">
            <Form.Item name="weight" label="Weight"><InputNumber min={0} className="full-width" /></Form.Item>
            <Form.Item name="status" label="Status"><Select options={[{ label: 'Enabled', value: 1 }, { label: 'Disabled', value: 0 }]} /></Form.Item>
          </div>
        </Form>
      </Modal>
    </Modal>
  )
}
