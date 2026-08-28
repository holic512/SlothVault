'use client'

/**
 * @file projects-manager.tsx
 * @project SlothVault
 * @module Project Administration
 * @description Provides administrator-only management for public article collections, immutable releases, manifests, draft clones, and unified content-editor entry points.
 * @logic Query collections, open the linear content workspace, edit draft versions, publish after strict validation, operate release visibility, verify manifests, and clone frozen trees for the next revision.
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
  Upload,
} from 'antd'
import type { ColumnsType } from 'antd/es/table'
import { BookOpenText, Boxes, Clipboard, Download, Ellipsis, Eye, EyeOff, GitFork, Home, ImageUp, Import, Plus, RefreshCw, Rocket, RotateCcw, ShieldCheck, Trash2 } from 'lucide-react'
import { useTranslations } from 'next-intl'
import { useRouter } from 'next/navigation'

import { apiFetch, ApiClientError } from '@/lib/api-client'
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
    </AdminPage>
  )
}

type VersionDto = {
  id: string
  projectId: string
  version: string
  description: string | null
  weight: number
  status: number
  releaseId: string | null
  releaseHash: string | null
  manifestVersion: number | null
  publishedAt: string | null
  isDeleted: boolean
  createdAt: string
  updatedAt: string
}

function VersionManager({ project, onClose, onUpdated }: { project: ProjectDto | null; onClose: () => void; onUpdated: () => unknown }) {
  const vt = useTranslations('AdminMM.projects.versionRelease')
  const router = useRouter()
  const queryClient = useQueryClient()
  const { message, modal } = App.useApp()
  const [includeDeleted, setIncludeDeleted] = useState(false)
  const [editing, setEditing] = useState<VersionDto | null>(null)
  const [formOpen, setFormOpen] = useState(false)
  const [cloneSource, setCloneSource] = useState<VersionDto | null>(null)
  const [form] = Form.useForm<{ version: string; description?: string; weight: number; status: number }>()
  const [cloneForm] = Form.useForm<{ version: string; description?: string; weight: number }>()
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
        body: JSON.stringify({
          version: values.version,
          description: values.description || null,
          weight: values.weight,
          ...(editing ? {} : { projectId: project!.id, status: 0 }),
        }),
      }),
    onSuccess: async () => { message.success(vt('messages.saved')); setFormOpen(false); setEditing(null); await refresh() },
    onError: (error) => message.error(error.message),
  })
  const publish = useMutation({
    mutationFn: (id: string) => apiFetch(`/api/admin/mm/projectVersion/${id}/publish`, { method: 'POST' }),
    onSuccess: async () => {
      message.success(vt('messages.published'))
      await refresh()
    },
    onError: (error) => {
      const issues = error instanceof ApiClientError && error.data && typeof error.data === 'object' && 'issues' in error.data
        ? (error.data as { issues?: Array<{ code: string; message: string }> }).issues || []
        : []
      if (issues.length) {
        modal.error({
          title: vt('messages.publishValidationFailed'),
          content: <ul>{issues.map((item) => <li key={`${item.code}:${item.message}`}><strong>{item.code}</strong> · {item.message}</li>)}</ul>,
        })
      } else message.error(error.message)
    },
  })
  const setVisibility = async (row: VersionDto, status: 0 | 1) => {
    await apiFetch(`/api/admin/mm/projectVersion/${row.id}`, {
      method: 'PUT',
      body: JSON.stringify({ status }),
    })
    message.success(status === 1 ? vt('messages.restored') : vt('messages.hidden'))
    await refresh()
  }
  const verifyIntegrity = async (row: VersionDto) => {
    const result = await apiFetch<{ valid: boolean; storedHash: string | null; computedHash: string | null; issues: Array<{ code: string; message: string }> }>(
      `/api/admin/mm/projectVersion/${row.id}/integrity`,
    )
    modal[result.valid ? 'success' : 'error']({
      title: result.valid ? vt('messages.integrityVerified') : vt('messages.integrityFailed'),
      content: result.valid
        ? <code className="release-hash-block">{result.computedHash}</code>
        : <ul>{result.issues.map((item) => <li key={`${item.code}:${item.message}`}>{item.code} · {item.message}</li>)}</ul>,
    })
  }
  const downloadManifest = async (row: VersionDto) => {
    const response = await fetch(`/api/admin/mm/projectVersion/${row.id}/manifest`, { credentials: 'same-origin' })
    if (!response.ok) throw new Error(vt('messages.manifestFailed'))
    const url = URL.createObjectURL(await response.blob())
    const anchor = document.createElement('a')
    anchor.href = url
    anchor.download = `slothvault-${row.releaseId}.manifest.json`
    anchor.click()
    URL.revokeObjectURL(url)
  }
  const openClone = (row: VersionDto) => {
    setCloneSource(row)
    cloneForm.setFieldsValue({
      version: `${row.version}-next`,
      description: row.description || '',
      weight: row.weight,
    })
  }
  const clone = useMutation({
    mutationFn: (values: { version: string; description?: string; weight: number }) =>
      apiFetch(`/api/admin/mm/projectVersion/${cloneSource!.id}/clone`, {
        method: 'POST',
        body: JSON.stringify({ ...values, description: values.description || null }),
      }),
    onSuccess: async () => { message.success(vt('messages.cloned')); setCloneSource(null); await refresh() },
    onError: (error) => message.error(error.message),
  })
  const restore = async (id: string) => {
    await apiFetch('/api/admin/mm/projectVersion/batch', { method: 'POST', body: JSON.stringify({ action: 'restore', ids: [id] }) })
    await refresh()
  }

  const openVersionForm = (version?: VersionDto) => {
    setEditing(version || null)
    form.setFieldsValue(version ? { version: version.version, description: version.description || '', weight: version.weight, status: 0 } : { version: '', description: '', weight: 0, status: 0 })
    setFormOpen(true)
  }

  return (
    <Modal open={Boolean(project)} title={vt('title', { name: project?.projectName || '' })} width={920} footer={null} onCancel={onClose}>
      <div className="inline-manager-toolbar">
        <label className="admin-switch-label"><Switch checked={includeDeleted} onChange={setIncludeDeleted} />{vt('includeDeleted')}</label>
        <Button type="primary" icon={<Plus size={14} />} onClick={() => openVersionForm()}>{vt('newVersion')}</Button>
      </div>
      <Table<VersionDto>
        rowKey="id"
        size="small"
        loading={query.isLoading}
        dataSource={query.data?.list || []}
        pagination={false}
        columns={[
          { title: vt('table.version'), dataIndex: 'version' },
          { title: vt('table.description'), dataIndex: 'description', ellipsis: true },
          { title: vt('table.weight'), dataIndex: 'weight', width: 80 },
          {
            title: vt('table.lifecycle'),
            width: 110,
            render: (_, row) => row.isDeleted
              ? <Tag>{vt('status.deleted')}</Tag>
              : !row.publishedAt
                ? <Tag>{vt('status.draft')}</Tag>
                : row.status === 1
                  ? <Tag color="success">{vt('status.published')}</Tag>
                  : <Tag color="warning">{vt('status.hidden')}</Tag>,
          },
          {
            title: vt('table.hash'),
            width: 155,
            render: (_, row) => row.releaseHash
              ? <code title={row.releaseHash}>{row.releaseHash.slice(0, 12)}…</code>
              : '—',
          },
          {
            title: vt('table.actions'),
            width: 285,
            render: (_, row) => (
              <Space size={2}>
                {!row.publishedAt ? <Button type="link" onClick={() => openVersionForm(row)}>{vt('actions.edit')}</Button> : null}
                <Button type="link" onClick={() => router.push(`/admin/mm/notes?projectId=${row.projectId}&versionId=${row.id}`)}>{vt('actions.content')}</Button>
                {row.isDeleted ? (
                  <Button type="link" onClick={() => void restore(row.id)}>{vt('actions.restore')}</Button>
                ) : row.publishedAt ? (
                  <Dropdown menu={{ items: [
                    row.status === 1
                      ? { key: 'hide', icon: <EyeOff size={14} />, label: vt('actions.hide'), onClick: () => void setVisibility(row, 0) }
                      : { key: 'show', icon: <Eye size={14} />, label: vt('actions.show'), onClick: () => void setVisibility(row, 1) },
                    { key: 'copy', icon: <Clipboard size={14} />, label: vt('actions.copyHash'), onClick: () => void navigator.clipboard.writeText(row.releaseHash || '').then(() => message.success(vt('messages.hashCopied'))).catch(() => message.error(vt('messages.copyFailed'))) },
                    { key: 'manifest', icon: <Download size={14} />, label: vt('actions.manifest'), onClick: () => void downloadManifest(row).catch((error) => message.error(error.message)) },
                    { key: 'integrity', icon: <ShieldCheck size={14} />, label: vt('actions.integrity'), onClick: () => void verifyIntegrity(row).catch((error) => message.error(error.message)) },
                    { key: 'clone', icon: <GitFork size={14} />, label: vt('actions.clone'), onClick: () => openClone(row) },
                  ] }}>
                    <Button icon={<Ellipsis size={15} />}>{vt('actions.release')}</Button>
                  </Dropdown>
                ) : (
                  <Dropdown menu={{ items: [
                    { key: 'publish', icon: <Rocket size={14} />, label: vt('actions.publish'), onClick: () => publish.mutate(row.id) },
                    { key: 'delete', danger: true, icon: <Trash2 size={14} />, label: vt('actions.delete'), onClick: () => modal.confirm({ title: vt('deleteConfirm', { version: row.version }), onOk: async () => { await apiFetch(`/api/admin/mm/projectVersion/${row.id}`, { method: 'DELETE' }); await refresh() } }) },
                  ] }}>
                    <Button icon={<Ellipsis size={15} />}>{vt('status.draft')}</Button>
                  </Dropdown>
                )}
              </Space>
            ),
          },
        ]}
      />
      <Modal open={formOpen} title={editing ? vt('form.editTitle') : vt('form.newTitle')} confirmLoading={save.isPending} onCancel={() => setFormOpen(false)} onOk={() => form.submit()}>
        <Form form={form} layout="vertical" onFinish={(values) => save.mutate(values)}>
          <Form.Item name="version" label={vt('form.version')} rules={[{ required: true }]}><Input placeholder="v1.0.0" /></Form.Item>
          <Form.Item name="description" label={vt('form.description')}><Input.TextArea rows={3} /></Form.Item>
          <div className="admin-form-grid">
            <Form.Item name="weight" label={vt('form.weight')}><InputNumber min={0} className="full-width" /></Form.Item>
            <Form.Item name="status" label={vt('form.status')}><Select disabled options={[{ label: vt('status.draft'), value: 0 }]} /></Form.Item>
          </div>
        </Form>
      </Modal>
      <Modal
        open={Boolean(cloneSource)}
        title={vt('clone.title', { version: cloneSource?.version || '' })}
        confirmLoading={clone.isPending}
        onCancel={() => setCloneSource(null)}
        onOk={() => cloneForm.submit()}
      >
        <Form form={cloneForm} layout="vertical" onFinish={(values) => clone.mutate(values)}>
          <Form.Item name="version" label={vt('clone.version')} rules={[{ required: true }]}><Input maxLength={64} /></Form.Item>
          <Form.Item name="description" label={vt('form.description')}><Input.TextArea rows={3} /></Form.Item>
          <Form.Item name="weight" label={vt('form.weight')}><InputNumber className="full-width" /></Form.Item>
        </Form>
      </Modal>
    </Modal>
  )
}
