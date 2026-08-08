'use client'

/**
 * @file administrator-stage.tsx
 * @project SlothVault
 * @module First-run Installation
 * @description Renders first-administrator credentials and validation after the database schema is ready.
 * @logic Collect and validate the administrator username and matching passwords, then delegate submission to the workflow orchestrator.
 * @dependencies Ant Design, Ant Design Icons, installation workflow types
 * @index_tags install,administrator,credentials,validation
 * @author holic512
 */
import { LockOutlined, SafetyCertificateOutlined, UserOutlined } from '@ant-design/icons'
import { Button, Divider, Form, Input, Typography } from 'antd'

import type { AdminValues, PendingAction, Translation } from './types'

export function AdministratorStage({
  t,
  form,
  pendingAction,
  onSubmit,
}: {
  t: Translation
  form: ReturnType<typeof Form.useForm<AdminValues>>[0]
  pendingAction: PendingAction
  onSubmit: (values: AdminValues) => void
}) {
  return (
    <div className="install-stage-content install-stage-content--enter">
      <div className="install-stage-heading">
        <Typography.Title level={3}>{t('admin.title')}</Typography.Title>
        <Typography.Paragraph type="secondary">{t('admin.desc')}</Typography.Paragraph>
      </div>

      <div className="install-admin-mark">
        <span><UserOutlined /></span>
        <div><strong>{t('admin.ownerTitle')}</strong><small>{t('admin.ownerDesc')}</small></div>
      </div>

      <Form<AdminValues>
        form={form}
        layout="vertical"
        requiredMark={false}
        size="large"
        disabled={Boolean(pendingAction)}
        onFinish={onSubmit}
      >
        <Form.Item
          label={t('fields.adminUsername')}
          name="username"
          rules={[
            { required: true, message: t('validation.adminUsername') },
            { min: 2, max: 64, message: t('validation.adminUsernameLength') },
          ]}
        >
          <Input prefix={<UserOutlined />} placeholder={t('placeholders.adminUsername')} autoComplete="username" />
        </Form.Item>
        <Form.Item
          label={t('fields.adminPassword')}
          name="password"
          rules={[
            { required: true, message: t('validation.adminPassword') },
            { min: 8, max: 256, message: t('validation.adminPasswordLength') },
          ]}
        >
          <Input.Password prefix={<LockOutlined />} placeholder={t('placeholders.adminPassword')} autoComplete="new-password" />
        </Form.Item>
        <Form.Item
          label={t('fields.confirmPassword')}
          name="confirmPassword"
          dependencies={['password']}
          rules={[
            { required: true, message: t('validation.confirmPassword') },
            ({ getFieldValue }) => ({
              validator(_, value) {
                return !value || getFieldValue('password') === value
                  ? Promise.resolve()
                  : Promise.reject(new Error(t('validation.passwordMismatch')))
              },
            }),
          ]}
        >
          <Input.Password prefix={<LockOutlined />} placeholder={t('placeholders.confirmPassword')} autoComplete="new-password" />
        </Form.Item>
        <Divider />
        <Button block type="primary" htmlType="submit" loading={pendingAction === 'admin'} icon={<SafetyCertificateOutlined />}>
          {t('actions.createAdmin')}
        </Button>
      </Form>
    </div>
  )
}
