'use client'

/**
 * @file complete-backup-manager.tsx
 * @project SlothVault
 * @module Complete Backup Administration
 * @description Manages local complete snapshots, daily schedules, durable progress, and protected restore previews.
 * @logic Poll server history, edit opt-in schedules, upload bounded bundles, inspect restore scope, and require typed confirmation before submitting a durable restore task.
 * @dependencies Ant Design, TanStack Query, next-intl, backup API contracts
 * @index_tags admin,backup,restore,scheduler,history,preflight
 * @author holic512
 */
import { useEffect, useState } from 'react'
import { useQuery, useQueryClient } from '@tanstack/react-query'
import { Alert, App, Button, Card, Descriptions, Form, Input, InputNumber, Modal, Space, Switch, Table, Tag, Typography, Upload } from 'antd'
import { Archive, CalendarClock, Download, RefreshCw, Trash2, UploadCloud } from 'lucide-react'
import { useLocale, useTranslations } from 'next-intl'
import { ApiClientError, apiFetch } from '@/lib/api-client'
import { formatAdminError } from '@/lib/admin-localization'
import type { BackupHistoryResponse, BackupJob, BackupSettings, BackupSettingsResponse, BackupSnapshotSummary, BackupSource, RestorePreview } from '@/types/backup'

const prefix = '/api/admin/mm/backup'
const historyKey = ['admin', 'complete-backups']
const settingsKey = ['admin', 'backup-settings']
const emptyHistory: BackupHistoryResponse = { snapshots: [], jobs: [], activeJob: null }
const statusColors = { queued: 'default', running: 'processing', succeeded: 'success', failed: 'error', interrupted: 'warning' } as const
function bytes(size: number | string) { return `${(Number(size) / 1024 / 1024).toFixed(1)} MiB` }

