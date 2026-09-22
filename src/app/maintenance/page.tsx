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
import TypographyParagraph from 'antd/es/typography/Paragraph'
import TypographyText from 'antd/es/typography/Text'
import TypographyTitle from 'antd/es/typography/Title'
import { Alert, Card } from 'antd'

import { AuthFrame } from '@/components/auth/auth-frame'
import { createPageMetadata } from '@/i18n/metadata'
import { readRuntimeInstallationPublicStatus } from '@/server/database/runtime-health'
import { getTranslations } from 'next-intl/server'

export const dynamic = 'force-dynamic'

export async function generateMetadata() {
  return createPageMetadata('maintenance')
}

export default async function MaintenancePage() {
  const status = await readRuntimeInstallationPublicStatus()
  const t = await getTranslations('Maintenance')
  return (
    <AuthFrame>
      <Card className="auth-card" variant="borderless">
        <div className="auth-heading">
          <TypographyText className="auth-kicker">{t('kicker')}</TypographyText>
          <TypographyTitle level={1}>{t('title')}</TypographyTitle>
          <TypographyParagraph type="secondary">
            {t('description')}
          </TypographyParagraph>
        </div>
        <Alert
          type="error"
          showIcon
          title={status.error || t('unavailable')}
        />
      </Card>
    </AuthFrame>
  )
}
