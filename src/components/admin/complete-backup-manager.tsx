'use client'

/**
 * @file complete-backup-manager.tsx
 * @project SlothVault
 * @module Complete Backup Administration
 * @description Organizes persistent generated and imported backups, schedules, job history, and reset panels.
 * @logic Track resumable imports separately from restore previews, show version compatibility, and require fresh preflight and confirmation before restore.
 * @dependencies Ant Design, TanStack Query, next-intl, backup API contracts
 * @index_tags admin,backup,restore,scheduler,history,preflight
 * @author holic512
 */
import { useEffect, useMemo, useRef, useState, type ReactNode } from 'react'
import { useQuery, useQueryClient } from '@tanstack/react-query'
import { Alert, App, Button, Card, Descriptions, Form, Input, InputNumber, Modal, Progress, Select, Space, Switch, Table, Tabs, Tag, Typography, Upload } from 'antd'
import { Archive, CalendarClock, Download, Pause, Play, RefreshCw, X, Trash2, UploadCloud } from 'lucide-react'
import { useLocale, useTranslations } from 'next-intl'
import { ApiClientError, apiFetch } from '@/lib/api-client'
import { importBackupUpload, rememberedBackupUpload, rememberBackupUpload, uploadBackupFile } from '@/lib/backup-upload'
import { formatAdminError } from '@/lib/admin-localization'
import type { BackupHistoryResponse, BackupJob, BackupSettings, BackupSettingsResponse, BackupSnapshotSummary, BackupSource, BackupUpload, RestorePreview } from '@/types/backup'

const prefix = '/api/admin/mm/backup'
const historyKey = ['admin', 'complete-backups']
const settingsKey = ['admin', 'backup-settings']
const emptyHistory: BackupHistoryResponse = { snapshots: [], jobs: [], activeJob: null }
const statusColors = { queued: 'default', running: 'processing', succeeded: 'success', failed: 'error', interrupted: 'warning' } as const
function bytes(size: number | string) { return `${(Number(size) / 1024 / 1024).toFixed(1)} MiB` }

