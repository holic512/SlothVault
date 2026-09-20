'use client'

/**
 * @file mcp-keys-manager.tsx
 * @project SlothVault
 * @module Administrator MCP Key Management
 * @description Lets the currently signed-in administrator create, inspect, enable, disable, copy once, and delete only their own MCP API Keys.
 * @logic Request the owner-scoped management API, reveal each generated secret exactly once in local component state, and treat expiration or disabled status as unavailable before sending a key-state mutation.
 * @dependencies Ant Design, React Query, next-intl, api-client, admin-localization
 * @index_tags admin,mcp,api-key,authentication,security,create,enable,disable,delete
 * @author holic512
 */
import { useState } from 'react'

import { useMutation, useQuery, useQueryClient } from '@tanstack/react-query'
import { Alert, App, Button, Empty, Form, Input, Modal, Space, Table, Tag, Typography } from 'antd'
import { Copy, KeyRound, Plus, RefreshCw, ToggleLeft, ToggleRight, Trash2 } from 'lucide-react'
import { useLocale, useTranslations } from 'next-intl'

import { AdminPage, AdminPageActions, AdminTablePanel } from '@/components/admin/admin-page'
import { formatAdminDate, formatAdminError } from '@/lib/admin-localization'
import { apiFetch } from '@/lib/api-client'

const MCP_API_KEY_STATUS = {
  DISABLED: 0,
  ACTIVE: 1,
} as const

type McpApiKeyStatus = (typeof MCP_API_KEY_STATUS)[keyof typeof MCP_API_KEY_STATUS]

type McpApiKeyRow = {
  id: string
  name: string
  status: McpApiKeyStatus
  keyHint: string
  expiresAt: string | null
  lastUsedAt: string | null
  createdAt: string
  updatedAt: string
}

type CreateMcpApiKeyResult = {
  apiKey: McpApiKeyRow
  key: string
}

type CreateMcpApiKeyForm = {
  name: string
  expiresAt?: string
}

function isExpired(apiKey: McpApiKeyRow) {
  return Boolean(apiKey.expiresAt && new Date(apiKey.expiresAt).getTime() <= Date.now())
}

