'use client'

/**
 * @file account-profile-view.tsx
 * @project SlothVault
 * @module Personal Profile Settings
 * @description Provides the dedicated authenticated profile editor with a managed avatar upload control.
 * @logic Initialize from the shared account context, upload or remove the avatar through its dedicated file API, persist remaining profile fields, and synchronize the global account session cache after each change.
 * @dependencies React, React Query, Ant Design, account shell, account profile APIs
 * @index_tags account,profile,avatar,upload,settings,form
 * @author holic512
 */
import { useEffect } from 'react'

import { useMutation, useQueryClient } from '@tanstack/react-query'
import { App, Avatar, Button, Form, Input, Space, Typography, Upload } from 'antd'
import { ImageUp, Save, Trash2, UserRound } from 'lucide-react'
import { useTranslations } from 'next-intl'

import { useAccountUser } from '@/components/account/account-shell'
import { AccountCard } from '@/components/account/account-card'
import { apiFetch } from '@/lib/api-client'
import type { SessionUser } from '@/types/user'

type ProfileValues = {
  displayName?: string
  email?: string
  bio?: string
}

export function AccountProfileView() {
  const t = useTranslations('Account.profile')
  const user = useAccountUser()
  const queryClient = useQueryClient()
  const { message } = App.useApp()
  const [form] = Form.useForm<ProfileValues>()

  useEffect(() => {
    form.setFieldsValue({
      displayName: user.displayName || '',
      email: user.email || '',
      bio: user.bio || '',
    })
  }, [form, user.displayName, user.email, user.bio])

  const saveMutation = useMutation({
    mutationFn: (values: ProfileValues) =>
      apiFetch<SessionUser>('/api/account/profile', {
        method: 'PATCH',
        body: JSON.stringify({
          displayName: values.displayName || null,
          email: values.email || null,
          bio: values.bio || null,
        }),
      }),
    onSuccess: (nextUser) => {
      queryClient.setQueryData(['session-user'], nextUser)
      message.success(t('saved'))
    },
    onError: (error) => message.error(error.message),
  })

  const uploadAvatarMutation = useMutation({
    mutationFn: async (file: File) => {
      const formData = new FormData()
      formData.append('file', file)
      return apiFetch<SessionUser>('/api/account/profile/avatar', {
        method: 'POST',
        body: formData,
      })
    },
    onSuccess: (nextUser) => {
      queryClient.setQueryData(['session-user'], nextUser)
      message.success(t('avatarUpdated'))
    },
    onError: (error) => message.error(error.message),
  })

  const removeAvatarMutation = useMutation({
    mutationFn: () => apiFetch<SessionUser>('/api/account/profile/avatar', { method: 'DELETE' }),
    onSuccess: (nextUser) => {
      queryClient.setQueryData(['session-user'], nextUser)
      message.success(t('avatarReset'))
    },
    onError: (error) => message.error(error.message),
  })

  return (
    <div className="account-route">
      <div className="account-route-heading">
        <div>
          <Typography.Title level={1}>{t('title')}</Typography.Title>
          <Typography.Text type="secondary">{t('description')}</Typography.Text>
        </div>
      </div>

      <div className="account-profile-grid">
        <AccountCard className="account-avatar-card" title={t('avatar')}>
          <Space wrap size={12}>
            <Avatar size={68} src={user.avatar || undefined} icon={<UserRound />} />
            <Space orientation="vertical" size={6}>
              <Upload
                accept="image/png,image/jpeg,image/gif,image/webp"
                maxCount={1}
                showUploadList={false}
                beforeUpload={(file) => {
                  uploadAvatarMutation.mutate(file)
                  return false
                }}
              >
                <Button icon={<ImageUp size={15} />} loading={uploadAvatarMutation.isPending}>
                  {t('uploadAvatar')}
                </Button>
              </Upload>
              <Button
                danger
                size="small"
                icon={<Trash2 size={14} />}
                disabled={!user.avatar}
                loading={removeAvatarMutation.isPending}
                onClick={() => removeAvatarMutation.mutate()}
              >
                {t('resetAvatar')}
              </Button>
              <Typography.Text type="secondary">{t('avatarHint')}</Typography.Text>
            </Space>
          </Space>
        </AccountCard>
        <AccountCard className="account-route-card" title={t('details')}>
          <Form form={form} layout="vertical" onFinish={(values) => saveMutation.mutate(values)}>
            <div className="account-form-grid">
              <Form.Item name="displayName" label={t('displayName')}><Input prefix={<UserRound size={14} />} maxLength={80} /></Form.Item>
              <Form.Item name="email" label={t('email')} rules={[{ type: 'email', message: t('emailInvalid') }]}><Input /></Form.Item>
            </div>
            <Form.Item name="bio" label={t('bio')}>
              <Input.TextArea rows={4} maxLength={2_000} showCount />
            </Form.Item>
            <div className="account-form-footer"><Button type="primary" htmlType="submit" icon={<Save size={15} />} loading={saveMutation.isPending}>{t('save')}</Button></div>
          </Form>
        </AccountCard>
      </div>
    </div>
  )
}
