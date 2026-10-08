/**
 * @file project-access-notice.tsx
 * @project SlothVault
 * @module Project Permission Guidance
 * @description Explains current reading or download restrictions and the available login or membership action.
 * @logic Use the denied capability and selected type sale status to show an actionable explanation without exposing the body.
 * @dependencies content-access contracts, Ant Design, next-intl
 * @index_tags project,permissions,reader,membership,login
 * @author holic512
 */
import { Alert } from 'antd'
import Link from 'next/link'
import { useTranslations } from 'next-intl'
import type { ProjectAccess } from '@/lib/content-access'

export function ProjectAccessNotice({ access, capability = 'read' }: { access: ProjectAccess; capability?: 'read' | 'download' }) {
  const t = useTranslations('ProjectDocument.permissions')
  if (capability === 'read' ? access.canRead : access.canDownload) return null
  const reason = capability === 'read' ? access.readReason : access.downloadReason
  const rule = capability === 'read' || !access.canRead ? access.readAccess : access.downloadAccess
  const names = rule.membershipLevels.map((item) => item.name).join(' / ')
  const closed = reason === 'DOWNLOAD_DISABLED'
  const login = reason === 'LOGIN_REQUIRED'
  const sellable = rule.membershipLevels.some((item) => item.status === 1)
  return <Alert
    className="project-access-notice"
    showIcon
    type="info"
    title={closed ? t('downloadClosed') : capability === 'read' ? t('readLocked') : t('downloadLocked')}
    description={<>
      <p>{closed ? t('closedDescription') : login ? t('loginDescription') : t('memberDescription', { names: names || t('configuredMembers') })}</p>
      {!closed && login && rule.mode === 'MEMBERSHIPS' ? <p>{t('memberDescription', { names: names || t('configuredMembers') })}</p> : null}
      {!closed && (login ? <Link href="/login">{t('login')}</Link> : sellable ? <Link href="/account/membership">{t('openMembership')}</Link> : <span>{t('notForSale')}</span>)}
    </>}
  />
}
