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
import { App, Avatar, Button, Card, Form, Input, Space, Typography, Upload } from 'antd'
import { ImageUp, Save, Trash2, UserRound } from 'lucide-react'

import { useAccountUser } from '@/components/account/account-shell'
import { apiFetch } from '@/lib/api-client'
import type { SessionUser } from '@/types/user'

type ProfileValues = {
  displayName?: string
  email?: string
  bio?: string
}

export function AccountProfileView() {
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
  }, [form, user])

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
      message.success('个人资料已保存')
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
      message.success('头像已更新')
    },
    onError: (error) => message.error(error.message),
  })

  const removeAvatarMutation = useMutation({
    mutationFn: () => apiFetch<SessionUser>('/api/account/profile/avatar', { method: 'DELETE' }),
    onSuccess: (nextUser) => {
      queryClient.setQueryData(['session-user'], nextUser)
      message.success('头像已恢复为默认')
    },
    onError: (error) => message.error(error.message),
  })

  return (
    <div className="account-route">
      <div className="account-route-heading">
        <div>
          <Typography.Text className="account-eyebrow">Profile</Typography.Text>
          <Typography.Title level={2}>个人资料</Typography.Title>
          <Typography.Text type="secondary">这些信息仅用于账户识别、登录菜单和受保护的账户功能。</Typography.Text>
        </div>
      </div>

      <Card className="account-card account-route-card">
        <Form form={form} layout="vertical" onFinish={(values) => saveMutation.mutate(values)}>
          <div className="account-form-grid">
            <Form.Item name="displayName" label="显示名称"><Input prefix={<UserRound size={14} />} maxLength={80} /></Form.Item>
            <Form.Item name="email" label="邮箱" rules={[{ type: 'email', message: '请输入有效邮箱地址' }]}><Input /></Form.Item>
          </div>
          <Form.Item label="头像">
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
                    上传头像
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
                  恢复默认头像
                </Button>
                <Typography.Text type="secondary">支持 JPG、PNG、GIF、WebP，单个文件最大 2MB。</Typography.Text>
              </Space>
            </Space>
          </Form.Item>
          <Form.Item name="bio" label="个人简介">
            <Input.TextArea rows={4} maxLength={2_000} showCount />
          </Form.Item>
          <Button type="primary" htmlType="submit" icon={<Save size={15} />} loading={saveMutation.isPending}>保存资料</Button>
        </Form>
      </Card>
    </div>
  )
}