export function CompleteBackupManager({ externalBusy, onBusyChange }: { externalBusy: boolean; onBusyChange: (busy: boolean) => void }) {
  const t = useTranslations('AdminMM.backup.complete')
  const errorT = useTranslations('AdminMM.errors')
  const locale = useLocale()
  const { message, modal } = App.useApp()
  const client = useQueryClient()
  const [pending, setPending] = useState<string | null>(null)
  const [preview, setPreview] = useState<RestorePreview | null>(null)
  const [phrase, setPhrase] = useState('')
  const historyQuery = useQuery({
    queryKey: historyKey,
    queryFn: () => apiFetch<BackupHistoryResponse>(`${prefix}/snapshots`),
    refetchInterval: (query) => (query.state.data?.activeJob ? 2000 : 10000),
    retry: false,
  })
  const settingsQuery = useQuery({
    queryKey: settingsKey,
    queryFn: () => apiFetch<BackupSettingsResponse>(`${prefix}/settings`),
    refetchInterval: 60000,
    retry: false,
  })
  const history = historyQuery.data ?? emptyHistory
  const active = history.activeJob
  const busy = Boolean(active || pending)
  const disabled = externalBusy || busy || !historyQuery.data || historyQuery.isError
  const date = (value: string) => new Date(value).toLocaleString(locale)
  const codeText = (value: string) => t.has(`codes.${value}`) ? t(`codes.${value}`) : t('codes.BACKUP_FAILED')
  const showError = (error: unknown) => {
    const reason = error instanceof ApiClientError ? (error.data as { reason?: string } | null)?.reason : undefined
    message.error(reason && t.has(`codes.${reason}`) ? codeText(reason) : formatAdminError(error, errorT))
  }
  const refresh = async () => { await Promise.all([client.invalidateQueries({ queryKey: historyKey }), client.invalidateQueries({ queryKey: settingsKey })]) }
  useEffect(() => { onBusyChange(busy) }, [busy, onBusyChange])

  const queueBackup = async (retryJobId?: string) => {
    setPending('backup')
    try {
      const job = await apiFetch<BackupJob>(`${prefix}/snapshots`, { method: 'POST', body: JSON.stringify(retryJobId ? { retryJobId } : {}) })
      client.setQueryData<BackupHistoryResponse>(historyKey, (previous = emptyHistory) => ({ ...previous, activeJob: job, jobs: [job, ...previous.jobs] }))
      message.success(t('queued'))
      await refresh()
    } catch (error) { showError(error) }
    finally { setPending(null) }
  }
  const openPreview = async (source: BackupSource) => {
    const result = await apiFetch<RestorePreview>(`${prefix}/restores/preview`, { method: 'POST', body: JSON.stringify(source) })
    setPhrase('')
    setPreview(result)
  }
  const previewSnapshot = async (snapshotId: string) => {
    setPending('preview')
    try { await openPreview({ snapshotId }) } catch (error) { showError(error) }
    finally { setPending(null) }
  }
  const upload = async (file: File) => {
    if (file.size > 320 * 1024 * 1024) { message.error(t('codes.BACKUP_TOO_LARGE')); return }
    setPending('upload')
    try {
      const source = await apiFetch<{ importId: string }>(`${prefix}/imports`, { method: 'POST', body: file, headers: { 'Content-Type': 'application/zip' } })
      await openPreview(source)
    } catch (error) { showError(error) }
    finally { setPending(null) }
  }
  const restore = async () => {
    if (!preview || phrase !== 'RESTORE_BACKUP') return
    setPending('restore')
    try {
      const job = await apiFetch<BackupJob>(`${prefix}/restores`, { method: 'POST', body: JSON.stringify({ previewId: preview.id, confirm: phrase }) })
      client.setQueryData<BackupHistoryResponse>(historyKey, (previous = emptyHistory) => ({ ...previous, activeJob: job, jobs: [job, ...previous.jobs] }))
      setPreview(null)
      message.success(t('restoreQueued'))
      await refresh()
    } catch (error) { showError(error) }
    finally { setPending(null) }
  }
  const remove = (snapshot: BackupSnapshotSummary) => {
    modal.confirm({
      title: t('deleteTitle'), content: t('deleteDescription', { time: date(snapshot.createdAt) }), okButtonProps: { danger: true },
      onOk: async () => {
        setPending('delete')
        try { await apiFetch(`${prefix}/snapshots/${snapshot.id}`, { method: 'DELETE', body: JSON.stringify({ confirm: 'DELETE_BACKUP' }) }); await refresh() }
        catch (error) { showError(error); throw error }
        finally { setPending(null) }
      },
    })
  }
  const latest = active ?? history.jobs[0]
  return (
    <Space orientation="vertical" size={12} className="full-width">
      <Card className="backup-card-next" loading={historyQuery.isLoading}>
        <div className="backup-card-heading">
          <span><Archive size={20} /></span>
          <div><Typography.Title level={4}>{t('title')}</Typography.Title><Typography.Text type="secondary">{t('description')}</Typography.Text></div>
        </div>
        <Space wrap className="backup-complete-actions">
          <Button type="primary" disabled={disabled} loading={pending === 'backup'} icon={<Archive size={15} />} onClick={() => void queueBackup()}>{t('create')}</Button>
          <Upload accept=".zip,application/zip" disabled={disabled} showUploadList={false} beforeUpload={(file) => { void upload(file); return Upload.LIST_IGNORE }}>
            <Button disabled={disabled} loading={pending === 'upload' || pending === 'preview'} icon={<UploadCloud size={15} />}>{t('upload')}</Button>
          </Upload>
          <Button icon={<RefreshCw size={14} />} onClick={() => void refresh()}>{t('refresh')}</Button>
        </Space>
        {historyQuery.isError && <Alert type="error" showIcon title={t('statusUnavailable')} description={t('statusUnavailableHint')} />}
        {latest && <Alert
          type={latest.status === 'failed' ? 'error' : latest.status === 'succeeded' ? (latest.warnings.length ? 'warning' : 'success') : 'info'}
          showIcon
          title={`${t(`kinds.${latest.kind}`)} · ${t(`statuses.${latest.status}`)} · ${t(`phases.${latest.phase}`)}`}
          description={<Space orientation="vertical" size={4}>
            {active && <span>{t('durableHint')}</span>}
            {latest.error && <span>{codeText(latest.error)}</span>}
            {latest.warnings.map((warning, index) => <span key={`${warning}-${index}`}>{codeText(warning)}</span>)}
          </Space>}
        />}
      </Card>
      <Card className="backup-card-next" loading={settingsQuery.isLoading}>
        <div className="backup-card-heading">
          <span><CalendarClock size={20} /></span>
          <div><Typography.Title level={4}>{t('schedule.title')}</Typography.Title><Typography.Text type="secondary">{t('schedule.description')}</Typography.Text></div>
        </div>
        {settingsQuery.isError && <Alert type="error" showIcon title={t('schedule.unavailable')} />}
        {settingsQuery.data && <>
          <Descriptions size="small" column={1} className="backup-complete-actions">
            <Descriptions.Item label={t('schedule.location')}><Typography.Text code className="backup-storage-path">{settingsQuery.data.storage.path}</Typography.Text></Descriptions.Item>
            <Descriptions.Item label={t('schedule.storage')}>{settingsQuery.data.storage.error ? codeText(settingsQuery.data.storage.error) : t('schedule.available', { space: bytes(settingsQuery.data.storage.availableBytes ?? '0') })}</Descriptions.Item>
            <Descriptions.Item label={t('schedule.next')}>{settingsQuery.data.nextRunAt ? date(settingsQuery.data.nextRunAt) : t('schedule.disabled')}</Descriptions.Item>
          </Descriptions>
          <BackupScheduleForm settings={settingsQuery.data.settings} disabled={disabled} onSaved={refresh} />
        </>}
      </Card>
      <Card title={t('history.title')} className="backup-card-next">
        <Table<BackupSnapshotSummary>
          size="small" rowKey="id" dataSource={history.snapshots} pagination={{ pageSize: 7, showSizeChanger: false }} scroll={{ x: 780 }}
          locale={{ emptyText: t('history.empty') }}
          columns={[
            { title: t('history.time'), dataIndex: 'createdAt', render: date },
            { title: t('history.kind'), dataIndex: 'kind', render: (kind: BackupSnapshotSummary['kind']) => <Tag>{t(`kinds.${kind}`)}</Tag> },
            { title: t('history.scope'), render: (_, item) => t('history.counts', { records: Object.values(item.manifest.counts).reduce((a, b) => a + b, 0), files: item.manifest.fileCount }) },
            { title: t('history.size'), dataIndex: 'size', render: bytes },
            { title: t('history.actions'), render: (_, item) => <Space size={4}>
              <Button size="small" href={`${prefix}/snapshots/${item.id}/download`} icon={<Download size={13} />}>{t('download')}</Button>
              <Button size="small" disabled={disabled} onClick={() => void previewSnapshot(item.id)}>{t('preview')}</Button>
              <Button size="small" danger disabled={disabled} icon={<Trash2 size={13} />} aria-label={t('deleteTitle')} onClick={() => remove(item)} />
            </Space> },
          ]}
        />
        <Typography.Paragraph type="secondary">{t('history.retentionHint')}</Typography.Paragraph>
      </Card>
      <Card title={t('jobs.title')} className="backup-card-next">
        <Table<BackupJob>
          size="small" rowKey="id" dataSource={history.jobs} pagination={{ pageSize: 5, showSizeChanger: false }} scroll={{ x: 760 }}
          locale={{ emptyText: t('jobs.empty') }}
          columns={[
            { title: t('history.time'), dataIndex: 'createdAt', render: date },
            { title: t('history.kind'), dataIndex: 'kind', render: (kind: BackupJob['kind']) => t(`kinds.${kind}`) },
            { title: t('jobs.status'), render: (_, job) => <Space orientation="vertical" size={2}><Tag color={statusColors[job.status]}>{t(`statuses.${job.status}`)}</Tag><span>{t(`phases.${job.phase}`)}</span></Space> },
            { title: t('jobs.duration'), render: (_, job) => job.durationMs === undefined ? '—' : t('jobs.seconds', { seconds: (job.durationMs / 1000).toFixed(1) }) },
            { title: t('jobs.result'), render: (_, job) => <Space orientation="vertical" size={2}>
              {job.error && <Typography.Text type="danger">{codeText(job.error)}</Typography.Text>}
              {job.warnings.map((warning, index) => <Typography.Text type="warning" key={`${warning}-${index}`}>{codeText(warning)}</Typography.Text>)}
              {job.protectionId && <Button size="small" href={`${prefix}/snapshots/${job.protectionId}/download`}>{t('jobs.protection')}</Button>}
              {['failed', 'interrupted'].includes(job.status) && ['manual', 'scheduled'].includes(job.kind) && <Button size="small" disabled={disabled} onClick={() => void queueBackup(job.id)}>{t('retry')}</Button>}
            </Space> },
          ]}
        />
      </Card>
      <Modal open={Boolean(preview)} title={t('restore.title')} width={720} okText={t('restore.confirm')} cancelText={t('restore.cancel')}
        confirmLoading={pending === 'restore'} okButtonProps={{ danger: true, disabled: phrase !== 'RESTORE_BACKUP' || disabled }}
        onCancel={() => { if (pending !== 'restore') setPreview(null) }} onOk={() => void restore()}>
        {preview && <Space orientation="vertical" size={12} className="full-width">
          <Alert type="warning" showIcon title={t('restore.warning')} description={t('restore.protection')} />
          <Descriptions bordered size="small" column={1}>
            <Descriptions.Item label={t('history.time')}>{date(preview.manifest.createdAt)}</Descriptions.Item>
            <Descriptions.Item label={t('restore.versions')}>{preview.manifest.appVersion} / {preview.manifest.databaseVersion}</Descriptions.Item>
            <Descriptions.Item label={t('history.scope')}>{t('history.counts', { records: Object.values(preview.manifest.counts).reduce((a, b) => a + b, 0), files: preview.manifest.files.length })}</Descriptions.Item>
            <Descriptions.Item label={t('restore.scopeLabel')}>{t('restore.scope')}</Descriptions.Item>
            <Descriptions.Item label={t('restore.administratorLabel')}>{t('restore.administrator', { name: preview.preservedAdministrator })}</Descriptions.Item>
            <Descriptions.Item label={t('restore.deploymentLabel')}>{t('restore.deployment')}</Descriptions.Item>
            <Descriptions.Item label={t('restore.expires')}>{date(preview.expiresAt)}</Descriptions.Item>
          </Descriptions>
          {preview.warnings.map((warning) => <Alert key={warning} type="warning" showIcon title={codeText(warning)} />)}
          <Typography.Text>{t('restore.phrase')}</Typography.Text>
          <Input value={phrase} placeholder="RESTORE_BACKUP" aria-label={t('restore.phrase')} autoComplete="off" onChange={(event) => setPhrase(event.target.value)} />
        </Space>}
      </Modal>
    </Space>
  )
}

