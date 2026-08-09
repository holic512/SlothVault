'use client'

/**
 * @file install-wizard.tsx
 * @project SlothVault
 * @module First-run Installation
 * @description Orchestrates the resumable SQLite, MySQL, or PostgreSQL installation experience and first-administrator setup.
 * @logic Read and apply installation state, coordinate provider configuration and API actions, advance workflow stages, and hand off to login.
 * @dependencies Ant Design, next-intl, Next navigation, api-client, installation shell and stages
 * @index_tags install,setup,database,sqlite,mysql,postgresql,admin,orchestration
 * @author holic512
 */
import { useCallback, useEffect, useRef, useState } from 'react'

import { ReloadOutlined, SettingOutlined } from '@ant-design/icons'
import {
  Alert,
  App,
  Button,
  Card,
  Form,
  Progress,
  Result,
  Skeleton,
  Spin,
  Typography,
} from 'antd'
import { useTranslations } from 'next-intl'
import { useRouter } from 'next/navigation'

import { ApiClientError, apiFetch } from '@/lib/api-client'

import { AdministratorStage } from './install-wizard/administrator-stage'
import { CompleteStage } from './install-wizard/complete-stage'
import { ConnectionStage } from './install-wizard/connection-stage'
import {
  buildDatabaseConfig,
  errorMessage,
  isDatabaseProvider,
  isFormValidationError,
  isInstallationStatus,
} from './install-wizard/helpers'
import { InitializationStage } from './install-wizard/initialization-stage'
import { InstallShell } from './install-wizard/install-shell'
import type {
  AdminValues,
  ConnectionDraft,
  ConnectionValues,
  DatabaseProvider,
  InstallationStatus,
  InstallStatusResponse,
  PendingAction,
} from './install-wizard/types'

