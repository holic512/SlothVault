'use client'
/**
 * @file plugin-updater.tsx
 * @project SlothVault
 * @module Plugin Update Confirmation
 * @description Updates a fixed installed plugin from its recorded release source or an uploaded package.
 * @logic Bind previews to the selected identity, display version changes, and retain explicit code trust before the existing install transaction.
 * @dependencies plugin APIs, React Query, Ant Design, next-intl
 * @index_tags plugins,updates,trust,preview
 * @author holic512
 */
import { useState } from 'react'
import semver from 'semver'
import { Alert, App, Button, Checkbox, Descriptions, Modal, Space, Typography, Upload } from 'antd'
import { useMutation, useQuery } from '@tanstack/react-query'
import { useLocale, useTranslations } from 'next-intl'
import type { PluginListItem, PluginManifest, PluginUpdateInfo } from '@slothvault/plugin-sdk/protocol'
import { apiFetch } from '@/lib/api-client'
import { pluginErrorKey, pluginText } from '@/lib/plugin-presentation'

type Preview = { manifest: PluginManifest; digest: string; source: string | null }
export function PluginUpdater({ item, onClose, onInstalled }: { item: PluginListItem; onClose: () => void; onInstalled: () => Promise<void> }) {
  const t = useTranslations('AdminMM.plugins'), locale = useLocale(), { message } = App.useApp()
  const [trusted, setTrusted] = useState(false)
  const updates = useQuery({ queryKey: ['plugin-update', item.id, item.version, item.source], queryFn: () => apiFetch<PluginUpdateInfo>(`/api/admin/mm/plugins/${item.id}/updates`), retry: false, staleTime: 60_000 })
  const inspect = useMutation({
    mutationFn: async (file?: File) => {
      const release = updates.data?.release
      const preview = await apiFetch<Preview>('/api/admin/mm/plugins', file
        ? { method: 'POST', headers: { 'Content-Type': 'application/zip' }, body: file }
        : { method: 'POST', body: JSON.stringify({ repository: release!.repository, tag: release!.tag, asset: release!.asset, expectedPluginId: item.id }) })
      if (preview.manifest.id !== item.id) throw new Error('Plugin identity mismatch')
      if (semver.lt(preview.manifest.version, item.version)) throw new Error('Use rollback snapshot to downgrade')
      return preview
    }, onMutate: () => { setTrusted(false); install.reset() },
  })
  const preview = inspect.data
  const install = useMutation({
    mutationFn: () => apiFetch(`/api/admin/mm/plugins/${item.id}`, { method: 'POST', body: JSON.stringify({ action: 'install', digest: preview!.digest, source: preview!.source, trusted }) }),
    onSuccess: async () => { message.success(t('updated')); await onInstalled(); onClose() },
  })
  const busy = inspect.isPending || install.isPending
  return <Modal open width={720} title={t('updatePlugin', { name: pluginText(item.manifest, 'name', locale) })} footer={null} onCancel={busy ? undefined : onClose} closable={!busy} maskClosable={!busy}>
    <Space orientation="vertical" size="middle" style={{ width: '100%' }}>
      <Typography.Text>{t('installedVersion')}: {item.version}</Typography.Text>
      {updates.error ? <Alert type="error" title={t(`errors.${pluginErrorKey(updates.error)}`)} action={<Button onClick={() => void updates.refetch()}>{t('retry')}</Button>} /> : <Typography.Text>{t(`updateStates.${updates.isFetching ? 'checking' : updates.data?.status ?? 'unchecked'}`)}</Typography.Text>}
      {updates.data?.release && !semver.lt(updates.data.release.version, item.version) && <><Typography.Text strong>{item.version} → {updates.data.release.version}</Typography.Text><Typography.Paragraph>{updates.data.release.notes || t('noReleaseNotes')}</Typography.Paragraph><Button loading={inspect.isPending} disabled={busy} onClick={() => inspect.mutate(undefined)}>{t('previewUpdate')}</Button></>}
      <Upload accept=".zip" maxCount={1} showUploadList={false} disabled={busy} beforeUpload={file => { inspect.reset(); inspect.mutate(file); return false }}><Button disabled={busy}>{t('uploadUpdate')}</Button></Upload>
      {inspect.error && <Alert type="error" title={t(`errors.${pluginErrorKey(inspect.error)}`)} />}
      {preview && !inspect.isPending && !inspect.error && <>
        <Descriptions column={1} bordered size="small" items={[
          { key: 'identity', label: t('plugin'), children: preview.manifest.id },
          { key: 'version', label: t('version'), children: `${item.version} → ${preview.manifest.version}` },
          { key: 'compatible', label: t('compatibility'), children: t('compatible') },
          { key: 'source', label: t('source'), children: preview.source ?? t('manual') },
          { key: 'digest', label: 'SHA-256', children: <Typography.Text copyable style={{ overflowWrap: 'anywhere' }}>{preview.digest}</Typography.Text> },
        ]} />
        <Alert type="info" title={preview.manifest.version === item.version ? t('sameVersionRepair') : t('updatePreserves')} />
        <Typography.Text type="secondary">{t('trustWarning')}</Typography.Text>
        <Checkbox disabled={busy} checked={trusted} onChange={event => setTrusted(event.target.checked)}>{t('trustAccept')}</Checkbox>
        <Button type="primary" loading={install.isPending} disabled={!trusted || busy} onClick={() => install.mutate()}>{install.isPending ? t('compiling') : preview.manifest.version === item.version ? t('repair') : t('confirmUpdate')}</Button>
      </>}
      {install.error && <Alert type="error" title={t(`errors.${pluginErrorKey(install.error)}`)} />}
    </Space>
  </Modal>
}