export function CompleteBackupManager({ externalBusy, onBusyChange, dangerPanel }: {
  externalBusy: boolean
  onBusyChange: (busy: boolean) => void
  dangerPanel: ReactNode
}) {
  const t = useTranslations('AdminMM.backup.complete')
  const tabsT = useTranslations('AdminMM.backup.tabs')
  const errorT = useTranslations('AdminMM.errors')
  const locale = useLocale()
  const { message, modal } = App.useApp()
  const client = useQueryClient()
  const [pending, setPending] = useState<string | null>(null)
  const [preview, setPreview] = useState<RestorePreview | null>(null)
  const [phrase, setPhrase] = useState('')
  const [uploadSession, setUploadSession] = useState<BackupUpload | null>(null)
  const [uploading, setUploading] = useState(false)
  const [previewJobId, setPreviewJobId] = useState<string | null>(null)
  const [importJobId, setImportJobId] = useState<string | null>(null)
  const uploadController = useRef<AbortController | null>(null)
  const [selectedFile, setSelectedFile] = useState<File | null>(null)
  useEffect(() => {
    let mounted = true
    const saved = rememberedBackupUpload()
    queueMicrotask(() => { if (mounted) { setUploadSession(saved); setImportJobId(saved?.importJobId ?? null) } })
    if (saved && !saved.importJobId) void apiFetch<BackupUpload>(`${prefix}/imports/${saved.importId}`).then((session) => {
      if (mounted) { rememberBackupUpload(session); setUploadSession(session); setImportJobId(session.importJobId ?? null) }
    }).catch((error: unknown) => {
      if (mounted && error instanceof ApiClientError && error.status === 404) { rememberBackupUpload(null); setUploadSession(null) }
    })
    return () => { mounted = false; uploadController.current?.abort() }
  }, [])
  const previewQuery = useQuery({
    queryKey: ['admin', 'backup-preview', previewJobId],
    queryFn: () => apiFetch<BackupJob>(`${prefix}/jobs/${previewJobId}`),
    enabled: Boolean(previewJobId), retry: false,
    refetchInterval: (query) => ['queued', 'running'].includes(query.state.data?.status ?? 'queued') ? 2000 : false,
  })
  const importQuery = useQuery({
    queryKey: ['admin', 'backup-import', importJobId],
    queryFn: () => apiFetch<BackupJob>(`${prefix}/jobs/${importJobId}`),
    enabled: Boolean(importJobId), retry: false,
    refetchInterval: (query) => ['queued', 'running'].includes(query.state.data?.status ?? 'queued') ? 2000 : false,
  })
  const [snapshotKind, setSnapshotKind] = useState('all')
  const [jobStatus, setJobStatus] = useState('all')
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
  const busy = Boolean(active || pending || uploading || uploadSession || previewJobId || importJobId)
  const disabled = externalBusy || busy || !historyQuery.data || historyQuery.isError
  const uploadDisabled = externalBusy || Boolean(active || pending || uploading || previewJobId || importJobId) || historyQuery.isError
  const date = (value: string) => new Date(value).toLocaleString(locale)
  const codeText = (value: string) => t.has(`codes.${value}`) ? t(`codes.${value}`) : t('codes.BACKUP_FAILED')
  const showError = (error: unknown) => {
    const reason = error instanceof ApiClientError ? (error.data as { reason?: string } | null)?.reason : undefined
    message.error(reason && t.has(`codes.${reason}`) ? codeText(reason) : formatAdminError(error, errorT))
  }
  const refresh = async () => { await Promise.all([client.invalidateQueries({ queryKey: historyKey }), client.invalidateQueries({ queryKey: settingsKey })]) }
  useEffect(() => { onBusyChange(busy) }, [busy, onBusyChange])
  useEffect(() => {
    const job = importQuery.data
    if (!job || ['queued', 'running'].includes(job.status)) return
    queueMicrotask(() => {
      setImportJobId(null)
      if (job.status === 'succeeded') {
        rememberBackupUpload(null); setUploadSession(null); setSelectedFile(null)
        message.success(t('importSucceeded'))
      } else {
        const saved = rememberedBackupUpload()
        if (saved) { const session = { ...saved, importJobId: undefined }; rememberBackupUpload(session); setUploadSession(session) }
        message.error(t.has(`codes.${job.error}`) ? t(`codes.${job.error}`) : t('codes.BACKUP_FAILED'))
      }
      void client.invalidateQueries({ queryKey: historyKey })
    })
  }, [importQuery.data, client, message, t])

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
  useEffect(() => {
    const job = previewQuery.data
    if (!job || ['queued', 'running'].includes(job.status)) return
    queueMicrotask(() => {
      setPreviewJobId(null)
      if (job.preview && job.status === 'succeeded') { setPhrase(''); setPreview(job.preview) }
      else { const reason = job.error ?? 'BACKUP_FAILED'; message.error(t.has(`codes.${reason}`) ? t(`codes.${reason}`) : t('codes.BACKUP_FAILED')) }
    })
  }, [previewQuery.data, message, t]) // The completed job is consumed once.
  useEffect(() => {
    if (previewQuery.isError) queueMicrotask(() => { setPreviewJobId(null); message.error(t('statusUnavailable')) })
  }, [previewQuery.isError, message, t])
  const openPreview = async (source: BackupSource) => {
    const job = await apiFetch<BackupJob>(`${prefix}/restores/preview`, { method: 'POST', body: JSON.stringify(source) })
    setPreviewJobId(job.id)
    client.setQueryData<BackupHistoryResponse>(historyKey, (previous = emptyHistory) => ({ ...previous, activeJob: job, jobs: [job, ...previous.jobs] }))
    await refresh()
  }
  const previewSnapshot = async (snapshotId: string) => {
    setPending('preview')
    try { await openPreview({ snapshotId }) } catch (error) { showError(error) }
    finally { setPending(null) }
  }
  const startImport = async (importId: string, signal?: AbortSignal) => {
    const job = await importBackupUpload(importId, signal)
    setUploadSession(rememberedBackupUpload())
    setImportJobId(job.id)
    client.setQueryData<BackupHistoryResponse>(historyKey, (previous = emptyHistory) => ({ ...previous, activeJob: ['queued', 'running'].includes(job.status) ? job : previous.activeJob, jobs: [job, ...previous.jobs.filter(item => item.id !== job.id)] }))
    await refresh()
  }
  const retryImport = async () => {
    if (!uploadSession) return
    setPending('import')
    try { await startImport(uploadSession.importId) } catch (error) {
      showError(error)
      if (error instanceof ApiClientError && error.status === 404) { rememberBackupUpload(null); setUploadSession(null); setSelectedFile(null) }
    }
    finally { setPending(null) }
  }
  const upload = async (file: File) => {
    setSelectedFile(file)
    const controller = new AbortController(); uploadController.current = controller
    setUploading(true)
    try {
      const source = await uploadBackupFile(file, uploadSession, controller.signal, setUploadSession)
      await startImport(source.importId, controller.signal)
    } catch (error) {
      if (!controller.signal.aborted) {
        if (error instanceof Error && error.message === 'BACKUP_UPLOAD_FILE_MISMATCH') message.error(t('codes.BACKUP_UPLOAD_FILE_MISMATCH'))
        else showError(error)
        if (error instanceof ApiClientError && error.status === 404) { rememberBackupUpload(null); setUploadSession(null) }
      }
    } finally { setUploading(false); uploadController.current = null }
  }
  const cancelUpload = async () => {
    uploadController.current?.abort()
    if (!uploadSession) return
    setPending('cancel')
    try {
      await apiFetch(`${prefix}/imports/${uploadSession.importId}`, { method: 'DELETE' })
      rememberBackupUpload(null); setUploadSession(null); setSelectedFile(null)
    } catch (error) {
      if (error instanceof ApiClientError && error.status === 404) { rememberBackupUpload(null); setUploadSession(null); setSelectedFile(null) }
      else showError(error)
    }
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
  const snapshotsPanel = (
    <div className="backup-panel-stack">
      <Card className="backup-card-next" loading={historyQuery.isLoading}>
        <div className="backup-card-heading">
          <span><Archive size={20} /></span>
          <div><Typography.Title level={4}>{t('title')}</Typography.Title><Typography.Text type="secondary">{t('description')}</Typography.Text></div>
        </div>
        <Space wrap className="backup-complete-actions">
          <Button type="primary" disabled={disabled} loading={pending === 'backup'} icon={<Archive size={15} />} onClick={() => void queueBackup()}>{t('create')}</Button>
          <Upload accept=".zip,application/zip" disabled={uploadDisabled} showUploadList={false} beforeUpload={(file) => { void upload(file); return Upload.LIST_IGNORE }}>
            <Button disabled={uploadDisabled} loading={uploading || pending === 'preview'} icon={<UploadCloud size={15} />}>{t(uploadSession ? 'reselect' : 'upload')}</Button>
          </Upload>
        </Space>
        <Typography.Text type="secondary">{t('uploadHint')}</Typography.Text>
        {uploadSession && <Space orientation="vertical" className="full-width">
          <Typography.Text>{uploadSession.fileName} · {bytes(uploadSession.offset)} / {bytes(uploadSession.size)}</Typography.Text>
          <Progress percent={Number((100 * uploadSession.offset / uploadSession.size).toFixed(1))} status={uploading ? 'active' : 'normal'} />
          <Typography.Text type="secondary">{t(importJobId ? 'importValidating' : uploading ? 'uploading' : uploadSession.state === 'uploaded' ? 'awaitingImport' : 'paused')}</Typography.Text>
          <Space>
            {uploading ? <Button icon={<Pause size={14} />} onClick={() => uploadController.current?.abort()}>{t('pause')}</Button>
              : uploadSession.state === 'uploaded' ? <Button icon={<Play size={14} />} disabled={uploadDisabled} loading={pending === 'import'} onClick={() => void retryImport()}>{t('retryImport')}</Button>
                : <Button icon={<Play size={14} />} disabled={!selectedFile || uploadDisabled} onClick={() => { if (selectedFile) void upload(selectedFile) }}>{t('resume')}</Button>}
            {importQuery.isError && <Button icon={<RefreshCw size={14} />} onClick={() => void importQuery.refetch()}>{t('refresh')}</Button>}
            <Button danger icon={<X size={14} />} disabled={Boolean(pending || previewJobId || importJobId)} onClick={() => void cancelUpload()}>{t('cancelUpload')}</Button>
          </Space>
          {importQuery.isError && <Alert type="error" showIcon title={t('statusUnavailable')} description={t('statusUnavailableHint')} />}
        </Space>}
      </Card>
      <Card title={t('history.title')} className="backup-card-next">
        <Form layout="inline" className="backup-table-filter">
          <Form.Item label={t('history.kind')} htmlFor="backup-kind-filter">
            <Select id="backup-kind-filter" value={snapshotKind} onChange={setSnapshotKind} options={[
              { value: 'all', label: t('filters.allKinds') },
              ...['manual', 'scheduled', 'protect', 'imported'].map((value) => ({ value, label: t(`kinds.${value}`) })),
            ]} />
          </Form.Item>
        </Form>
        <Table<BackupSnapshotSummary>
          size="small" rowKey="id" dataSource={history.snapshots.filter((snapshot) => snapshotKind === 'all' || snapshot.kind === snapshotKind)} pagination={{ pageSize: 7, showSizeChanger: false }} scroll={{ x: 780 }}
          locale={{ emptyText: t(snapshotKind === 'all' ? 'history.empty' : 'filters.empty') }}
          columns={[
            { title: t('history.time'), render: (_, item) => <Space orientation="vertical" size={2}><span>{date(item.createdAt)}</span>{item.importedAt && <Typography.Text type="secondary">{t('history.importedAt', { time: date(item.importedAt) })}</Typography.Text>}{item.fileName && <Typography.Text type="secondary">{item.fileName}</Typography.Text>}</Space> },
            { title: t('history.kind'), dataIndex: 'kind', render: (kind: BackupSnapshotSummary['kind']) => <Tag>{t(`kinds.${kind}`)}</Tag> },
            { title: t('history.compatibility'), render: (_, item) => <Space orientation="vertical" size={2}>
              <Tag color={item.restorable ? 'success' : 'warning'}>{t(`compatibility.${item.compatibility.status}`)}</Tag>
              <Typography.Text type="secondary">{t('compatibility.versions', { source: item.compatibility.sourceVersion || '—', target: item.compatibility.targetVersion })}</Typography.Text>
              {item.compatibility.reason && <Typography.Text type="warning">{t(item.compatibility.reason === 'format' ? 'compatibility.formatUnsupported' : 'compatibility.versionUnsupported')}</Typography.Text>}
            </Space> },
            { title: t('history.scope'), render: (_, item) => t('history.counts', { records: Object.values(item.manifest.counts).reduce((a, b) => a + b, 0), files: item.manifest.fileCount }) },
            { title: t('history.size'), dataIndex: 'size', render: bytes },
            { title: t('history.actions'), render: (_, item) => <Space size={4}>
              <Button size="small" href={`${prefix}/snapshots/${item.id}/download`} icon={<Download size={13} />}>{t('download')}</Button>
              <Button size="small" disabled={disabled || !item.restorable} onClick={() => void previewSnapshot(item.id)}>{t(item.restorable ? 'preview' : 'unsupported')}</Button>
              <Button size="small" danger disabled={disabled} icon={<Trash2 size={13} />} aria-label={t('deleteTitle')} onClick={() => remove(item)} />
            </Space> },
          ]}
        />
      </Card>
    </div>
  )
  const schedulePanel = (
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
        <Typography.Paragraph type="secondary">{t('history.retentionHint')}</Typography.Paragraph>
        <BackupScheduleForm settings={settingsQuery.data.settings} disabled={disabled} onSaved={refresh} />
      </>}
    </Card>
  )
  const jobsPanel = (
    <Card title={t('jobs.title')} className="backup-card-next">
      <Form layout="inline" className="backup-table-filter">
        <Form.Item label={t('jobs.statusFilter')} htmlFor="backup-status-filter">
          <Select id="backup-status-filter" value={jobStatus} onChange={setJobStatus} options={[
            { value: 'all', label: t('filters.allStatuses') },
            ...Object.keys(statusColors).map((value) => ({ value, label: t(`statuses.${value}`) })),
          ]} />
        </Form.Item>
      </Form>
      <Table<BackupJob>
        size="small" rowKey="id" dataSource={history.jobs.filter((job) => jobStatus === 'all' || job.status === jobStatus)} pagination={{ pageSize: 5, showSizeChanger: false }} scroll={{ x: 760 }}
        locale={{ emptyText: t(jobStatus === 'all' ? 'jobs.empty' : 'filters.empty') }}
        columns={[
          { title: t('history.time'), dataIndex: 'createdAt', render: date },
          { title: t('history.kind'), dataIndex: 'kind', render: (kind: BackupJob['kind']) => t(`kinds.${kind}`) },
          { title: t('jobs.status'), render: (_, job) => <Space orientation="vertical" size={2}><Tag color={statusColors[job.status]}>{t(`statuses.${job.status}`)}</Tag><span>{t(`phases.${job.phase}`)}</span>{job.progress && <span>{t('progress', { files: job.progress.processedFiles, records: job.progress.processedRecords, bytes: bytes(job.progress.processedBytes) })}</span>}</Space> },
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
  )

  return (
    <div className="backup-workspace">
      {historyQuery.isError && <Alert type="error" showIcon title={t('statusUnavailable')} description={t('statusUnavailableHint')} />}
      {latest && (active || latest.status !== 'succeeded' || latest.warnings.length > 0) && <Alert
        type={latest.status === 'failed' ? 'error' : latest.status === 'succeeded' ? (latest.warnings.length ? 'warning' : 'success') : 'info'}
        showIcon
        title={`${t(`kinds.${latest.kind}`)} · ${t(`statuses.${latest.status}`)} · ${t(`phases.${latest.phase}`)}`}
        description={<Space orientation="vertical" size={4}>
          {active && <span>{t('durableHint')}</span>}
          {latest.progress && <span>{t('progress', { files: latest.progress.processedFiles, records: latest.progress.processedRecords, bytes: bytes(latest.progress.processedBytes) })}</span>}
          {latest.error && <span>{codeText(latest.error)}</span>}
          {latest.warnings.map((warning, index) => <span key={`${warning}-${index}`}>{codeText(warning)}</span>)}
        </Space>}
      />}
      <Tabs
        defaultActiveKey="snapshots"
        className="backup-tabs"
        tabBarExtraContent={<Button type="text" icon={<RefreshCw size={14} />} loading={historyQuery.isFetching || settingsQuery.isFetching} onClick={() => void refresh()} aria-label={t('refresh')} title={t('refresh')} />}
        items={[
          { key: 'snapshots', label: tabsT('snapshots'), children: snapshotsPanel },
          { key: 'schedule', label: tabsT('schedule'), children: schedulePanel },
          { key: 'jobs', label: tabsT('jobs'), children: jobsPanel },
          { key: 'danger', label: tabsT('danger'), children: dangerPanel },
        ]}
      />
      <Modal open={Boolean(preview)} title={t('restore.title')} width={720} okText={t('restore.confirm')} cancelText={t('restore.cancel')}
        confirmLoading={pending === 'restore'} okButtonProps={{ danger: true, disabled: phrase !== 'RESTORE_BACKUP' || disabled }}
        onCancel={() => { if (pending !== 'restore') setPreview(null) }} onOk={() => void restore()}>
        {preview && <Space orientation="vertical" size={12} className="full-width">
          <Alert type="warning" showIcon title={t('restore.warning')} description={t('restore.protection')} />
          <Descriptions bordered size="small" column={1}>
            <Descriptions.Item label={t('history.time')}>{date(preview.manifest.createdAt)}</Descriptions.Item>
            <Descriptions.Item label={t('restore.versions')}>{preview.manifest.appVersion} / {preview.manifest.databaseVersion}</Descriptions.Item>
            <Descriptions.Item label={t('history.scope')}>{t('history.counts', { records: Object.values(preview.manifest.counts).reduce((a, b) => a + b, 0), files: preview.manifest.fileCount })}</Descriptions.Item>
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
    </div>
  )
}

function BackupScheduleForm({ settings, disabled, onSaved }: { settings: BackupSettings; disabled: boolean; onSaved: () => Promise<void> }) {
  const t = useTranslations('AdminMM.backup.complete.schedule')
  const errorT = useTranslations('AdminMM.errors')
  const { message } = App.useApp()
  const [saving, setSaving] = useState(false)
  const timeZones = useMemo(() => [...new Set(['UTC', settings.timeZone, ...Intl.supportedValuesOf('timeZone')])].map((value) => ({ value, label: value.replaceAll('_', ' ') })), [settings.timeZone])
  const save = async (values: BackupSettings) => {
    setSaving(true)
    try { await apiFetch(`${prefix}/settings`, { method: 'PUT', body: JSON.stringify(values) }); message.success(t('saved')); await onSaved() }
    catch (error) { message.error(formatAdminError(error, errorT)) }
    finally { setSaving(false) }
  }
  return <Form layout="vertical" className="backup-schedule-form" initialValues={settings} disabled={disabled || saving} onFinish={(values: BackupSettings) => void save(values)}>
    <div className="backup-schedule-fields">
      <Form.Item name="enabled" label={t('enabled')} valuePropName="checked"><Switch /></Form.Item>
      <Form.Item name="dailyTime" label={t('time')} rules={[{ required: true }, { pattern: /^(?:[01]\d|2[0-3]):[0-5]\d$/, message: t('invalidTime') }]}><Input type="time" /></Form.Item>
      <Form.Item name="timeZone" label={t('timezone')} rules={[{ required: true }]}><Select showSearch={{ optionFilterProp: 'label' }} options={timeZones} /></Form.Item>
      <Form.Item name="retentionCount" label={t('retention')} rules={[{ required: true }]}><InputNumber min={1} max={365} precision={0} /></Form.Item>
    </div>
    <Button htmlType="submit" type="primary" loading={saving} disabled={disabled}>{t('save')}</Button>
  </Form>
}
