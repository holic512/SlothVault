'use client'

/**
 * @file backup-manager.tsx
 * @project SlothVault
 * @module Backup Administration
 * @description Provides explicit export, transactional import, file restore, and typed reset confirmation flows.
 * @logic Download authenticated artifacts, stage selected restore files, require elevated confirmation for overwrite/reset, and surface server validation failures.
 * @dependencies Ant Design, next-intl, api-client, browser Blob/File APIs
 * @index_tags admin,backup,restore,reset,download
 * @author holic512
 */
import { useState } from 'react'

import {
  Alert,
  App,
  Button,
  Card,
  Checkbox,
  Input,
  Modal,
  Segmented,
  Space,
  Typography,
  Upload,
} from 'antd'
import {
  DatabaseBackup,
  Download,
  FolderArchive,
  RotateCcw,
  ShieldAlert,
  UploadCloud,
} from 'lucide-react'
import { useTranslations } from 'next-intl'

import { AdminPage } from '@/components/admin/admin-page'
import { apiFetch } from '@/lib/api-client'

type ImportMode = 'insert' | 'overwrite'

function downloadBlob(blob: Blob, fileName: string) {
  const url = URL.createObjectURL(blob)
  const anchor = document.createElement('a')
  anchor.href = url
  anchor.download = fileName
  document.body.appendChild(anchor)
  anchor.click()
  anchor.remove()
  URL.revokeObjectURL(url)
}

async function responseError(response: Response) {
  try {
    const payload = (await response.json()) as { message?: string }
    return payload.message || response.statusText
  } catch {
    return response.statusText || 'Request failed'
  }
}

