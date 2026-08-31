'use client'

/**
 * @file project-menu-manager.tsx
 * @project SlothVault
 * @module Project Menu Administration
 * @description Provides a two-level Ant Design project menu tree table and validated editor.
 * @logic Load one project's menu tree, restrict parent choices to active roots, and coordinate create, edit, cascade delete, and restore operations.
 * @dependencies Ant Design, React Query, next-intl, api-client
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
import { Plus, RotateCcw, Trash2 } from 'lucide-react'
import { useTranslations } from 'next-intl'

import { formatAdminError } from '@/lib/admin-localization'
import { apiFetch } from '@/lib/api-client'

export type MenuProject = { id: string; projectName: string }

type MenuDto = {
  id: string
  projectId: string
  parentId: string | null
  label: string
  url: string | null
  isExternal: boolean
  weight: number
  status: number
  createdAt: string
  updatedAt: string
  isDeleted: boolean
  children?: MenuDto[]
}
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
  const errorT = useTranslations('AdminMM.errors')
  const queryClient = useQueryClient()
  const { message, modal } = App.useApp()
  const [includeDeleted, setIncludeDeleted] = useState(false)
  const [editing, setEditing] = useState<MenuDto | null>(null)
  const [formOpen, setFormOpen] = useState(false)
  const [form] = Form.useForm<MenuForm>()

  const query = useQuery({
    queryKey: ['admin-project-menus', project?.id, includeDeleted],
    enabled: Boolean(project),
    queryFn: () =>
      apiFetch<MenuDto[]>(
        `/api/admin/mm/menu?projectId=${project!.id}&tree=1${includeDeleted ? '&includeDeleted=1' : ''}`,
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
  const restore = async (menu: MenuDto) => {
    await apiFetch(`/api/admin/mm/menu/${menu.id}`, {
      method: 'PUT',
      body: JSON.stringify({ isDeleted: false, status: 1 }),
    })
    message.success(t('messages.restored'))
    await refresh()
  }

  const columns: ColumnsType<MenuDto> = [
    { title: t('table.label'), dataIndex: 'label', minWidth: 180 },
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
      render: (_value, row) => (
        <Space size={2}>
          {!row.isDeleted && row.parentId === null ? (
            <Button type="link" icon={<Plus size={13} />} onClick={() => openForm(undefined, row.id)}>
              {t('operations.child')}
            </Button>
          ) : null}
          {!row.isDeleted ? (
            <>
              <Button type="link" onClick={() => openForm(row)}>{t('operations.edit')}</Button>
              <Button type="link" danger icon={<Trash2 size={13} />} onClick={() => remove(row)}>
                {t('operations.delete')}
              </Button>
            </>
          ) : (
            <Button type="link" icon={<RotateCcw size={13} />} onClick={() => void restore(row)}>
              {t('operations.restore')}
            </Button>
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
        <Alert showIcon type="info" message={t('defaultHint')} />
        <div className="inline-manager-toolbar">
          <div>
            <Typography.Text type="secondary">{t('desc')}</Typography.Text>
            <label className="admin-switch-label">
              <Switch checked={includeDeleted} onChange={setIncludeDeleted} />
              {t('includeDeleted')}
            </label>
          </div>
          <Button type="primary" icon={<Plus size={14} />} onClick={() => openForm()}>
            {t('newRoot')}
          </Button>
        </div>
        <Table
          rowKey="id"
          size="small"
          loading={query.isLoading}
          dataSource={query.data || []}
          columns={columns}
          pagination={false}
          scroll={{ x: 900 }}
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
