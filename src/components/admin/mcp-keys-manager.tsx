'use client'

/**
 * @file mcp-keys-manager.tsx
 * @project SlothVault
 * @module Administrator MCP Key Management
 * @description Manages the signed-in administrator's MCP Keys and reveals native connection configurations exactly once.
 * @logic Scope query state by administrator, consume creation secrets outside mutation results, invalidate cancelled disclosures, and keep old-key guidance free of credentials.
 * @dependencies Ant Design, React Query, next-intl, mcp-key-creation, mcp-connection-config-dialog
 * @index_tags admin,mcp,api-key,authentication,security,create,enable,disable,delete
 * @author holic512
 */
import { useEffect, useRef, useState } from 'react'

import { useMutation, useQuery, useQueryClient } from '@tanstack/react-query'
import { Alert, App, Button, Empty, Form, Input, Modal, Space, Table, Tag, Typography } from 'antd'
import { Info, KeyRound, Plus, RefreshCw, ToggleLeft, ToggleRight, Trash2 } from 'lucide-react'
import { useLocale, useTranslations } from 'next-intl'

import { AdminPage, AdminPageActions, AdminTablePanel } from '@/components/admin/admin-page'
import { McpConnectionConfigDialog } from '@/components/admin/mcp-connection-config-dialog'
import { formatAdminDate, formatAdminError } from '@/lib/admin-localization'
import { apiFetch } from '@/lib/api-client'
import { createMcpConnectionConfig, MCP_KEY_PLACEHOLDER, resolveMcpEndpoint } from '@/lib/mcp-connection-config'
import {
  adminMcpKeysQueryKey, createOneTimeMcpKeyFlow, McpKeyCreationError,
  type CreatedMcpApiKeyResponse, type McpApiKeyRow, type OneTimeMcpKey,
} from '@/lib/mcp-key-creation'
import configStyles from '@/styles/modules/mcp-connection-config.module.css'

const MCP_API_KEY_STATUS = {
  DISABLED: 0,
  ACTIVE: 1,
} as const

type McpApiKeyStatus = (typeof MCP_API_KEY_STATUS)[keyof typeof MCP_API_KEY_STATUS]

type CreateMcpApiKeyForm = {
  name: string
  expiresAt?: string
}

function isExpired(apiKey: McpApiKeyRow) {
  return Boolean(apiKey.expiresAt && new Date(apiKey.expiresAt).getTime() <= Date.now())
}

export function McpKeysManager({ administratorId }: { administratorId: string }) {
  const t = useTranslations('AdminMM.mcpKeys')
  const errorT = useTranslations('AdminMM.errors')
  const locale = useLocale()
  const queryClient = useQueryClient()
  const { message, modal } = App.useApp()
  const [createOpen, setCreateOpen] = useState(false)
  const [revealedKey, setRevealedKey] = useState<OneTimeMcpKey | null>(null)
  const [guideEndpoint, setGuideEndpoint] = useState<string | null>(null)
  const createButton = useRef<HTMLButtonElement>(null)
  const guideButton = useRef<HTMLButtonElement>(null)
  const [form] = Form.useForm<CreateMcpApiKeyForm>()
  const [creationFlow] = useState(() => createOneTimeMcpKeyFlow((value) => {
    setRevealedKey(value)
    if (value) {
      setCreateOpen(false)
      form.resetFields()
    }
  }))
  const queryKey = adminMcpKeysQueryKey(administratorId)

  const query = useQuery({
    queryKey,
    queryFn: () => apiFetch<McpApiKeyRow[]>('/api/admin/mm/mcp/keys', { cache: 'no-store' }),
  })
  const refresh = () => queryClient.invalidateQueries({ queryKey })

  const createMutation = useMutation({
    gcTime: 0,
    retry: false,
    mutationFn: ({ endpoint, ...values }: CreateMcpApiKeyForm & { endpoint: string }) => creationFlow.create(endpoint, (signal) => apiFetch<CreatedMcpApiKeyResponse>('/api/admin/mm/mcp/keys', {
      method: 'POST',
      signal,
      cache: 'no-store',
      body: JSON.stringify({
        name: values.name.trim(),
        expiresAt: values.expiresAt ? new Date(values.expiresAt).toISOString() : null,
      }),
    })),
    onSuccess: () => refresh(),
    onError: (error) => {
      if (error instanceof McpKeyCreationError && error.cancelled) return
      message.error(t('messages.createFailed'))
    },
  })
  const resetCreateMutation = createMutation.reset

  useEffect(() => () => {
    creationFlow.clear()
    resetCreateMutation()
  }, [creationFlow, resetCreateMutation])

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

  const clearDisclosure = () => {
    creationFlow.clear()
    createMutation.reset()
  }

  const currentEndpoint = () => resolveMcpEndpoint({
    configuredBaseUrl: process.env.NEXT_PUBLIC_SITE_ORIGIN,
    pageOrigin: window.location.origin,
  })

  const openCreate = () => {
    clearDisclosure()
    setGuideEndpoint(null)
    form.resetFields()
    setCreateOpen(true)
  }

  const openGuide = () => {
    clearDisclosure()
    try {
      setGuideEndpoint(currentEndpoint())
    } catch {
      message.error(t('messages.invalidEndpoint'))
    }
  }

  const submitCreate = (values: CreateMcpApiKeyForm) => {
    if (createMutation.isPending) return
    try {
      createMutation.mutate({ ...values, endpoint: currentEndpoint() })
    } catch {
      message.error(t('messages.invalidEndpoint'))
    }
  }

  const closeCreate = () => {
    clearDisclosure()
    setCreateOpen(false)
    form.resetFields()
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
        <Space wrap>
          <Button icon={<RefreshCw size={15} />} onClick={() => void query.refetch()}>{t('actions.refresh')}</Button>
          <Button ref={guideButton} icon={<Info size={15} />} onClick={openGuide}>{t('actions.guide')}</Button>
          <Button ref={createButton} className={configStyles.confirm} type="primary" icon={<Plus size={15} />} onClick={openCreate}>{t('actions.getConfig')}</Button>
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
        closable={{ 'aria-label': t('actions.close') }}
        okText={t('actions.create')}
        okButtonProps={{ className: configStyles.confirm, loading: createMutation.isPending }}
        cancelText={t('actions.cancel')}
        keyboard
        onCancel={closeCreate}
        onOk={() => form.submit()}
        afterOpenChange={(open) => { if (open) form.getFieldInstance('name')?.focus() }}
      >
        <Form form={form} layout="vertical" onFinish={submitCreate}>
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

      <McpConnectionConfigDialog
        configuration={revealedKey ? createMcpConnectionConfig({ configuredBaseUrl: revealedKey.endpoint, pageOrigin: revealedKey.endpoint, key: revealedKey.key }) : null}
        onClose={clearDisclosure}
        restoreFocus={() => createButton.current?.focus()}
      />
      <McpConnectionConfigDialog
        template
        configuration={guideEndpoint ? createMcpConnectionConfig({ configuredBaseUrl: guideEndpoint, pageOrigin: guideEndpoint, key: MCP_KEY_PLACEHOLDER }) : null}
        onClose={() => setGuideEndpoint(null)}
        onCreateKey={openCreate}
        restoreFocus={() => guideButton.current?.focus()}
      />
    </AdminPage>
  )
}
