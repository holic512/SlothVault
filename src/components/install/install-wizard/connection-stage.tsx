'use client'

/**
 * @file connection-stage.tsx
 * @project SlothVault
 * @module First-run Installation
 * @description Renders database provider selection and connection configuration for the first installation stage.
 * @logic Select a provider, collect provider-specific fields, expose recovery reset, and delegate connection testing to the orchestrator.
 * @dependencies Ant Design, Ant Design Icons, provider icons, installation workflow types
 * @index_tags install,connection,database,sqlite,mysql,postgresql,tls
 * @author holic512
 */
import {
  ArrowRightOutlined,
  CheckCircleFilled,
  CloudServerOutlined,
  DatabaseOutlined,
  HddOutlined,
  LockOutlined,
  UserOutlined,
} from '@ant-design/icons'
import { Alert, Button, Form, Input, InputNumber, Switch, Typography } from 'antd'

import { providerIcons } from './provider-icons'
import type {
  ConnectionValues,
  DatabaseProvider,
  PendingAction,
  Translation,
} from './types'

export function ConnectionStage({
  t,
  form,
  provider,
  tlsEnabled,
  recovering,
  pendingAction,
  onProviderChange,
  onTest,
  onReset,
}: {
  t: Translation
  form: ReturnType<typeof Form.useForm<ConnectionValues>>[0]
  provider: DatabaseProvider
  tlsEnabled: boolean
  recovering: boolean
  pendingAction: PendingAction
  onProviderChange: (provider: DatabaseProvider) => void
  onTest: () => void
  onReset: () => void
}) {
  return (
    <div className="install-stage-content install-stage-content--enter">
      <div className="install-stage-heading">
        <Typography.Title level={3}>{t('connection.title')}</Typography.Title>
        <Typography.Paragraph type="secondary">{t('connection.desc')}</Typography.Paragraph>
      </div>

      {recovering ? (
        <Alert
          className="install-recovery-alert"
          type="warning"
          showIcon
          title={t('connection.recoveryTitle')}
          description={t('connection.recoveryDesc')}
        />
      ) : null}

      <div className="install-provider-grid" role="radiogroup" aria-label={t('connection.providerLabel')}>
        {(['sqlite', 'mysql', 'postgresql'] as const).map((item) => (
          <button
            key={item}
            type="button"
            role="radio"
            aria-checked={provider === item}
            className={`install-provider-option${provider === item ? ' is-active' : ''}`}
            disabled={Boolean(pendingAction)}
            onClick={() => onProviderChange(item)}
          >
            <span className="install-provider-icon">{providerIcons[item]}</span>
            <span>
              <strong>{t(`provider.${item}.name`)}</strong>
              <small>{t(`provider.${item}.desc`)}</small>
            </span>
            <CheckCircleFilled className="install-provider-check" />
          </button>
        ))}
      </div>

      {provider === 'sqlite' ? (
        <div className="install-sqlite-note">
          <HddOutlined />
          <div>
            <Typography.Text strong>{t('connection.sqliteTitle')}</Typography.Text>
            <Typography.Paragraph type="secondary">{t('connection.sqliteDesc')}</Typography.Paragraph>
          </div>
        </div>
      ) : (
        <Form<ConnectionValues>
          form={form}
          className="install-connection-form"
          layout="vertical"
          requiredMark={false}
          initialValues={{ port: provider === 'mysql' ? 3306 : 5432, tlsEnabled: false }}
          disabled={Boolean(pendingAction)}
        >
          <div className="install-form-grid">
            <Form.Item label={t('fields.host')} name="host" rules={[{ required: true, message: t('validation.host') }]}>
              <Input prefix={<CloudServerOutlined />} placeholder={t('placeholders.host')} autoComplete="off" />
            </Form.Item>
            <Form.Item
              label={t('fields.port')}
              name="port"
              rules={[{ required: true, message: t('validation.port') }, { type: 'number', min: 1, max: 65535 }]}
            >
              <InputNumber className="full-width" min={1} max={65535} controls={false} />
            </Form.Item>
          </div>
          <Form.Item label={t('fields.database')} name="database" rules={[{ required: true, message: t('validation.database') }]}>
            <Input prefix={<DatabaseOutlined />} placeholder={t('placeholders.database')} autoComplete="off" />
          </Form.Item>
          <div className="install-form-grid">
            <Form.Item label={t('fields.username')} name="username" rules={[{ required: true, message: t('validation.username') }]}>
              <Input prefix={<UserOutlined />} placeholder={t('placeholders.username')} autoComplete="off" />
            </Form.Item>
            <Form.Item label={t('fields.password')} name="password" rules={[{ required: true, message: t('validation.password') }]}>
              <Input.Password prefix={<LockOutlined />} placeholder={t('placeholders.password')} autoComplete="new-password" />
            </Form.Item>
          </div>
          <div className="install-tls-row">
            <div>
              <Typography.Text strong>{t('fields.tls')}</Typography.Text>
              <Typography.Text type="secondary">{t('fields.tlsHint')}</Typography.Text>
            </div>
            <Form.Item name="tlsEnabled" valuePropName="checked" noStyle>
              <Switch aria-label={t('fields.tls')} />
            </Form.Item>
          </div>
          {tlsEnabled ? (
            <Form.Item className="install-ca-field" label={t('fields.caPem')} name="caPem" extra={t('fields.caPemHint')}>
              <Input.TextArea rows={4} placeholder={t('placeholders.caPem')} autoComplete="off" />
            </Form.Item>
          ) : null}
        </Form>
      )}

      <div className="install-actions">
        {recovering ? (
          <Button danger type="text" loading={pendingAction === 'reset'} onClick={onReset}>
            {t('actions.reset')}
          </Button>
        ) : <span />}
        <Button
          type="primary"
          icon={<ArrowRightOutlined />}
          iconPlacement="end"
          loading={pendingAction === 'test'}
          disabled={Boolean(pendingAction && pendingAction !== 'test')}
          onClick={onTest}
        >
          {t('actions.test')}
        </Button>
      </div>
    </div>
  )
}
