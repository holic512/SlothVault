'use client'

/**
 * @file settings-manager.tsx
 * @project SlothVault
 * @module System Settings Administration
 * @description Provides tabbed configuration controls for branding, evidence policy, protected RPC endpoints, and the one immediately next read-only system Release update without echoing stored secrets.
 * @logic Load known configuration metadata, partition settings by operational risk, stage uploaded logo and favicon paths with explicit synchronization choices, submit one atomic batch, re-read process-independent runtime values, and independently request one safe adjacent GitHub Release update step.
 * @dependencies Ant Design, React Query, next-intl, Next navigation, api-client, system-update API
 * @index_tags admin,settings,branding,logo,favicon,secrets,configuration,transaction,system-update,release
 * @author holic512
 */
import { useMemo, useState } from 'react'

import { useMutation, useQuery, useQueryClient } from '@tanstack/react-query'
import { Alert, App, Button, Card, Descriptions, Empty, Image, Input, Segmented, Skeleton, Space, Switch, Tabs, Tag, Tooltip, Typography, Upload } from 'antd'
import { CircleHelp, ImageUp, KeyRound, RefreshCw, RotateCcw, Save, ServerCog, Waypoints } from 'lucide-react'
import { useLocale, useTranslations } from 'next-intl'
import { useRouter } from 'next/navigation'

import { AdminPage } from '@/components/admin/admin-page'
import { formatAdminDate, formatAdminError } from '@/lib/admin-localization'
import { apiFetch } from '@/lib/api-client'

type ConfigItem = {
  key: string
  value: string
  description: string
  defaultValue: string
  sensitive?: boolean
  configured?: boolean
  previewUrl?: string
  isCustom?: boolean
  kind?: 'boolean' | 'network' | 'url' | 'image' | 'icon'
}
type ConfigGroup = { key: string; label: string; configs: ConfigItem[] }
type ConfigData = { configs: ConfigItem[]; groups: ConfigGroup[] }
type UploadedBrandingFile = { filePath: string; url: string }
type UploadedSystemLogo = { logo: UploadedBrandingFile; favicon: UploadedBrandingFile | null }
type SystemUpdateStatus = 'UP_TO_DATE' | 'UPDATE_AVAILABLE' | 'LOCAL_NEWER' | 'UNVERSIONED' | 'HISTORY_INCOMPLETE' | 'CHECK_FAILED'
type SystemRelease = {
  tag: string
  title: string
  commitSha: string | null
  publishedAt: string | null
  htmlUrl: string
  notes: string
}
type SystemUpdateInfo = {
  checkedAt: string
  status: SystemUpdateStatus
  repository: string
  installed: { packageVersion: string; tag: string | null; commitSha: string | null }
  nextRelease: SystemRelease | null
  historyComplete: boolean
  error: string | null
}

const SYSTEM_FAVICON_CONFIG_KEY = 'SYSTEM_FAVICON_FILE_PATH'

