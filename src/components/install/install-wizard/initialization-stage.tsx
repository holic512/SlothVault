'use client'

/**
 * @file initialization-stage.tsx
 * @project SlothVault
 * @module First-run Installation
 * @description Renders the schema initialization confirmation stage after a successful database connection test.
 * @logic Confirm the verified provider and delegate the back or schema initialization action with minimal explanatory chrome.
 * @dependencies Ant Design, Ant Design Icons, installation workflow types
 * @index_tags install,database,schema,initialization
 * @author holic512
 */
import { ArrowLeftOutlined, CheckCircleFilled, DatabaseOutlined } from '@ant-design/icons'
import { Button, Typography } from 'antd'

import type { DatabaseProvider, PendingAction, Translation } from './types'

export function InitializationStage({
  t,
  provider,
  pendingAction,
  onBack,
  onInitialize,
}: {
  t: Translation
  provider: DatabaseProvider
  pendingAction: PendingAction
  onBack: () => void
  onInitialize: () => void
}) {
  return (
    <div className="install-stage-content install-stage-content--enter">
      <div className="install-stage-heading">
        <Typography.Title level={3}>{t('initialize.title')}</Typography.Title>
      </div>

      <div className="install-check-card">
        <span className="install-check-icon"><CheckCircleFilled /></span>
        <div>
          <Typography.Text strong>{t('initialize.connectionReady')}</Typography.Text>
          <Typography.Paragraph type="secondary">
            {t('initialize.connectionReadyDesc', { provider: t(`provider.${provider}.name`) })}
          </Typography.Paragraph>
        </div>
      </div>

      <Typography.Paragraph className="install-inline-note" type="secondary">
        {t('initialize.notice')}
      </Typography.Paragraph>

      <div className="install-actions">
        <Button icon={<ArrowLeftOutlined />} disabled={Boolean(pendingAction)} onClick={onBack}>
          {t('actions.back')}
        </Button>
        <Button
          type="primary"
          icon={<DatabaseOutlined />}
          loading={pendingAction === 'initialize'}
          disabled={Boolean(pendingAction && pendingAction !== 'initialize')}
          onClick={onInitialize}
        >
          {t('actions.initialize')}
        </Button>
      </div>
    </div>
  )
}
