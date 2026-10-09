/**
 * @file system-filing-footer.tsx
 * @project SlothVault
 * @module Public Filing Footer
 * @description Renders database-backed filing records in the selected public and user authentication shells.
 * @logic Read fresh filing values on the server, render each configured number as text or a safe external link, and omit the entire footer when empty.
 * @dependencies system-filing service, next-intl/server, system-filing-footer.module.css
 * @index_tags footer,filing,icp,public-security,public,server-component
 * @author holic512
 */
import { getTranslations } from 'next-intl/server'

import { getSystemFiling, type SystemFilingRecord } from '@/server/services/system-filing'
import styles from '@/styles/modules/system-filing-footer.module.css'

export async function SystemFilingFooter() {
  const filing = await getSystemFiling()
  if (!filing.icp && !filing.publicSecurity) return null
  const t = await getTranslations('SystemFiling')

  const renderRecord = (record: SystemFilingRecord, label: string) => record.url ? (
    <a className={styles.item} href={record.url} target="_blank" rel="noopener noreferrer" aria-label={`${label}: ${record.number}`}>
      {record.number}
    </a>
  ) : (
    <span className={styles.item} aria-label={`${label}: ${record.number}`}>{record.number}</span>
  )

  return (
    <footer className={styles.root} data-system-filing-footer aria-label={t('label')}>
      <div className={styles.items}>
        {filing.icp ? renderRecord(filing.icp, t('icp')) : null}
        {filing.publicSecurity ? renderRecord(filing.publicSecurity, t('publicSecurity')) : null}
      </div>
    </footer>
  )
}