export function SettingsManager() {
  const t = useTranslations('AdminMM.settings')
  const errorT = useTranslations('AdminMM.errors')
  const query = useQuery({
    queryKey: ['admin-system-config'],
    queryFn: () => apiFetch<ConfigData>('/api/admin/mm/config'),
  })

  if (query.isLoading) {
    return (
      <AdminPage>
        <div className="admin-editor-loading"><Skeleton active paragraph={{ rows: 10 }} /></div>
      </AdminPage>
    )
  }
  if (query.isError) {
    return (
      <AdminPage>
        <Alert showIcon type="error" message={t('messages.loadFailed')} description={formatAdminError(query.error, errorT)} />
      </AdminPage>
    )
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
  const errorT = useTranslations('AdminMM.errors')
  const queryClient = useQueryClient()
  const router = useRouter()
  const { message, modal } = App.useApp()
  const initialValues = useMemo(
    () => Object.fromEntries(data.configs.map((config) => [config.key, config.value])),
    [data.configs],
  )
  const [values, setValues] = useState<Record<string, string>>(initialValues)
  const initialPreviewUrls = useMemo(
    () => Object.fromEntries(data.configs.map((config) => [
      config.key,
      config.previewUrl || (config.kind === 'icon' ? '/favicon.ico' : '/logo.png'),
    ])),
    [data.configs],
  )
  const [previewUrls, setPreviewUrls] = useState<Record<string, string>>(initialPreviewUrls)
  const [uploadingBrandingKey, setUploadingBrandingKey] = useState<string | null>(null)
  const [activeTab, setActiveTab] = useState('branding')

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
      router.refresh()
    },
    onError: (error) => message.error(formatAdminError(error, errorT)),
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
    onError: (error) => message.error(formatAdminError(error, errorT)),
  })
  const networkTestMutation = useMutation({
    mutationFn: () => apiFetch('/api/admin/evidence/networks/test', { method: 'POST', body: '{}' }),
    onSuccess: () => message.success(t('messages.networkTestSuccess')),
    onError: (error) => message.error(formatAdminError(error, errorT)),
  })

  const uploadSystemLogo = async (key: string, file: File, syncFavicon: boolean) => {
    const formData = new FormData()
    formData.append('file', file)
    setUploadingBrandingKey(key)
    try {
      const uploaded = await apiFetch<UploadedSystemLogo>(
        `/api/admin/mm/branding/logo?syncFavicon=${syncFavicon}`,
        { method: 'POST', body: formData },
      )
      setValues((current) => ({
        ...current,
        [key]: uploaded.logo.filePath,
        ...(uploaded.favicon ? { [SYSTEM_FAVICON_CONFIG_KEY]: uploaded.favicon.filePath } : {}),
      }))
      setPreviewUrls((current) => ({
        ...current,
        [key]: uploaded.logo.url,
        ...(uploaded.favicon ? { [SYSTEM_FAVICON_CONFIG_KEY]: uploaded.favicon.url } : {}),
      }))
      message.success(t(uploaded.favicon ? 'messages.logoAndFaviconUploadSuccess' : 'messages.uploadSuccess'))
    } catch (error) {
      message.error(formatAdminError(error, errorT))
    } finally {
      setUploadingBrandingKey(null)
    }
  }

  const uploadSystemFavicon = async (key: string, file: File) => {
    const formData = new FormData()
    formData.append('file', file)
    setUploadingBrandingKey(key)
    try {
      const [uploaded] = await apiFetch<UploadedBrandingFile[]>(
        '/api/admin/mm/file?businessType=SystemFavicon',
        { method: 'POST', body: formData },
      )
      if (!uploaded) throw new Error(t('messages.faviconUploadFailed'))
      setValues((current) => ({ ...current, [key]: uploaded.filePath }))
      setPreviewUrls((current) => ({ ...current, [key]: uploaded.url }))
      message.success(t('messages.faviconUploadSuccess'))
    } catch (error) {
      message.error(formatAdminError(error, errorT))
    } finally {
      setUploadingBrandingKey(null)
    }
  }

  const confirmLogoUpload = (key: string, file: File) => {
    modal.confirm({
      title: t('logo.syncConfirmTitle'),
      content: t('logo.syncConfirmDescription'),
      okText: t('logo.syncConfirmOk'),
      cancelText: t('logo.syncConfirmCancel'),
      closable: false,
      keyboard: false,
      maskClosable: false,
      onOk: () => uploadSystemLogo(key, file, true),
      onCancel: () => uploadSystemLogo(key, file, false),
    })
  }

  const renderConfig = (config: ConfigItem) => {
    const sensitive =
      config.sensitive ??
      (config.key.includes('SECRET') || config.key.endsWith('_KEY'))
    return (
      <label key={config.key} className="settings-field">
        <span className="settings-field-label">
          <span>
            {sensitive ? <KeyRound size={13} /> : null}
            {config.kind === 'image'
              ? t('logo.fieldLabel')
              : config.kind === 'icon'
                ? t('favicon.fieldLabel')
                : <code>{config.key}</code>}
          </span>
          {sensitive && config.configured ? <Tag color="success">{t('configured')}</Tag> : null}
        </span>
        <Typography.Text type="secondary">
          {t(`configDesc.${config.key}`)}
        </Typography.Text>
        {config.kind === 'boolean' ? (
          <Switch
            checked={values[config.key] === 'true'}
            checkedChildren={t('enabled')}
            unCheckedChildren={t('disabled')}
            onChange={(checked) => setValues((current) => ({ ...current, [config.key]: String(checked) }))}
          />
        ) : config.kind === 'network' ? (
          <Segmented
            value={values[config.key]}
            options={[{ value: 'devnet', label: t('network.devnet') }, { value: 'mainnet', label: t('network.mainnet') }]}
            onChange={(value) => setValues((current) => ({ ...current, [config.key]: String(value) }))}
          />
        ) : config.kind === 'image' || config.kind === 'icon' ? (
          <div className="settings-logo-control">
            <Image
              className="settings-logo-preview"
              src={previewUrls[config.key] || (config.kind === 'icon' ? '/favicon.ico' : '/logo.png')}
              alt={config.kind === 'icon' ? t('favicon.previewAlt') : t('logo.previewAlt')}
              preview={false}
            />
            <Space wrap>
              <Upload
                accept={config.kind === 'icon' ? '.ico,image/x-icon' : 'image/png,image/jpeg,image/gif,image/webp'}
                maxCount={1}
                showUploadList={false}
                beforeUpload={(file) => {
                  if (config.kind === 'icon') void uploadSystemFavicon(config.key, file)
                  else confirmLogoUpload(config.key, file)
                  return false
                }}
              >
                <Button icon={<ImageUp size={15} />} loading={uploadingBrandingKey === config.key}>
                  {config.kind === 'icon' ? t('actions.uploadFavicon') : t('actions.uploadLogo')}
                </Button>
              </Upload>
              <Button
                disabled={!values[config.key]}
                onClick={() => {
                  setValues((current) => ({ ...current, [config.key]: '' }))
                  setPreviewUrls((current) => ({
                    ...current,
                    [config.key]: config.kind === 'icon' ? '/favicon.ico' : '/logo.png',
                  }))
                }}
              >
                {config.kind === 'icon' ? t('actions.restoreDefaultFavicon') : t('actions.restoreDefaultLogo')}
              </Button>
              {config.isCustom && !values[config.key] ? <Tag color="warning">{config.kind === 'icon' ? t('favicon.pendingDefault') : t('logo.pendingDefault')}</Tag> : null}
            </Space>
            <Typography.Text type="secondary">
              {config.kind === 'icon' ? t('favicon.uploadHint') : t('logo.uploadHint')}
            </Typography.Text>
          </div>
        ) : sensitive ? (
          <Input.Password
            visibilityToggle
            value={values[config.key] || ''}
            placeholder={config.configured ? t('placeholderConfigured') : config.defaultValue || 'https://…'}
            onChange={(event) => setValues((current) => ({ ...current, [config.key]: event.target.value }))}
          />
        ) : (
          <Input
            value={values[config.key] || ''}
            placeholder={config.defaultValue || t('placeholder')}
            onChange={(event) => setValues((current) => ({ ...current, [config.key]: event.target.value }))}
          />
        )}
      </label>
    )
  }

  const brandingConfigs = data.groups.find((group) => group.key === 'branding')?.configs || []
  const evidenceConfigs = data.groups.find((group) => group.key === 'evidence')?.configs || []
  const policyConfigs = evidenceConfigs.filter((config) => !config.key.includes('_RPC_'))
  const rpcConfigs = evidenceConfigs.filter((config) => config.key.includes('_RPC_'))
  const tabs = [
    {
      key: 'branding',
      label: t('tabs.branding.label'),
      description: t('tabs.branding.description'),
      icon: <ImageUp size={16} />,
      configs: brandingConfigs,
    },
    {
      key: 'policy',
      label: t('tabs.policy.label'),
      description: t('tabs.policy.description'),
      icon: <Waypoints size={16} />,
      configs: policyConfigs,
    },
    {
      key: 'rpc',
      label: t('tabs.rpc.label'),
      description: t('tabs.rpc.description'),
      icon: <ServerCog size={16} />,
      configs: rpcConfigs,
    },
    {
      key: 'updates',
      label: t('tabs.updates.label'),
      description: t('tabs.updates.description'),
      icon: <RefreshCw size={16} />,
      configs: [],
    },
  ]

  return (
    <AdminPage>
      <Tabs
        className="settings-tabs"
        activeKey={activeTab}
        onChange={setActiveTab}
        tabBarExtraContent={activeTab === 'updates' ? null : <Space className="settings-tabs-actions" wrap size={6}>
          <Tooltip title={t('tips.content')}>
            <Button type="text" icon={<CircleHelp size={15} />} aria-label={t('tips.title')}>
              {t('tips.title')}
            </Button>
          </Tooltip>
          <Button
            icon={<RotateCcw size={15} />}
            disabled={!changedKeys.length}
            onClick={() => {
              setValues(initialValues)
              setPreviewUrls(initialPreviewUrls)
            }}
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
          {changedKeys.length ? <Tag color="warning">{t('unsavedChanges')}</Tag> : null}
          <Button
            type="primary"
            icon={<Save size={15} />}
            disabled={!changedKeys.length}
            loading={saveMutation.isPending}
            onClick={() => saveMutation.mutate()}
          >
            {t('actions.save')}
          </Button>
        </Space>}
        items={tabs.map((tab) => ({
          key: tab.key,
          label: <span className="settings-tab-label">{tab.icon}<span>{tab.label}</span></span>,
          children: <section className="settings-tab-panel">
            <div className="settings-tab-heading">
              <span className="settings-tab-icon">{tab.icon}</span>
              <div>
                <Typography.Title level={4}>{tab.label}</Typography.Title>
                <Typography.Text type="secondary">{tab.description}</Typography.Text>
              </div>
            </div>
            {tab.key === 'updates' ? <SystemUpdatePanel /> : <>
              {tab.key === 'rpc' ? <Alert className="settings-rpc-notice" showIcon type="info" message={t('tabs.rpc.noticeTitle')} description={t('tabs.rpc.noticeDescription')} action={<Button size="small" loading={networkTestMutation.isPending} onClick={() => networkTestMutation.mutate()}>{t('tabs.rpc.test')}</Button>} /> : null}
              {tab.configs.length ? <Card className="settings-card" title={<span className="settings-card-title">{tab.icon}{tab.key === 'branding' ? t('branding.cardTitle') : t('tabs.fieldsCount', { count: tab.configs.length })}</span>}><div className="settings-fields">{tab.configs.map(renderConfig)}</div></Card> : <Empty description={t('empty')} />}
            </>}
          </section>,
        }))}
      />
    </AdminPage>
  )
}