export function McpKeysManager() {
  const t = useTranslations('AdminMM.mcpKeys')
  const errorT = useTranslations('AdminMM.errors')
  const locale = useLocale()
  const queryClient = useQueryClient()
  const { message, modal } = App.useApp()
  const [createOpen, setCreateOpen] = useState(false)
  const [revealedKey, setRevealedKey] = useState<string | null>(null)
  const [form] = Form.useForm<CreateMcpApiKeyForm>()

  const query = useQuery({
    queryKey: ['admin-mcp-api-keys'],
    queryFn: () => apiFetch<McpApiKeyRow[]>('/api/admin/mm/mcp/keys'),
  })
  const refresh = () => queryClient.invalidateQueries({ queryKey: ['admin-mcp-api-keys'] })

  const createMutation = useMutation({
    mutationFn: (values: CreateMcpApiKeyForm) => apiFetch<CreateMcpApiKeyResult>('/api/admin/mm/mcp/keys', {
      method: 'POST',
      body: JSON.stringify({
        name: values.name.trim(),
        expiresAt: values.expiresAt ? new Date(values.expiresAt).toISOString() : null,
      }),
    }),
    onSuccess: async ({ key }) => {
      setCreateOpen(false)
      form.resetFields()
      setRevealedKey(key)
      await refresh()
    },
    onError: (error) => message.error(formatAdminError(error, errorT)),
  })

  const statusMutation = useMutation({
    mutationFn: ({ id, status }: { id: string; status: McpApiKeyStatus }) => apiFetch<McpApiKeyRow>(
      `/api/admin/mm/mcp/keys/${id}`,
      { method: 'PATCH', body: JSON.stringify({ status }) },
    ),
    onSuccess: async (_apiKey, variables) => {
      message.success(variables.status === MCP_API_KEY_STATUS.ACTIVE ? t('messages.enabled') : t('messages.disabled'))
      await refresh()
    },
    onError: (error) => message.error(formatAdminError(error, errorT)),
  })

  const deleteMutation = useMutation({
    mutationFn: (id: string) => apiFetch(`/api/admin/mm/mcp/keys/${id}`, { method: 'DELETE' }),
    onSuccess: async () => {
      message.success(t('messages.deleted'))
      await refresh()
    },
    onError: (error) => message.error(formatAdminError(error, errorT)),
  })

  const openCreate = () => {
    form.resetFields()
    setCreateOpen(true)
  }

  const confirmDelete = (apiKey: McpApiKeyRow) => {
    modal.confirm({
      title: t('messages.deleteTitle'),
      content: t('messages.deleteConfirm', { name: apiKey.name }),
      okText: t('actions.delete'),
      okButtonProps: { danger: true },
      cancelText: t('actions.cancel'),
      onOk: () => deleteMutation.mutateAsync(apiKey.id),
    })
  }

  const copyRevealedKey = async () => {
    if (!revealedKey) return
    try {
      await navigator.clipboard.writeText(revealedKey)
      message.success(t('messages.copied'))
    } catch {
      message.error(t('messages.copyFailed'))
    }
  }

  const statusLabel = (apiKey: McpApiKeyRow) => {
    if (isExpired(apiKey)) return <Tag color="default">{t('status.expired')}</Tag>
    return apiKey.status === MCP_API_KEY_STATUS.ACTIVE
      ? <Tag color="success">{t('status.active')}</Tag>
      : <Tag color="warning">{t('status.disabled')}</Tag>
  }

  return (
    <AdminPage>
      <Alert
        showIcon
        type="info"
        icon={<KeyRound size={16} />}
        title={t('securityNotice.title')}
        description={t('securityNotice.description')}
      />

      <AdminPageActions>
        <Space>
          <Button icon={<RefreshCw size={15} />} onClick={() => void query.refetch()}>{t('actions.refresh')}</Button>
          <Button type="primary" icon={<Plus size={15} />} onClick={openCreate}>{t('actions.create')}</Button>
        </Space>
      </AdminPageActions>

      {query.isError ? (
        <Alert
          showIcon
          type="error"
          title={t('messages.loadFailed')}
          description={formatAdminError(query.error, errorT)}
        />
      ) : (
        <AdminTablePanel>
          <Table<McpApiKeyRow>
            rowKey="id"
            loading={query.isLoading}
            dataSource={query.data || []}
            pagination={false}
            locale={{
              emptyText: <Empty image={Empty.PRESENTED_IMAGE_SIMPLE} description={t('empty')} />,
            }}
            columns={[
              {
                title: t('table.name'),
                dataIndex: 'name',
                minWidth: 180,
                render: (value) => <Space size={8}><KeyRound size={16} /><strong>{value}</strong></Space>,
              },
              {
                title: t('table.keyHint'),
                dataIndex: 'keyHint',
                width: 190,
                render: (value) => <Typography.Text code>{value}</Typography.Text>,
              },
              { title: t('table.status'), width: 100, render: (_value, apiKey) => statusLabel(apiKey) },
              {
                title: t('table.expiresAt'),
                dataIndex: 'expiresAt',
                width: 180,
                render: (value) => value ? formatAdminDate(locale, value) : t('neverExpires'),
              },
              {
                title: t('table.lastUsedAt'),
                dataIndex: 'lastUsedAt',
                width: 180,
                render: (value) => value ? formatAdminDate(locale, value) : '—',
              },
              {
                title: t('table.createdAt'),
                dataIndex: 'createdAt',
                width: 180,
                render: (value) => formatAdminDate(locale, value),
              },
              {
                title: t('table.operations'),
                fixed: 'right',
                width: 210,
                render: (_value, apiKey) => {
                  const expired = isExpired(apiKey)
                  const isActive = apiKey.status === MCP_API_KEY_STATUS.ACTIVE
                  const isMutating = statusMutation.isPending && statusMutation.variables?.id === apiKey.id
                  const isDeleting = deleteMutation.isPending && deleteMutation.variables === apiKey.id
                  return (
                    <Space size={4}>
                      {!expired ? (
                        <Button
                          type="link"
                          icon={isActive ? <ToggleRight size={15} /> : <ToggleLeft size={15} />}
                          loading={isMutating}
                          onClick={() => statusMutation.mutate({
                            id: apiKey.id,
                            status: isActive ? MCP_API_KEY_STATUS.DISABLED : MCP_API_KEY_STATUS.ACTIVE,
                          })}
                        >
                          {isActive ? t('actions.disable') : t('actions.enable')}
                        </Button>
                      ) : null}
                      <Button
                        danger
                        type="link"
                        icon={<Trash2 size={14} />}
                        loading={isDeleting}
                        onClick={() => confirmDelete(apiKey)}
                      >
                        {t('actions.delete')}
                      </Button>
                    </Space>
                  )
                },
              },
            ]}
          />
        </AdminTablePanel>
      )}

      <Modal
        open={createOpen}
        title={t('dialog.createTitle')}
        okText={t('actions.create')}
        cancelText={t('actions.cancel')}
        confirmLoading={createMutation.isPending}
        onCancel={() => setCreateOpen(false)}
        onOk={() => form.submit()}
      >
        <Form form={form} layout="vertical" onFinish={(values) => createMutation.mutate(values)}>
          <Form.Item
            name="name"
            label={t('form.name')}
            rules={[{ required: true, whitespace: true, max: 80, message: t('validation.name') }]}
          >
            <Input autoFocus maxLength={80} placeholder={t('form.namePlaceholder')} />
          </Form.Item>
          <Form.Item
            name="expiresAt"
            label={t('form.expiresAt')}
            extra={t('form.expiresAtHint')}
            rules={[{
              validator: async (_rule, value) => {
                if (!value || new Date(value).getTime() > Date.now()) return
                throw new Error(t('validation.expiresAt'))
              },
            }]}
          >
            <Input type="datetime-local" />
          </Form.Item>
        </Form>
      </Modal>

      <Modal
        open={Boolean(revealedKey)}
        title={t('dialog.revealTitle')}
        okText={t('actions.confirmSaved')}
        cancelButtonProps={{ style: { display: 'none' } }}
        onOk={() => setRevealedKey(null)}
        onCancel={() => setRevealedKey(null)}
      >
        <Alert showIcon type="warning" title={t('dialog.revealWarning')} description={t('dialog.revealDescription')} />
        <Typography.Paragraph className="admin-mcp-key-value">
          <Input.TextArea aria-label={t('dialog.keyValue')} autoSize={{ minRows: 3, maxRows: 5 }} readOnly value={revealedKey || ''} />
        </Typography.Paragraph>
        <Button block icon={<Copy size={15} />} onClick={() => void copyRevealedKey()}>{t('actions.copy')}</Button>
      </Modal>
    </AdminPage>
  )
}
