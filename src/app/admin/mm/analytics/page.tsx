import { AnalyticsView } from '@/components/admin/telemetry/analytics-view'
import { getTranslations } from 'next-intl/server'

export async function generateMetadata() {
  const t = await getTranslations('AdminMM.telemetry')
  return { title: t('analytics.title') }
}

export default function Page() {
  return <AnalyticsView />
}
