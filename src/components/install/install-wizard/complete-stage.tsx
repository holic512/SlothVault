'use client'

/**
 * @file complete-stage.tsx
 * @project SlothVault
 * @module First-run Installation
 * @description Renders the successful installation handoff to the administrator login page.
 * @logic Show completion feedback and delegate immediate login navigation while the orchestrator retains timed redirection.
 * @dependencies Ant Design, Ant Design Icons, installation workflow types
 * @index_tags install,complete,login,handoff
 * @author holic512
 */
import { ArrowRightOutlined } from '@ant-design/icons'
import { Button, Result, Typography } from 'antd'

import type { Translation } from './types'

export function CompleteStage({ t, onLogin }: { t: Translation; onLogin: () => void }) {
  return (
    <div className="install-stage-content install-stage-content--complete install-stage-content--enter">
      <Result
        status="success"
        title={t('complete.title')}
        subTitle={t('complete.desc')}
        extra={
          <Button type="primary" icon={<ArrowRightOutlined />} iconPlacement="end" onClick={onLogin}>
            {t('actions.login')}
          </Button>
        }
      />
      <Typography.Text type="secondary">{t('complete.redirecting')}</Typography.Text>
    </div>
  )
}
