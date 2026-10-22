'use client'
/**
 * @file plugin-installer.tsx
 * @project SlothVault
 * @module Plugin Source Installer
 * @description Offers a bundled official catalog and manual source ZIP upload through one preview/install flow.
 * @logic Discover releases on demand, bind official package identity, and require trust before compilation and installation.
 * @dependencies Ant Design, React Query, plugin admin APIs
 * @index_tags plugins,installer,catalog,source
 * @author holic512
 */
import { PluginUpdater } from './plugin-updater'
import { pluginErrorKey, pluginText } from '@/lib/plugin-presentation'
import { useState } from 'react'
import { Alert, App, Button, Checkbox, Collapse, Descriptions, Empty, Input, Modal, Select, Space, Spin, Tabs, Tag, Typography, Upload } from 'antd'
import { useMutation, useQuery } from '@tanstack/react-query'
import { useLocale, useTranslations } from 'next-intl'
import type { PluginListItem, PluginManifest } from '@slothvault/plugin-sdk/protocol'
import { apiFetch } from '@/lib/api-client'
type Catalog = { id: string; name: string; nameZh: string; description: string; descriptionZh: string; repository: string; tagPrefix: string }
type Release = { repository: string; tag: string; asset: string; notes: string; size: number; version: string }
type Preview = { manifest: PluginManifest; digest: string; source: string | null }
function NewPluginInstaller({ installed, initialId, onClose, onInstalled }: { installed: PluginListItem[]; initialId?: string; onClose: () => void; onInstalled: () => Promise<void> }) {
  const t = useTranslations('AdminMM.plugins'), locale = useLocale(), { message } = App.useApp()
  const [tab, setTab] = useState('official'), [selected, setSelected] = useState<string | undefined>(initialId)
  const [repository, setRepository] = useState(''), [manualRepo, setManualRepo] = useState('')
  const [releaseKey, setReleaseKey] = useState<string>(), [preview, setPreview] = useState<Preview | null>(null), [trusted, setTrusted] = useState(false)
  const catalog = useQuery({ queryKey: ['plugin-catalog'], queryFn: () => apiFetch<Catalog[]>('/api/admin/mm/plugins/sources') })
  const official = catalog.data?.find(item => item.id === selected)
  const source = tab === 'official' ? official?.id : manualRepo
  const releases = useQuery({ queryKey: ['plugin-releases', tab, source], enabled: !!source, retry: false,
    queryFn: () => apiFetch<Release[]>(`/api/admin/mm/plugins/sources?${tab === 'official' ? 'pluginId' : 'repository'}=${encodeURIComponent(source!)}`),
  })
  const inspect = useMutation({
    mutationFn: ({ file, release, pluginId }: { file?: File; release?: Release; pluginId?: string }) => file
      ? apiFetch<Preview>('/api/admin/mm/plugins', { method: 'POST', headers: { 'Content-Type': 'application/zip' }, body: file })
      : apiFetch<Preview>('/api/admin/mm/plugins', { method: 'POST', body: JSON.stringify({ repository: release!.repository, tag: release!.tag, asset: release!.asset, pluginId }) }),
    onMutate: () => { setPreview(null); setTrusted(false) },
    onSuccess: setPreview,
  })
  const install = useMutation({
    mutationFn: () => apiFetch(`/api/admin/mm/plugins/${preview!.manifest.id}`, { method: 'POST', body: JSON.stringify({ action: 'install', digest: preview!.digest, source: preview!.source, trusted }) }),
    onSuccess: async () => { message.success(t('saved')); await onInstalled(); onClose() },
  })
  const busy = inspect.isPending || install.isPending
  const reset = () => { setPreview(null); setTrusted(false); setReleaseKey(undefined); inspect.reset(); install.reset() }
  const chosen = releases.data?.find(item => `${item.tag}/${item.asset}` === releaseKey)
  const releasePicker = source ? <Space orientation="vertical" style={{ width: '100%' }}>
    <Space><Typography.Text strong>{t('availableVersions')}</Typography.Text><Button size="small" disabled={busy} loading={releases.isFetching} onClick={() => void releases.refetch()}>{t('checkReleases')}</Button></Space>
    {releases.isPending ? <Spin /> : releases.error ? <Alert type="error" showIcon title={t(`errors.${pluginErrorKey(releases.error)}`)} /> : !releases.data?.length ? <Empty image={Empty.PRESENTED_IMAGE_SIMPLE} description={t('noRelease')} /> : <Space.Compact style={{ width: '100%' }}>
      <Select style={{ flex: 1, minWidth: 0 }} placeholder={t('selectVersion')} disabled={busy} value={releaseKey} onChange={value => { reset(); setReleaseKey(value) }} options={releases.data.map(item => ({ value: `${item.tag}/${item.asset}`, label: `${item.version} · ${item.tag}` }))} />
      <Button disabled={!chosen || busy} loading={inspect.isPending} onClick={() => chosen && inspect.mutate({ release: chosen, pluginId: tab === 'official' ? selected : undefined })}>{t('preview')}</Button>
    </Space.Compact>}
    {chosen?.notes && <Typography.Paragraph ellipsis={{ rows: 3, expandable: true }}>{chosen.notes}</Typography.Paragraph>}
  </Space> : null
  return <Modal width={820} open title={t('install')} onCancel={busy ? undefined : onClose} closable={!busy} maskClosable={!busy} footer={null}>
    <Space orientation="vertical" size="middle" style={{ width: '100%' }}>
      <Tabs activeKey={tab} onChange={value => { reset(); setTab(value) }} items={[
        { key: 'official', label: t('officialCatalog'), disabled: busy, children: <Space orientation="vertical" size="middle" style={{ width: '100%' }}>
          {catalog.isPending && <Spin />}{catalog.error && <Alert type="error" title={t(`errors.${pluginErrorKey(catalog.error)}`)} action={<Button onClick={() => void catalog.refetch()}>{t('refresh')}</Button>} />}
          {catalog.isSuccess && !catalog.data.length && <Empty image={Empty.PRESENTED_IMAGE_SIMPLE} description={t('noOfficialPlugins')} />}
          {catalog.data?.map(item => { const current = installed.find(value => value.id === item.id && value.installed); return <div key={item.id} className={`plugin-catalog-entry${selected === item.id ? ' is-selected' : ''}`}>
            <div><Typography.Text strong>{locale === 'zh' ? item.nameZh : item.name}</Typography.Text> <Tag>{t('official')}</Tag><div><Typography.Text type="secondary">{item.id}{current ? ` · ${t('installedVersion')} ${current.version}` : ''}</Typography.Text></div><Typography.Paragraph>{locale === 'zh' ? item.descriptionZh : item.description}</Typography.Paragraph></div>
            <Button disabled={busy} type={selected === item.id ? 'primary' : 'default'} onClick={() => { reset(); setSelected(item.id) }}>{current ? t('checkUpdates') : t('selectPlugin')}</Button>
          </div> })}
          {tab === 'official' && releasePicker}
        </Space> },
        { key: 'manual', label: t('manualInstall'), disabled: busy, children: <Space orientation="vertical" size="middle" style={{ width: '100%' }}>
          <Upload.Dragger accept=".zip" multiple={false} showUploadList={false} disabled={busy} beforeUpload={file => { inspect.mutate({ file }); return false }}>
            <Typography.Title level={5}>{t('sourceUpload')}</Typography.Title><Typography.Paragraph type="secondary">{t('sourceUploadHint')}</Typography.Paragraph>
          </Upload.Dragger>
          <Collapse items={[{ key: 'github', label: t('advancedSource'), children: <Space orientation="vertical" style={{ width: '100%' }}><Space.Compact style={{ width: '100%' }}><Input value={repository} disabled={busy} onChange={event => setRepository(event.target.value)} placeholder="owner/repository" /><Button disabled={!repository.trim() || busy} onClick={() => { reset(); setManualRepo(repository.trim()) }}>{t('checkReleases')}</Button></Space.Compact>{tab === 'manual' && releasePicker}</Space> }]} />
        </Space> },
      ]} />
      {inspect.isPending && <Spin description={t('inspecting')} />}
      {inspect.error && <Alert type="error" showIcon title={t('previewFailed')} description={t(`errors.${pluginErrorKey(inspect.error)}`)} />}
      {preview && <>
        <Descriptions size="small" bordered column={1} items={[
          { key: 'name', label: t('plugin'), children: <>{pluginText(preview.manifest, 'name', locale)} · {preview.manifest.id} {catalog.data?.some(item => item.id === preview.manifest.id) && <Tag>{t('officialId')}</Tag>}</> },
          { key: 'version', label: t('version'), children: preview.manifest.version },
          { key: 'compatible', label: t('compatibility'), children: t('compatible') },
          { key: 'source', label: t('source'), children: preview.source ?? t('manual') },
          { key: 'hash', label: 'SHA-256', children: <Typography.Text copyable style={{ overflowWrap: 'anywhere' }}>{preview.digest}</Typography.Text> },
          { key: 'tables', label: t('data'), children: preview.manifest.tables.map(table => table.name).join(', ') || '—' },
        ]} />
        <Typography.Text type="secondary">{t('trustWarning')}</Typography.Text>
        <Checkbox checked={trusted} disabled={busy} onChange={event => setTrusted(event.target.checked)}>{t('trustAccept')}</Checkbox>
        <Button type="primary" disabled={!trusted || inspect.isPending} loading={install.isPending} onClick={() => install.mutate()}>{install.isPending ? t('compiling') : t('confirmInstall')}</Button>
      </>}
      {install.error && <Alert type="error" showIcon title={t('installFailed')} description={t(`errors.${pluginErrorKey(install.error)}`)} />}
    </Space>
  </Modal>
}

export function PluginInstaller(props: { installed: PluginListItem[]; initialId?: string; onClose: () => void; onInstalled: () => Promise<void> }) {
  const item = props.installed.find(item => item.id === props.initialId && item.installed)
  return item ? <PluginUpdater item={item} onClose={props.onClose} onInstalled={props.onInstalled} /> : <NewPluginInstaller {...props} />
}