function SystemUpdatePanel() {
  const t = useTranslations('AdminMM.settings')
  const errorT = useTranslations('AdminMM.errors')
  const locale = useLocale()
  const query = useQuery({
    queryKey: ['admin-system-update'],
    queryFn: () => apiFetch<SystemUpdateInfo>('/api/admin/mm/system-update'),
  })

  if (query.isLoading) return <Skeleton active paragraph={{ rows: 8 }} />
  if (query.isError) {
    return <Alert
      showIcon
      type="error"
      message={t('updates.messages.loadFailed')}
      description={formatAdminError(query.error, errorT)}
      action={<Button size="small" onClick={() => void query.refetch()}>{t('updates.actions.retry')}</Button>}
    />
  }

  const data = query.data
  if (!data) return <Empty description={t('updates.messages.empty')} />
  const statusTone: Record<SystemUpdateStatus, 'success' | 'warning' | 'processing' | 'default' | 'error'> = {
    UP_TO_DATE: 'success',
    UPDATE_AVAILABLE: 'warning',
    LOCAL_NEWER: 'processing',
    UNVERSIONED: 'default',
    HISTORY_INCOMPLETE: 'warning',
    CHECK_FAILED: 'error',
  }
  const version = (tag: string | null, fallback: string) => tag || fallback
  const date = (value: string | null) => value ? formatAdminDate(locale, value) : t('updates.values.unavailable')

  return <>
    <Alert
      className="settings-update-notice"
      showIcon
      type={data.status === 'CHECK_FAILED' ? 'error' : data.status === 'UPDATE_AVAILABLE' || data.status === 'HISTORY_INCOMPLETE' ? 'warning' : 'info'}
      message={t(`updates.status.${data.status}`)}
      description={t('updates.notice')}
      action={<Button size="small" icon={<RefreshCw size={14} />} loading={query.isFetching} onClick={() => void query.refetch()}>{t('updates.actions.check')}</Button>}
    />
    <Card className="settings-card settings-update-card" title={<span className="settings-card-title"><RefreshCw size={16} />{t('updates.cardTitle')}</span>}>
      <Space direction="vertical" size={12} style={{ width: '100%' }}>
        <Space wrap size={8}>
          <Tag color={statusTone[data.status]}>{t(`updates.status.${data.status}`)}</Tag>
          <Typography.Text type="secondary">{t('updates.checkedAt', { date: date(data.checkedAt) })}</Typography.Text>
        </Space>
        <Descriptions column={{ xs: 1, sm: 2 }} size="small">
          <Descriptions.Item label={t('updates.fields.installedVersion')}>
            <Typography.Text code>{version(data.installed.tag, data.installed.packageVersion)}</Typography.Text>
          </Descriptions.Item>
          <Descriptions.Item label={t('updates.fields.installedCommit')}>
            <Typography.Text code>{data.installed.commitSha?.slice(0, 12) || t('updates.values.unavailable')}</Typography.Text>
          </Descriptions.Item>
          <Descriptions.Item label={t('updates.fields.nextVersion')}>
            <Typography.Text code>{data.nextRelease?.tag || t('updates.values.unavailable')}</Typography.Text>
          </Descriptions.Item>
          <Descriptions.Item label={t('updates.fields.nextCommit')}>
            <Typography.Text code>{data.nextRelease?.commitSha?.slice(0, 12) || t('updates.values.unavailable')}</Typography.Text>
          </Descriptions.Item>
          <Descriptions.Item label={t('updates.fields.publishedAt')}>
            {date(data.nextRelease?.publishedAt || null)}
          </Descriptions.Item>
          <Descriptions.Item label={t('updates.fields.repository')}>
            <Typography.Text code>{data.repository}</Typography.Text>
          </Descriptions.Item>
        </Descriptions>
        {!data.historyComplete && data.status !== 'CHECK_FAILED' ? <Alert showIcon type="warning" message={t('updates.messages.historyIncomplete')} /> : null}
        {data.error ? <Typography.Text type="secondary">{t(`updates.errors.${data.error}`)}</Typography.Text> : null}
        {data.nextRelease ? <Card className="settings-update-next-release" size="small" title={<span className="settings-card-title"><RefreshCw size={15} />{t('updates.nextRelease.title')}</span>}>
          <Space direction="vertical" size={8} style={{ width: '100%' }}>
            <Space size={8} wrap><Typography.Text strong code>{data.nextRelease.tag}</Typography.Text><Typography.Text type="secondary">{data.nextRelease.title}</Typography.Text></Space>
            <Typography.Text type="secondary">{date(data.nextRelease.publishedAt)} · {data.nextRelease.commitSha?.slice(0, 12) || t('updates.values.unavailable')}</Typography.Text>
            <Typography.Paragraph className="settings-update-notes">{data.nextRelease.notes || t('updates.values.noNotes')}</Typography.Paragraph>
            <Typography.Link href={data.nextRelease.htmlUrl} target="_blank" rel="noreferrer">{t('updates.actions.openRelease')}</Typography.Link>
          </Space>
        </Card> : null}
      </Space>
    </Card>
  </>
}
