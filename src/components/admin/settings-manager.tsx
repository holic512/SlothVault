'use client'

/**
 * @file settings-manager.tsx
 * @project SlothVault
 * @module System Settings Administration
 * @description Replaces the Nuxt configuration form with grouped Ant Design controls that do not echo stored secrets.
 * @logic Load known configuration metadata, track only changed keys, submit one atomic batch, and re-read process-independent runtime values.
 * @dependencies Ant Design, React Query, next-intl, api-client
 * @index_tags admin,settings,secrets,configuration,transaction
 * @author holic512
 */
import { useMemo, useState } from 'react'

import { useMutation, useQuery, useQueryClient } from '@tanstack/react-query'
import { Alert, App, Button, Card, Empty, Input, Skeleton, Space, Tag, Typography } from 'antd'
import { Boxes, KeyRound, RefreshCw, RotateCcw, Save, Waypoints } from 'lucide-react'
import { useTranslations } from 'next-intl'

import { apiFetch } from '@/lib/api-client'

type ConfigItem = {
  key: string
  value: string
  description: string
  defaultValue: string
  sensitive?: boolean
  configured?: boolean
}
type ConfigGroup = { key: string; label: string; configs: ConfigItem[] }
type ConfigData = { configs: ConfigItem[]; groups: ConfigGroup[] }

export function SettingsManager() {
  const t = useTranslations('AdminMM.settings')
  const query = useQuery({
    queryKey: ['admin-system-config'],
    queryFn: () => apiFetch<ConfigData>('/api/admin/mm/config'),
  })

  if (query.isLoading) {
    return <div className="admin-editor-loading"><Skeleton active paragraph={{ rows: 10 }} /></div>
  }
  if (query.isError) {
    return <Alert showIcon type="error" message={t('messages.loadFailed')} description={query.error.message} />
  }

  return (
    <SettingsForm
      key={(query.data?.configs || []).map((config) => `${config.key}:${config.value}:${config.configured}`).join('|')}
      data={query.data || { configs: [], groups: [] }}
    />
  )
}

function SettingsForm({ data }: { data: ConfigData }) {
  const t = useTranslations('AdminMM.settings')
  const queryClient = useQueryClient()
  const { message } = App.useApp()
  const initialValues = useMemo(
    () => Object.fromEntries(data.configs.map((config) => [config.key, config.value])),
    [data.configs],
  )
  const [values, setValues] = useState<Record<string, string>>(initialValues)

  const changedKeys = Object.keys(values).filter((key) => values[key] !== initialValues[key])
  const saveMutation = useMutation({
    mutationFn: () =>
      apiFetch<{ updated: number }>('/api/admin/mm/config', {
        method: 'PUT',
        body: JSON.stringify({
          configs: changedKeys.map((key) => ({ key, value: values[key] })),
        }),
      }),
    onSuccess: async () => {
      message.success(t('messages.saveSuccess'))
      await queryClient.invalidateQueries({ queryKey: ['admin-system-config'] })
    },
    onError: (error) => message.error(error.message),
  })
  const refreshMutation = useMutation({
    mutationFn: () =>
      apiFetch('/api/admin/mm/config/refresh', {
        method: 'POST',
        body: JSON.stringify({}),
      }),
    onSuccess: async () => {
      message.success(t('messages.refreshSuccess'))
      await queryClient.invalidateQueries({ queryKey: ['admin-system-config'] })
    },
    onError: (error) => message.error(error.message),
  })

  return (
    <div className="admin-page-stack">
      <div className="admin-page-heading">
        <div>
          <Typography.Title level={2}>{t('title')}</Typography.Title>
          <Typography.Paragraph type="secondary">{t('desc')}</Typography.Paragraph>
        </div>
        <Space wrap>
          <Button
            icon={<RotateCcw size={15} />}
            disabled={!changedKeys.length}
            onClick={() => setValues(initialValues)}
          >
            {t('actions.reset')}
          </Button>
          <Button
            icon={<RefreshCw size={15} />}
            loading={refreshMutation.isPending}
            onClick={() => refreshMutation.mutate()}
          >
            {t('actions.refresh')}
          </Button>
          <Button
            type="primary"
            icon={<Save size={15} />}
            disabled={!changedKeys.length}
            loading={saveMutation.isPending}
            onClick={() => saveMutation.mutate()}
          >
            {t('actions.save')}
          </Button>
        </Space>
      </div>

      <Alert showIcon type="info" message={t('tips.title')} description={t('tips.content')} />
      {changedKeys.length ? <Tag color="warning">{t('unsavedChanges')}</Tag> : null}

      <div className="settings-grid">
        {data.groups.length ? (
          data.groups.map((group) => (
            <Card
              key={group.key}
              className="settings-card"
              title={
                <span className="settings-card-title">
                  {group.key === 'solana' ? <Waypoints size={17} /> : <Boxes size={17} />}
                  {t(`groups.${group.key}`)}
                </span>
              }
            >
              <div className="settings-fields">
                {group.configs.map((config) => {
                  const sensitive =
                    config.sensitive ??
                    (config.key.includes('SECRET') || config.key.endsWith('_KEY'))
                  return (
                    <label key={config.key} className="settings-field">
                      <span className="settings-field-label">
                        <span>
                          {sensitive ? <KeyRound size={13} /> : null}
                          <code>{config.key}</code>
                        </span>
                        {sensitive && config.configured ? <Tag color="success">Configured</Tag> : null}
                      </span>
                      <Typography.Text type="secondary">
                        {t(`configDesc.${config.key}`)}
                      </Typography.Text>
                      <Input.Password
                        visibilityToggle={sensitive}
                        type={sensitive ? undefined : 'text'}
                        value={values[config.key] || ''}
                        placeholder={
                          sensitive && config.configured
                            ? 'Leave blank to keep the stored value'
                            : config.defaultValue || t('placeholder')
                        }
                        onChange={(event) =>
                          setValues((current) => ({ ...current, [config.key]: event.target.value }))
                        }
                      />
                    </label>
                  )
                })}
              </div>
            </Card>
          ))
        ) : (
          <Empty description={t('empty')} />
        )}
      </div>
    </div>
  )
}