function BackupScheduleForm({ settings, disabled, onSaved }: { settings: BackupSettings; disabled: boolean; onSaved: () => Promise<void> }) {
  const t = useTranslations('AdminMM.backup.complete.schedule')
  const errorT = useTranslations('AdminMM.errors')
  const { message } = App.useApp()
  const [saving, setSaving] = useState(false)
  const save = async (values: BackupSettings) => {
    setSaving(true)
    try { await apiFetch(`${prefix}/settings`, { method: 'PUT', body: JSON.stringify(values) }); message.success(t('saved')); await onSaved() }
    catch (error) { message.error(formatAdminError(error, errorT)) }
    finally { setSaving(false) }
  }
  return <Form layout="vertical" initialValues={settings} disabled={disabled || saving} onFinish={(values: BackupSettings) => void save(values)}>
    <div className="backup-schedule-fields">
      <Form.Item name="enabled" label={t('enabled')} valuePropName="checked"><Switch /></Form.Item>
      <Form.Item name="dailyTime" label={t('time')} rules={[{ required: true }, { pattern: /^(?:[01]\d|2[0-3]):[0-5]\d$/, message: t('invalidTime') }]}><Input type="time" /></Form.Item>
      <Form.Item name="timeZone" label={t('timezone')} rules={[{ required: true }]}><Input placeholder="Asia/Shanghai" /></Form.Item>
      <Form.Item name="retentionCount" label={t('retention')} rules={[{ required: true }]}><InputNumber min={1} max={365} precision={0} /></Form.Item>
    </div>
    <Button htmlType="submit" type="primary" loading={saving} disabled={disabled}>{t('save')}</Button>
  </Form>
}
