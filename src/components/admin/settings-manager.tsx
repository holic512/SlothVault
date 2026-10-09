'use client'

/**
 * @file settings-manager.tsx
 * @project SlothVault
 * @module System Settings Administration
 * @description Provides route-based settings navigation with shared drafts, per-section unsaved indicators, protected RPC fields, and read-only system updates.
 * @logic Retain drafts and upload previews in the shared layout, reconcile server reloads without discarding edits, save every changed field with confirmed readback, and render the selected child page.
 * @dependencies Ant Design, React Query, next-intl, Next navigation, admin-settings-draft, api-client, system-update API
 * @index_tags admin,settings,routing,draft,branding,filing,logo,favicon,secrets,configuration,system-update,release
 * @author holic512
 */
import { createContext, useContext, useReducer, useState, type ReactNode } from 'react'

import { useMutation, useQuery, useQueryClient } from '@tanstack/react-query'
import { Alert, App, Button, Card, Descriptions, Empty, Image, Input, Segmented, Skeleton, Space, Switch, Tag, Tooltip, Typography, Upload } from 'antd'
import { CircleHelp, FileBadge, ImageUp, KeyRound, RefreshCw, RotateCcw, Save, ServerCog, Waypoints } from 'lucide-react'
import { useLocale, useTranslations } from 'next-intl'
import Link from 'next/link'
import { useRouter, useSelectedLayoutSegment } from 'next/navigation'

import { AdminPage } from '@/components/admin/admin-page'
import { formatAdminDate, formatAdminError } from '@/lib/admin-localization'
import {
  ADMIN_SETTINGS_ENDPOINT,
  ADMIN_SETTINGS_QUERY_KEY,
  SETTINGS_SECTIONS,
  SettingsReadbackError,
  createSettingsDraftState,
  getSettingsChangedKeys,
  getSettingsDirtySections,
  getSettingsSectionConfigs,
  getSettingsSectionPath,
  saveSettingsDraft,
  settingsDraftReducer,
  type SettingsConfigData as ConfigData,
  type SettingsConfigItem as ConfigItem,
  type SettingsSectionKey,
} from '@/lib/admin-settings-draft'
import { apiFetch } from '@/lib/api-client'

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
  latestRelease: SystemRelease | null
  newerReleases: SystemRelease[]
  nextRelease: SystemRelease | null
  historyComplete: boolean
  error: string | null
}

const SYSTEM_FAVICON_CONFIG_KEY = 'SYSTEM_FAVICON_FILE_PATH'
const SECTION_ICONS = { branding: ImageUp, filing: FileBadge, policy: Waypoints, rpc: ServerCog, updates: RefreshCw }

type SettingsContextValue = {
  data: ConfigData | null
  loading: boolean
  error: Error | null
  retry: () => void
  renderConfig: (config: ConfigItem) => ReactNode
  testNetwork: () => void
  testingNetwork: boolean
}
const SettingsContext = createContext<SettingsContextValue | null>(null)

