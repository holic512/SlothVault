'use client'

/**
 * @file project-menu-manager.tsx
 * @project SlothVault
 * @module Project Menu Administration
 * @description Shows localized read-only built-in navigation alongside an editable two-level project menu tree.
 * @logic Prepend built-in display rows, load custom menus with retry feedback, restrict parent choices to custom roots, and coordinate CRUD operations.
 * @dependencies Ant Design, React Query, next-intl, api-client, project-navigation
 * @index_tags admin,project-menu,navigation,tree,crud
 * @author holic512
 */
import { useState } from 'react'

import { useMutation, useQuery, useQueryClient } from '@tanstack/react-query'
import {
  Alert,
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
import { Plus, Trash2 } from 'lucide-react'
import { useTranslations } from 'next-intl'

import { formatAdminError } from '@/lib/admin-localization'
import { apiFetch } from '@/lib/api-client'
import { buildProjectMenuRows, type CustomProjectMenu, type ProjectMenuRow } from '@/lib/project-navigation'

export type MenuProject = { id: string; projectName: string }

type MenuDto = CustomProjectMenu
type MenuForm = {
  parentId?: string | null
  label: string
  url?: string
  isExternal: boolean
  weight: number
  status: number
}

export function ProjectMenuManager({
  project,
  onClose,
}: {
  project: MenuProject | null
  onClose: () => void
}) {
  const t = useTranslations('AdminMM.projectMenu')
  const navigationT = useTranslations('ProjectNavigation')
  const errorT = useTranslations('AdminMM.errors')
  const queryClient = useQueryClient()
  const { message, modal } = App.useApp()
  const [editing, setEditing] = useState<MenuDto | null>(null)
  const [formOpen, setFormOpen] = useState(false)
  const [form] = Form.useForm<MenuForm>()

  const query = useQuery({
    queryKey: ['admin-project-menus', project?.id],
    enabled: Boolean(project),
    queryFn: () =>
      apiFetch<MenuDto[]>(
        `/api/admin/mm/menu?projectId=${project!.id}&tree=1`,
      ),
  })
  const refresh = () =>
    queryClient.invalidateQueries({ queryKey: ['admin-project-menus', project?.id] })

  const roots = (query.data || []).filter((menu) => !menu.isDeleted && menu.parentId === null)
  const save = useMutation({
    mutationFn: (values: MenuForm) =>
      apiFetch<MenuDto>(editing ? `/api/admin/mm/menu/${editing.id}` : '/api/admin/mm/menu', {
        method: editing ? 'PUT' : 'POST',
        body: JSON.stringify({
          ...values,
          parentId: values.parentId || null,
          url: values.url?.trim() || null,
          ...(editing ? {} : { projectId: project!.id }),
        }),
      }),
    onSuccess: async () => {
      message.success(t('messages.saved'))
      setFormOpen(false)
      setEditing(null)
      form.resetFields()
      await refresh()
    },
    onError: (error) => message.error(formatAdminError(error, errorT)),
  })

  const openForm = (menu?: MenuDto, parentId: string | null = null) => {
    setEditing(menu || null)
    form.setFieldsValue(
      menu
        ? {
            parentId: menu.parentId,
            label: menu.label,
            url: menu.url || '',
            isExternal: menu.isExternal,
            weight: menu.weight,
            status: menu.status,
          }
        : { parentId, label: '', url: '', isExternal: false, weight: 0, status: 1 },
    )
    setFormOpen(true)
  }

  const remove = (menu: MenuDto) => {
    modal.confirm({
      title: t('operations.delete'),
      content: t('messages.deleteConfirm', { name: menu.label }),
      okButtonProps: { danger: true },
      onOk: async () => {
        await apiFetch(`/api/admin/mm/menu/${menu.id}`, { method: 'DELETE' })
        message.success(t('messages.deleted'))
        await refresh()
      },
    })
  }
  const columns: ColumnsType<ProjectMenuRow> = [
    { title: t('table.label'), dataIndex: 'label', minWidth: 180 },
    {
      title: t('table.source'),
      dataIndex: 'kind',
      width: 115,
      render: (kind) => (
        <Tag color={kind === 'builtin' ? 'blue' : undefined}>
          {kind === 'builtin' ? t('source.builtin') : t('source.custom')}
        </Tag>
      ),
    },
    {
      title: t('table.url'),
      dataIndex: 'url',
      minWidth: 220,
      render: (value) => <Typography.Text code>{value || '-'}</Typography.Text>,
    },
    {
      title: t('table.type'),
      dataIndex: 'isExternal',
      width: 95,
      render: (value) => (
        <Tag color={value ? 'blue' : undefined}>
          {value ? t('type.external') : t('type.internal')}
        </Tag>
      ),
    },
    {
      title: t('table.status'),
      width: 100,
      render: (_value, row) =>
        row.isDeleted ? (
          <Tag>{t('status.deleted')}</Tag>
        ) : row.status === 1 ? (
          <Tag color="success">{t('status.enabled')}</Tag>
        ) : (
          <Tag color="warning">{t('status.disabled')}</Tag>
        ),
    },
    {
      title: t('table.operations'),
      fixed: 'right',
      width: 260,
      render: (_value, row) => row.kind === 'builtin' ? (
        <Typography.Text type="secondary">{t('operations.fixed')}</Typography.Text>
      ) : (
        <Space size={2}>
          {!row.isDeleted && row.parentId === null ? (
            <Button type="link" icon={<Plus size={13} />} onClick={() => openForm(undefined, row.id)}>
              {t('operations.child')}
            </Button>
          ) : null}
          {(
            <>
              <Button type="link" onClick={() => openForm(row.menu)}>{t('operations.edit')}</Button>
              <Button type="link" danger icon={<Trash2 size={13} />} onClick={() => remove(row.menu)}>
                {t('operations.delete')}
              </Button>
            </>
          )}
        </Space>
      ),
    },
  ]

  return (
    <Modal
      open={Boolean(project)}
      width={980}
      title={t('title', { name: project?.projectName || '' })}
      footer={null}
      onCancel={onClose}
    >
      <Space orientation="vertical" size={14} className="full-width">
        <Alert showIcon type="info" title={t('defaultHint')} />
        {query.isError ? (
          <Alert
            showIcon
            type="error"
            title={t('messages.loadFailed')}
            description={formatAdminError(query.error, errorT)}
            action={
              <Button size="small" loading={query.isFetching} onClick={() => { void query.refetch() }}>
                {t('operations.retry')}
              </Button>
            }
          />
        ) : null}
        <div className="inline-manager-toolbar">
          <div>
            <Typography.Text type="secondary">{t('desc')}</Typography.Text>
          </div>
          <Button type="primary" icon={<Plus size={14} />} onClick={() => openForm()}>
            {t('newRoot')}
          </Button>
        </div>
        <Table
          rowKey="rowKey"
          size="small"
          loading={query.isLoading}
          dataSource={project ? buildProjectMenuRows(project.id, query.data || [], navigationT) : []}
          columns={columns}
          pagination={false}
          scroll={{ x: 1015 }}
        />
      </Space>

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
          <Form.Item name="parentId" label={t('dialog.parent')}>
            <Select
              allowClear
              placeholder={t('dialog.root')}
              options={roots
                .filter((root) => root.id !== editing?.id)
                .map((root) => ({ label: root.label, value: root.id }))}
            />
          </Form.Item>
          <Form.Item
            name="label"
            label={t('dialog.label')}
            rules={[{ required: true, message: t('messages.labelRequired') }]}
          >
            <Input maxLength={64} showCount />
          </Form.Item>
          <Form.Item name="url" label={t('dialog.url')}><Input maxLength={2048} /></Form.Item>
          <Form.Item name="isExternal" label={t('dialog.external')} valuePropName="checked">
            <Switch />
          </Form.Item>
          <div className="admin-form-grid">
            <Form.Item name="weight" label={t('dialog.weight')}>
              <InputNumber className="full-width" />
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
    </Modal>
  )
}