export function BackupManager() {
  const t = useTranslations('AdminMM.backup')
  const { message, modal } = App.useApp()
  const [databaseMode, setDatabaseMode] = useState<ImportMode>('insert')
  const [filesMode, setFilesMode] = useState<ImportMode>('insert')
  const [busy, setBusy] = useState<string | null>(null)
  const [resetOpen, setResetOpen] = useState(false)
  const [resetPhrase, setResetPhrase] = useState('')
  const [clearDatabase, setClearDatabase] = useState(true)
  const [clearFiles, setClearFiles] = useState(true)

  const exportDatabase = async () => {
    setBusy('db-export')
    try {
      const backup = await apiFetch<unknown>('/api/admin/mm/backup/database-export')
      downloadBlob(
        new Blob([JSON.stringify(backup, null, 2)], { type: 'application/json' }),
        `slothvault-database-${new Date().toISOString().replaceAll(':', '-')}.json`,
      )
      message.success(t('messages.dbExportSuccess'))
    } catch (error) {
      message.error(error instanceof Error ? error.message : t('messages.dbExportFailed'))
    } finally {
      setBusy(null)
    }
  }

  const importDatabase = async (file: File) => {
    if (file.size > 50 * 1024 * 1024) {
      message.error(t('messages.dbImportFailed'))
      return
    }
    const execute = async () => {
      setBusy('db-import')
      try {
        const parsed = JSON.parse(await file.text()) as { data?: unknown; version?: unknown }
        await apiFetch('/api/admin/mm/backup/database-import', {
          method: 'POST',
          body: JSON.stringify({
            data: parsed.data ?? parsed,
            mode: databaseMode,
            ...(typeof parsed.version === 'string' ? { version: parsed.version } : {}),
          }),
        })
        message.success(t('messages.dbImportSuccess'))
      } catch (error) {
        message.error(error instanceof Error ? error.message : t('messages.dbImportFailed'))
      } finally {
        setBusy(null)
      }
    }
    if (databaseMode === 'overwrite') {
      modal.confirm({
        title: t('warning.title'),
        content: t('warning.content'),
        okButtonProps: { danger: true },
        onOk: execute,
      })
    } else {
      await execute()
    }
  }

  const exportFiles = async () => {
    setBusy('files-export')
    try {
      const response = await fetch('/api/admin/mm/backup/files-export', {
        credentials: 'same-origin',
      })
      if (!response.ok) throw new Error(await responseError(response))
      downloadBlob(
        await response.blob(),
        `slothvault-uploads-${new Date().toISOString().replaceAll(':', '-')}.zip`,
      )
      message.success(t('messages.filesExportSuccess'))
    } catch (error) {
      message.error(error instanceof Error ? error.message : t('messages.filesExportFailed'))
    } finally {
      setBusy(null)
    }
  }

  const importFiles = async (file: File) => {
    if (file.size > 250 * 1024 * 1024) {
      message.error(t('messages.filesImportFailed'))
      return
    }
    const execute = async () => {
      setBusy('files-import')
      try {
        const formData = new FormData()
        formData.append('file', file)
        formData.append('mode', filesMode)
        await apiFetch('/api/admin/mm/backup/files-import', {
          method: 'POST',
          body: formData,
        })
        message.success(t('messages.filesImportSuccess'))
      } catch (error) {
        message.error(error instanceof Error ? error.message : t('messages.filesImportFailed'))
      } finally {
        setBusy(null)
      }
    }
    if (filesMode === 'overwrite') {
      modal.confirm({
        title: t('warning.title'),
        content: t('warning.content'),
        okButtonProps: { danger: true },
        onOk: execute,
      })
    } else {
      await execute()
    }
  }

  const resetSystem = async () => {
    setBusy('reset')
    try {
      await apiFetch('/api/admin/mm/backup/system-reset', {
        method: 'POST',
        body: JSON.stringify({
          confirm: resetPhrase,
          clearDatabase,
          clearFiles,
        }),
      })
      setResetOpen(false)
      setResetPhrase('')
      message.success(t('messages.resetSuccess'))
    } catch (error) {
      message.error(error instanceof Error ? error.message : t('messages.resetFailed'))
    } finally {
      setBusy(null)
    }
  }

  return (
    <AdminPage>
      <Alert showIcon type="warning" message={t('warning.title')} description={t('warning.content')} />

      <div className="backup-grid">
        <BackupCard
          icon={<DatabaseBackup />}
          title={t('database.title')}
          description={t('database.desc')}
        >
          <div className="backup-action-row">
            <span><Download size={15} />{t('database.export')}</span>
            <Button loading={busy === 'db-export'} onClick={() => void exportDatabase()}>
              {t('actions.exportDb')}
            </Button>
          </div>
          <div className="backup-action-row">
            <Segmented
              value={databaseMode}
              onChange={(value) => setDatabaseMode(value as ImportMode)}
              options={[
                { value: 'insert', label: t('mode.insert') },
                { value: 'overwrite', label: t('mode.overwrite') },
              ]}
            />
            <Upload
              accept="application/json,.json"
              maxCount={1}
              showUploadList={false}
              beforeUpload={(file) => {
                void importDatabase(file)
                return Upload.LIST_IGNORE
              }}
            >
              <Button loading={busy === 'db-import'} icon={<UploadCloud size={14} />}>
                {t('actions.importDb')}
              </Button>
            </Upload>
          </div>
        </BackupCard>

        <BackupCard
          icon={<FolderArchive />}
          title={t('files.title')}
          description={t('files.desc')}
        >
          <div className="backup-action-row">
            <span><Download size={15} />{t('files.export')}</span>
            <Button loading={busy === 'files-export'} onClick={() => void exportFiles()}>
              {t('actions.exportFiles')}
            </Button>
          </div>
          <div className="backup-action-row">
            <Segmented
              value={filesMode}
              onChange={(value) => setFilesMode(value as ImportMode)}
              options={[
                { value: 'insert', label: t('mode.insert') },
                { value: 'overwrite', label: t('mode.overwrite') },
              ]}
            />
            <Upload
              accept="application/zip,.zip"
              maxCount={1}
              showUploadList={false}
              beforeUpload={(file) => {
                void importFiles(file)
                return Upload.LIST_IGNORE
              }}
            >
              <Button loading={busy === 'files-import'} icon={<UploadCloud size={14} />}>
                {t('actions.importFiles')}
              </Button>
            </Upload>
          </div>
        </BackupCard>

        <BackupCard
          danger
          icon={<ShieldAlert />}
          title={t('reset.title')}
          description={t('reset.desc')}
        >
          <div className="backup-action-row">
            <span><RotateCcw size={15} />{t('reset.action')}</span>
            <Button danger type="primary" onClick={() => setResetOpen(true)}>
              {t('actions.reset')}
            </Button>
          </div>
        </BackupCard>
      </div>

      <Modal
        open={resetOpen}
        title={t('reset.dialogTitle')}
        okText={t('reset.confirmButton')}
        cancelText={t('reset.cancelButton')}
        okButtonProps={{
          danger: true,
          disabled:
            resetPhrase !== 'RESET_ALL_DATA' || (!clearDatabase && !clearFiles),
        }}
        confirmLoading={busy === 'reset'}
        onCancel={() => setResetOpen(false)}
        onOk={() => void resetSystem()}
      >
        <Space orientation="vertical" size={14} className="full-width">
          <Alert showIcon type="error" message={t('reset.dialogWarning')} />
          <Checkbox checked={clearDatabase} onChange={(event) => setClearDatabase(event.target.checked)}>
            {t('reset.clearDatabase')}
          </Checkbox>
          <Checkbox checked={clearFiles} onChange={(event) => setClearFiles(event.target.checked)}>
            {t('reset.clearFiles')}
          </Checkbox>
          <Input
            status={resetPhrase && resetPhrase !== 'RESET_ALL_DATA' ? 'error' : undefined}
            value={resetPhrase}
            placeholder="RESET_ALL_DATA"
            onChange={(event) => setResetPhrase(event.target.value)}
          />
        </Space>
      </Modal>
    </AdminPage>
  )
}

function BackupCard({
  icon,
  title,
  description,
  danger,
  children,
}: {
  icon: React.ReactNode
  title: string
  description: string
  danger?: boolean
  children: React.ReactNode
}) {
  return (
    <Card className={`backup-card-next ${danger ? 'is-danger' : ''}`}>
      <div className="backup-card-heading">
        <span>{icon}</span>
        <div>
          <Typography.Title level={4}>{title}</Typography.Title>
          <Typography.Text type="secondary">{description}</Typography.Text>
        </div>
      </div>
      <div className="backup-card-actions">{children}</div>
    </Card>
  )
}