export function SettingsManager({ children }: { children: ReactNode }) {
  const t = useTranslations('AdminMM.settings')
  const errorT = useTranslations('AdminMM.errors')
  const queryClient = useQueryClient()
  const router = useRouter()
  const activeSection = useSelectedLayoutSegment()
  const { message, modal } = App.useApp()
  const query = useQuery({
    queryKey: ADMIN_SETTINGS_QUERY_KEY,
    queryFn: ({ signal }) => apiFetch<ConfigData>(ADMIN_SETTINGS_ENDPOINT, { signal }),
  })
  const [draft, dispatch] = useReducer(settingsDraftReducer, query.data || null, createSettingsDraftState)
  const [uploadingBrandingKey, setUploadingBrandingKey] = useState<string | null>(null)

  // Reconcile a new query snapshot without remounting the shared draft or its route children.
  if (query.data && query.data !== draft.data) {
    dispatch({ type: 'received', data: query.data })
  }

  const { values, previewUrls } = draft
  const changedKeys = getSettingsChangedKeys(draft)
  const dirtySections = new Set(getSettingsDirtySections(draft))
  const saveMutation = useMutation({
    mutationFn: async (configs: { key: string; value: string }[]) => {
      await queryClient.cancelQueries({ queryKey: ADMIN_SETTINGS_QUERY_KEY })
      return saveSettingsDraft(configs)
    },
    onSuccess: async (data) => {
      await queryClient.cancelQueries({ queryKey: ADMIN_SETTINGS_QUERY_KEY })
      const cached = queryClient.setQueryData<ConfigData>(ADMIN_SETTINGS_QUERY_KEY, data)
      dispatch({ type: 'saved', data: cached || data })
      message.success(t('messages.saveSuccess'))
      router.refresh()
    },
    onError: (error) => message.error(error instanceof SettingsReadbackError
      ? t('messages.saveReloadFailed')
      : formatAdminError(error, errorT)),
  })
  const refreshMutation = useMutation({
    mutationFn: async () => {
      await queryClient.cancelQueries({ queryKey: ADMIN_SETTINGS_QUERY_KEY })
      await apiFetch('/api/admin/mm/config/refresh', {
        method: 'POST',
        body: JSON.stringify({}),
      })
      return apiFetch<ConfigData>(ADMIN_SETTINGS_ENDPOINT, { cache: 'no-store' })
    },
    onSuccess: async (data) => {
      await queryClient.cancelQueries({ queryKey: ADMIN_SETTINGS_QUERY_KEY })
      const cached = queryClient.setQueryData<ConfigData>(ADMIN_SETTINGS_QUERY_KEY, data)
      dispatch({ type: 'received', data: cached || data })
      message.success(t('messages.refreshSuccess'))
    },
    onError: (error) => message.error(formatAdminError(error, errorT)),
  })
  const busy = saveMutation.isPending || refreshMutation.isPending || uploadingBrandingKey !== null
  const editingLocked = saveMutation.isPending
  const filingConfigs = getSettingsSectionConfigs(draft.data, 'filing')
  const setValue = (key: string, value: string) => dispatch({ type: 'edit', values: { [key]: value } })
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
      dispatch({
        type: 'edit',
        values: {
          [key]: uploaded.logo.filePath,
          ...(uploaded.favicon ? { [SYSTEM_FAVICON_CONFIG_KEY]: uploaded.favicon.filePath } : {}),
        },
        previewUrls: {
          [key]: uploaded.logo.url,
          ...(uploaded.favicon ? { [SYSTEM_FAVICON_CONFIG_KEY]: uploaded.favicon.url } : {}),
        },
      })
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
      dispatch({ type: 'edit', values: { [key]: uploaded.filePath }, previewUrls: { [key]: uploaded.url } })
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
      mask: { closable: false },
      onOk: () => { void uploadSystemLogo(key, file, true) },
      onCancel: () => { void uploadSystemLogo(key, file, false) },
    })
  }

  const renderConfig = (config: ConfigItem) => {
    const isFiling = filingConfigs.some((item) => item.key === config.key)
    const sensitive =
      config.sensitive ??
      (config.key.includes('SECRET') || config.key.endsWith('_KEY'))
    return (
      <label key={config.key} className="settings-field">
        <span className="settings-field-label">
          <span>
            {sensitive ? <KeyRound size={13} /> : null}
            {isFiling
              ? t(`filing.fields.${config.key}`)
              : config.kind === 'image'
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
            disabled={editingLocked}
            checked={values[config.key] === 'true'}
            checkedChildren={t('enabled')}
            unCheckedChildren={t('disabled')}
            onChange={(checked) => setValue(config.key, String(checked))}
          />
        ) : config.kind === 'network' ? (
          <Segmented
            disabled={editingLocked}
            value={values[config.key]}
            options={[{ value: 'devnet', label: t('network.devnet') }, { value: 'mainnet', label: t('network.mainnet') }]}
            onChange={(value) => setValue(config.key, String(value))}
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
                disabled={busy}
                accept={config.kind === 'icon' ? '.ico,image/x-icon' : 'image/png,image/jpeg,image/gif,image/webp'}
                maxCount={1}
                showUploadList={false}
                beforeUpload={(file) => {
                  if (config.kind === 'icon') void uploadSystemFavicon(config.key, file)
                  else confirmLogoUpload(config.key, file)
                  return false
                }}
              >
                <Button disabled={busy} icon={<ImageUp size={15} />} loading={uploadingBrandingKey === config.key}>
                  {config.kind === 'icon' ? t('actions.uploadFavicon') : t('actions.uploadLogo')}
                </Button>
              </Upload>
              <Button
                disabled={busy || !values[config.key]}
                onClick={() => {
                  dispatch({
                    type: 'edit',
                    values: { [config.key]: '' },
                    previewUrls: { [config.key]: config.kind === 'icon' ? '/favicon.ico' : '/logo.png' },
                  })
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
            disabled={editingLocked}
            visibilityToggle
            value={values[config.key] || ''}
            placeholder={config.configured ? t('placeholderConfigured') : config.defaultValue || 'https://…'}
            onChange={(event) => setValue(config.key, event.target.value)}
          />
        ) : (
          <Input
            disabled={editingLocked}
            value={values[config.key] || ''}
            maxLength={isFiling ? 500 : undefined}
            type={isFiling && config.kind === 'url' ? 'url' : 'text'}
            placeholder={config.defaultValue || t('placeholder')}
            onChange={(event) => setValue(config.key, event.target.value)}
          />
        )}
      </label>
    )
  }

  return (
    <SettingsContext.Provider value={{
      data: draft.data,
      loading: query.isLoading,
      error: query.error,
      retry: () => { void query.refetch() },
      renderConfig,
      testNetwork: () => networkTestMutation.mutate(),
      testingNetwork: networkTestMutation.isPending,
    }}>
      <AdminPage>
        <div className="settings-tabs">
          <div className="settings-tabs-nav">
            <SettingsNavigation activeSection={activeSection} dirtySections={dirtySections} />
            {activeSection !== 'updates' || changedKeys.length ? <Space className="settings-tabs-actions" wrap size={6}>
              {activeSection !== 'updates' ? <Tooltip title={t('tips.content')}>
                <Button type="text" icon={<CircleHelp size={15} />} aria-label={t('tips.title')}>
                  {t('tips.title')}
                </Button>
              </Tooltip> : null}
              <Tooltip title={t('actions.resetAllHint')}>
                <Button
                  icon={<RotateCcw size={15} />}
                  disabled={busy || !changedKeys.length}
                  onClick={() => dispatch({ type: 'reset' })}
                >
                  {t('actions.reset')}
                </Button>
              </Tooltip>
              {activeSection !== 'updates' ? <Button
                icon={<RefreshCw size={15} />}
                disabled={busy || !draft.data}
                loading={refreshMutation.isPending}
                onClick={() => refreshMutation.mutate()}
              >
                {t('actions.refresh')}
              </Button> : null}
              {changedKeys.length ? <Tag color="warning" role="status">{t('unsavedChanges')}</Tag> : null}
              <Tooltip title={t('actions.saveAllHint')}>
                <Button
                  type="primary"
                  icon={<Save size={15} />}
                  disabled={busy || !changedKeys.length}
                  loading={saveMutation.isPending}
                  onClick={() => saveMutation.mutate(changedKeys.map((key) => ({ key, value: values[key] })))}
                >
                  {t('actions.save')}
                </Button>
              </Tooltip>
            </Space> : null}
          </div>
          <div className="settings-route-content">{children}</div>
        </div>
      </AdminPage>
    </SettingsContext.Provider>
  )
}

