'use client'

/**
 * @file backup-manager.tsx
 * @project SlothVault
 * @module Backup Administration
 * @description Supplies the system reset panel to the tabbed backup workspace.
 * @logic Preserve operation locks and require explicit system reset confirmation.
 * @dependencies complete-backup-manager, Ant Design, next-intl, api-client
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
  Space,
  Typography,
} from 'antd'
import {
  RotateCcw,
  ShieldAlert,
} from 'lucide-react'
import { useTranslations } from 'next-intl'

import { AdminPage } from '@/components/admin/admin-page'
import { CompleteBackupManager } from '@/components/admin/complete-backup-manager'
import { formatAdminError } from '@/lib/admin-localization'
import { apiFetch } from '@/lib/api-client'

export function BackupManager() {
  const t = useTranslations('AdminMM.backup')
  const errorT = useTranslations('AdminMM.errors')
  const { message } = App.useApp()
  const [busy, setBusy] = useState<string | null>(null)
  const [completeBusy, setCompleteBusy] = useState(false)
  const disabled = Boolean(busy || completeBusy)
  const [resetOpen, setResetOpen] = useState(false)
  const [resetPhrase, setResetPhrase] = useState('')
  const [clearDatabase, setClearDatabase] = useState(true)
  const [clearFiles, setClearFiles] = useState(true)

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
      message.error(formatAdminError(error, errorT))
    } finally {
      setBusy(null)
    }
  }

  return (
    <AdminPage>
      <CompleteBackupManager
        externalBusy={Boolean(busy)}
        onBusyChange={setCompleteBusy}
        dangerPanel={
          <BackupCard danger icon={<ShieldAlert />} title={t('reset.title')} description={t('reset.desc')}>
            <Typography.Paragraph>{t('reset.dialogWarning')}</Typography.Paragraph>
            <div>
              <Button danger disabled={disabled} icon={<RotateCcw size={15} />} onClick={() => setResetOpen(true)}>
                {t('actions.reset')}
              </Button>
            </div>
          </BackupCard>
        }
      />

      <Modal
        open={resetOpen}
        title={t('reset.dialogTitle')}
        okText={t('reset.confirmButton')}
        cancelText={t('reset.cancelButton')}
        okButtonProps={{
          danger: true,
          disabled:
            disabled || resetPhrase !== 'RESET_ALL_DATA' || (!clearDatabase && !clearFiles),
        }}
        confirmLoading={busy === 'reset'}
        onCancel={() => setResetOpen(false)}
        onOk={() => void resetSystem()}
      >
        <Space orientation="vertical" size={14} className="full-width">
          <Alert showIcon type="error" title={t('reset.dialogWarning')} />
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
