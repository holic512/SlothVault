'use client'

import { Button } from 'antd'
import { CircleAlert } from 'lucide-react'
import { useTranslations } from 'next-intl'

export function AccountQueryError({ retry }: { retry: () => void }) {
  const t = useTranslations('Account.shell')
  return (
    <div className="account-query-error" role="alert">
      <CircleAlert size={18} />
      <span>{t('loadFailed')}</span>
      <Button size="small" onClick={retry}>{t('retry')}</Button>
    </div>
  )
}