export function SettingsNavigation({
  activeSection,
  dirtySections,
}: {
  activeSection: string | null
  dirtySections: ReadonlySet<SettingsSectionKey>
}) {
  const t = useTranslations('AdminMM.settings')

  return <nav className="settings-tabs-links" aria-label={t('navigationLabel')}>
    {SETTINGS_SECTIONS.map((section) => {
      const Icon = SECTION_ICONS[section]
      const label = t(`tabs.${section}.label`)
      const dirty = dirtySections.has(section)
      const description = dirty ? `${label}: ${t('unsavedChanges')}` : undefined
      return <Link
        key={section}
        href={getSettingsSectionPath(section)}
        scroll={false}
        className={`settings-tab-link${activeSection === section ? ' is-active' : ''}`}
        aria-current={activeSection === section ? 'page' : undefined}
        aria-label={description}
        title={description}
      >
        <span className="settings-tab-label">
          <Icon size={16} />
          <span>{label}</span>
          {dirty ? <span className="settings-tab-dirty-dot" aria-hidden="true" /> : null}
        </span>
      </Link>
    })}
  </nav>
}

export function SettingsSection({ section }: { section: SettingsSectionKey }) {
  const t = useTranslations('AdminMM.settings')
  const errorT = useTranslations('AdminMM.errors')
  const context = useContext(SettingsContext)
  if (!context) throw new Error('SettingsSection requires the shared settings layout')
  const Icon = SECTION_ICONS[section]
  const configs = getSettingsSectionConfigs(context.data, section)

  return <section className="settings-tab-panel">
    <div className="settings-tab-heading">
      <span className="settings-tab-icon"><Icon size={16} /></span>
      <div>
        <Typography.Title level={4}>{t(`tabs.${section}.label`)}</Typography.Title>
        <Typography.Text type="secondary">{t(`tabs.${section}.description`)}</Typography.Text>
      </div>
    </div>
    {section === 'updates' ? <SystemUpdatePanel /> : <>
      {context.error ? <Alert
        showIcon
        type="error"
        title={t('messages.loadFailed')}
        description={formatAdminError(context.error, errorT)}
        action={<Button size="small" onClick={context.retry}>{t('updates.actions.retry')}</Button>}
      /> : null}
      {!context.data && context.loading ? <Skeleton active paragraph={{ rows: 10 }} /> : context.data ? <>
        {section === 'rpc' ? <Alert
          className="settings-rpc-notice"
          showIcon
          type="info"
          title={t('tabs.rpc.noticeTitle')}
          description={t('tabs.rpc.noticeDescription')}
          action={<Button size="small" loading={context.testingNetwork} onClick={context.testNetwork}>{t('tabs.rpc.test')}</Button>}
        /> : null}
        {configs.length ? <Card
          className="settings-card"
          title={<span className="settings-card-title"><Icon size={16} />{section === 'branding' ? t('branding.cardTitle') : t('tabs.fieldsCount', { count: configs.length })}</span>}
        >
          <div className="settings-fields">{configs.map(context.renderConfig)}</div>
        </Card> : <Empty description={t('empty')} />}
      </> : null}
    </>}
  </section>
}