export function InstallWizard() {
  const t = useTranslations('Install')
  const router = useRouter()
  const { message } = App.useApp()
  const [connectionForm] = Form.useForm<ConnectionValues>()
  const [adminForm] = Form.useForm<AdminValues>()
  const [provider, setProvider] = useState<DatabaseProvider>('sqlite')
  const [serverStatus, setServerStatus] = useState<InstallationStatus | null>(null)
  const [activeStep, setActiveStep] = useState(0)
  const [pendingAction, setPendingAction] = useState<PendingAction>('status')
  const [pageError, setPageError] = useState('')
  const [flowError, setFlowError] = useState('')
  const [statusMessage, setStatusMessage] = useState('')
  const [connectionDraft, setConnectionDraft] = useState<ConnectionDraft | null>(null)
  const loginTimer = useRef<number | null>(null)
  const tlsEnabled = Form.useWatch('tlsEnabled', connectionForm)

  const applyStatus = useCallback(
    (state: InstallStatusResponse) => {
      if (!isInstallationStatus(state.status)) throw new Error(t('errors.invalidStatus'))

      const nextProvider = isDatabaseProvider(state.provider) ? state.provider : null
      setServerStatus(state.status)
      setStatusMessage(state.message ?? state.error ?? '')
      if (nextProvider) {
        setProvider(nextProvider)
        connectionForm.setFieldValue('port', nextProvider === 'mysql' ? 3306 : 5432)
      }

      if (state.status === 'INSTALLED') {
        router.replace('/admin/auth/login')
        return
      }
      if (state.status === 'SCHEMA_READY') {
        setActiveStep(2)
        return
      }
      if (state.status === 'UNCONFIGURED' || state.status === 'CONFIGURING') {
        setActiveStep(0)
      }
    },
    [connectionForm, router, t],
  )

  const loadStatus = useCallback(async () => {
    try {
      const state = await apiFetch<InstallStatusResponse>('/api/install/status', { cache: 'no-store' })
      applyStatus(state)
    } catch (error) {
      if (error instanceof ApiClientError && error.status === 503) {
        const data = error.data as Partial<InstallStatusResponse> | null
        setServerStatus('MAINTENANCE')
        setStatusMessage(data?.message || data?.error || error.message)
      } else {
        setPageError(errorMessage(error, t('errors.status')))
      }
    } finally {
      setPendingAction(null)
    }
  }, [applyStatus, t])

  useEffect(() => {
    const statusTimer = window.setTimeout(() => void loadStatus(), 0)
    return () => {
      window.clearTimeout(statusTimer)
      if (loginTimer.current !== null) window.clearTimeout(loginTimer.current)
    }
  }, [loadStatus])

  const retryStatus = () => {
    setPendingAction('status')
    setPageError('')
    void loadStatus()
  }

  const selectProvider = (nextProvider: DatabaseProvider) => {
    if (pendingAction || nextProvider === provider) return
    setProvider(nextProvider)
    setFlowError('')
    setConnectionDraft(null)
    connectionForm.resetFields(['password', 'caPem', 'tlsEnabled'])
    if (nextProvider !== 'sqlite') {
      connectionForm.setFieldValue('port', nextProvider === 'mysql' ? 3306 : 5432)
    }
  }

  const testConnection = async () => {
    setFlowError('')
    try {
      const values = provider === 'sqlite' ? {} : await connectionForm.validateFields()
      const draft = { provider, config: buildDatabaseConfig(provider, values) }
      setPendingAction('test')
      await apiFetch('/api/install/test-connection', {
        method: 'POST',
        body: JSON.stringify(draft),
      })
      setConnectionDraft(draft)
      setActiveStep(1)
      message.success(t('messages.connectionSuccess'))
    } catch (error) {
      if (!isFormValidationError(error)) {
        setFlowError(errorMessage(error, t('errors.connection')))
      }
    } finally {
      setPendingAction(null)
    }
  }

  const initializeSchema = async () => {
    if (!connectionDraft) {
      setActiveStep(0)
      setFlowError(t('errors.connectionExpired'))
      return
    }

    setPendingAction('initialize')
    setFlowError('')
    try {
      await apiFetch('/api/install/initialize', {
        method: 'POST',
        body: JSON.stringify(connectionDraft),
      })
      setConnectionDraft(null)
      connectionForm.setFieldValue('password', undefined)
      setServerStatus('SCHEMA_READY')
      setActiveStep(2)
      message.success(t('messages.schemaSuccess'))
    } catch (error) {
      setFlowError(errorMessage(error, t('errors.initialize')))
    } finally {
      setPendingAction(null)
    }
  }

  const createAdministrator = async (values: AdminValues) => {
    setPendingAction('admin')
    setFlowError('')
    try {
      await apiFetch('/api/install/admin', {
        method: 'POST',
        body: JSON.stringify({ username: values.username.trim(), password: values.password }),
      })
      adminForm.resetFields()
      setServerStatus('INSTALLED')
      setActiveStep(3)
      message.success(t('messages.adminSuccess'))
      loginTimer.current = window.setTimeout(() => router.replace('/admin/auth/login'), 1200)
    } catch (error) {
      setFlowError(errorMessage(error, t('errors.admin')))
    } finally {
      setPendingAction(null)
    }
  }

  const resetConfiguration = async () => {
    setPendingAction('reset')
    setFlowError('')
    try {
      await apiFetch('/api/install/reset', { method: 'POST', body: '{}' })
      connectionForm.resetFields()
      setConnectionDraft(null)
      setProvider('sqlite')
      setServerStatus('UNCONFIGURED')
      setActiveStep(0)
      message.success(t('messages.resetSuccess'))
    } catch (error) {
      setFlowError(errorMessage(error, t('errors.reset')))
    } finally {
      setPendingAction(null)
    }
  }

  const stepLabels = [t('steps.connection'), t('steps.initialize'), t('steps.admin'), t('steps.complete')]

  if (pendingAction === 'status' && !serverStatus && !pageError) {
    return (
      <InstallShell statusLabel={t('status.checking')}>
        <Card className="install-card install-card--loading" variant="borderless">
          <Spin size="large" />
          <div>
            <Typography.Title level={2}>{t('loading.title')}</Typography.Title>
            <Typography.Paragraph type="secondary">{t('loading.desc')}</Typography.Paragraph>
          </div>
          <Skeleton active paragraph={{ rows: 3 }} title={false} />
        </Card>
      </InstallShell>
    )
  }

  if (pageError) {
    return (
      <InstallShell statusLabel={t('status.unavailable')}>
        <Card className="install-card install-card--state" variant="borderless">
          <Result
            status="error"
            title={t('state.loadErrorTitle')}
            subTitle={pageError}
            extra={
              <Button type="primary" icon={<ReloadOutlined />} loading={pendingAction === 'status'} onClick={retryStatus}>
                {t('actions.retry')}
              </Button>
            }
          />
        </Card>
      </InstallShell>
    )
  }

  if (serverStatus === 'MAINTENANCE') {
    return (
      <InstallShell statusLabel={t('status.maintenance')}>
        <Card className="install-card install-card--state" variant="borderless">
          <Result
            status="warning"
            icon={<SettingOutlined />}
            title={t('state.maintenanceTitle')}
            subTitle={statusMessage || t('state.maintenanceDesc')}
            extra={
              <Button icon={<ReloadOutlined />} loading={pendingAction === 'status'} onClick={retryStatus}>
                {t('actions.recheck')}
              </Button>
            }
          />
        </Card>
      </InstallShell>
    )
  }

  return (
    <InstallShell statusLabel={t(`status.${(serverStatus ?? 'UNCONFIGURED').toLowerCase()}`)}>
      <Card className="install-card" variant="borderless">
        <div className="install-card-head">
          <Typography.Text className="install-step-label">
            {activeStep < 3 ? `${activeStep + 1} / 3` : t('steps.complete')}
          </Typography.Text>
          <Typography.Text type="secondary">{stepLabels[activeStep]}</Typography.Text>
        </div>
        <Progress
          className="install-progress"
          percent={activeStep === 3 ? 100 : ((activeStep + 1) / 3) * 100}
          showInfo={false}
          size={{ height: 3 }}
          strokeLinecap="butt"
        />

        {flowError ? (
          <Alert
            className="install-alert"
            type="error"
            showIcon
            title={t('errors.actionTitle')}
            description={flowError}
          />
        ) : null}

        <div className="install-stage" aria-live="polite">
          {activeStep === 0 ? (
            <ConnectionStage
              t={t}
              form={connectionForm}
              provider={provider}
              tlsEnabled={Boolean(tlsEnabled)}
              recovering={serverStatus === 'CONFIGURING'}
              pendingAction={pendingAction}
              onProviderChange={selectProvider}
              onTest={testConnection}
              onReset={resetConfiguration}
            />
          ) : null}

          {activeStep === 1 ? (
            <InitializationStage
              t={t}
              provider={provider}
              pendingAction={pendingAction}
              onBack={() => {
                setFlowError('')
                setActiveStep(0)
              }}
              onInitialize={initializeSchema}
            />
          ) : null}

          {activeStep === 2 ? (
            <AdministratorStage
              t={t}
              form={adminForm}
              pendingAction={pendingAction}
              onSubmit={createAdministrator}
            />
          ) : null}

          {activeStep === 3 ? <CompleteStage t={t} onLogin={() => router.replace('/admin/auth/login')} /> : null}
        </div>
      </Card>
    </InstallShell>
  )
}
