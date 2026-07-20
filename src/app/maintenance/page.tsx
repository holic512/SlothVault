/**
 * @file page.tsx
 * @project SlothVault
 * @module Maintenance Page
 * @description Displays a non-destructive maintenance state when the encrypted database configuration cannot be used.
 * @logic Resolve the safe bootstrap error summary and avoid exposing connection credentials or reopening installation.
 * @dependencies auth-frame, database/installation-state, antd
 * @index_tags maintenance,database,configuration,page
 * @author holic512
 */
import { Alert, Card, Typography } from 'antd'

import { AuthFrame } from '@/components/auth/auth-frame'
import { readRuntimeInstallationPublicStatus } from '@/server/database/runtime-health'

export const dynamic = 'force-dynamic'

export default async function MaintenancePage() {
  const status = await readRuntimeInstallationPublicStatus()
  return (
    <AuthFrame>
      <Card className="auth-card" variant="borderless">
        <div className="auth-heading">
          <Typography.Text className="auth-kicker">SYSTEM MAINTENANCE</Typography.Text>
          <Typography.Title level={1}>数据库配置需要维护</Typography.Title>
          <Typography.Paragraph type="secondary">
            系统不会自动重新开放安装向导。请检查持久化配置卷、主密钥和数据库可用性。
          </Typography.Paragraph>
        </div>
        <Alert
          type="error"
          showIcon
          message={status.error || 'Database configuration is unavailable'}
        />
      </Card>
    </AuthFrame>
  )
}