function SystemUpdatePanel() {
  const t = useTranslations('AdminMM.settings')
  const errorT = useTranslations('AdminMM.errors')
  const locale = useLocale()
  const queryClient = useQueryClient()
  const query = useQuery({
    queryKey: ['admin-system-update'],
    queryFn: () => apiFetch<SystemUpdateInfo>('/api/admin/mm/system-update'),
  })
  const refresh = useMutation({
    mutationFn: () => apiFetch<SystemUpdateInfo>('/api/admin/mm/system-update?refresh=1', { cache: 'no-store' }),
    onSuccess: (value) => queryClient.setQueryData(['admin-system-update'], value),
  })

  if (query.isLoading) return <Skeleton active paragraph={{ rows: 8 }} />
  if (query.isError) {
    return <Alert
      showIcon
      type="error"
      title={t('updates.messages.loadFailed')}
      description={formatAdminError(query.error, errorT)}
      action={<Button size="small" loading={refresh.isPending} onClick={() => refresh.mutate()}>{t('updates.actions.retry')}</Button>}
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
      title={t(`updates.status.${data.status}`)}
      description={t('updates.notice')}
      action={<Button size="small" icon={<RefreshCw size={14} />} loading={refresh.isPending} onClick={() => refresh.mutate()}>{t('updates.actions.check')}</Button>}
    />
    {refresh.isError ? <Alert showIcon type="error" title={t('updates.messages.loadFailed')} description={formatAdminError(refresh.error, errorT)} /> : null}
    <Card className="settings-card settings-update-card" title={<span className="settings-card-title"><RefreshCw size={16} />{t('updates.cardTitle')}</span>}>
      <Space orientation="vertical" size={12} style={{ width: '100%' }}>
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
          <Descriptions.Item label={t('updates.fields.latestVersion')}>
            <Typography.Text code>{data.latestRelease?.tag || t('updates.values.unavailable')}</Typography.Text>
          </Descriptions.Item>
          <Descriptions.Item label={t('updates.fields.latestCommit')}>
            <Typography.Text code>{data.latestRelease?.commitSha?.slice(0, 12) || t('updates.values.unavailable')}</Typography.Text>
          </Descriptions.Item>
          <Descriptions.Item label={t('updates.fields.publishedAt')}>
            {date(data.latestRelease?.publishedAt || null)}
          </Descriptions.Item>
          <Descriptions.Item label={t('updates.fields.repository')}>
            <Typography.Text code>{data.repository}</Typography.Text>
          </Descriptions.Item>
        </Descriptions>
        {!data.historyComplete && data.status !== 'CHECK_FAILED' ? <Alert showIcon type="warning" title={t('updates.messages.historyIncomplete')} /> : null}
        {data.error ? <Typography.Text type="secondary">{t(`updates.errors.${data.error}`)}</Typography.Text> : null}
        {data.newerReleases.length ? <Card className="settings-update-next-release" size="small" title={<span className="settings-card-title"><RefreshCw size={15} />{t('updates.newerReleases.title')}</span>}>
          <div>
            {data.newerReleases.map((release) => <section className="settings-update-release-entry" key={release.tag}>
              <Space orientation="vertical" size={8} style={{ width: '100%' }}>
                <Space size={8} wrap><Typography.Text strong code>{release.tag}</Typography.Text><Typography.Text type="secondary">{release.title}</Typography.Text></Space>
                <Typography.Text type="secondary">{date(release.publishedAt)} · {release.commitSha?.slice(0, 12) || t('updates.values.unavailable')}</Typography.Text>
                <Typography.Paragraph className="settings-update-notes">{release.notes || t('updates.values.noNotes')}</Typography.Paragraph>
                <Typography.Link href={release.htmlUrl} target="_blank" rel="noreferrer">{t('updates.actions.openRelease')}</Typography.Link>
              </Space>
            </section>)}
          </div>
        </Card> : null}
      </Space>
    </Card>
  </>
}
