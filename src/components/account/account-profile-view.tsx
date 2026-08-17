'use client'

/**
 * @file account-profile-view.tsx
 * @project SlothVault
 * @module Personal Profile Settings
 * @description Provides the dedicated authenticated profile editor.
 * @logic Initialize from the shared account context, persist only profile fields, and synchronize the global account session cache after saving.
 * @dependencies React, React Query, Ant Design, account shell, account profile API
 * @index_tags account,profile,settings,form
 * @author holic512
 */
import { useEffect } from 'react'

import { useMutation, useQueryClient } from '@tanstack/react-query'
import { App, Button, Card, Form, Input, Typography } from 'antd'
import { Save, UserRound } from 'lucide-react'

import { useAccountUser } from '@/components/account/account-shell'
import { apiFetch } from '@/lib/api-client'
import type { SessionUser } from '@/types/user'

type ProfileValues = {
  displayName?: string
  email?: string
  avatar?: string
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
      avatar: user.avatar || '',
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
          avatar: values.avatar || null,
          bio: values.bio || null,
        }),
      }),
    onSuccess: (nextUser) => {
      queryClient.setQueryData(['session-user'], nextUser)
      message.success('个人资料已保存')
    },
    onError: (error) => message.error(error.message),
  })

  return (
    <div className="account-route">
      <div className="account-route-heading">
        <div>
          <Typography.Text className="account-eyebrow">Profile</Typography.Text>
          <Typography.Title level={2}>个人资料</Typography.Title>
          <Typography.Text type="secondary">这些信息会用于你的公开主页和账户菜单。</Typography.Text>
        </div>
      </div>

      <Card className="account-card account-route-card">
        <Form form={form} layout="vertical" onFinish={(values) => saveMutation.mutate(values)}>
          <div className="account-form-grid">
            <Form.Item name="displayName" label="显示名称"><Input prefix={<UserRound size={14} />} maxLength={80} /></Form.Item>
            <Form.Item name="email" label="邮箱" rules={[{ type: 'email', message: '请输入有效邮箱地址' }]}><Input /></Form.Item>
          </div>
          <Form.Item name="avatar" label="头像地址" rules={[{ type: 'url', warningOnly: true }]}>
            <Input placeholder="https://..." />
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
