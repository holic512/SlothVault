import { ObservabilityView } from '@/components/admin/telemetry/observability-view'
import { getTranslations } from 'next-intl/server'
export async function generateMetadata() { const t = await getTranslations('AdminMM.telemetry'); return { title: t('observability.title') } }
export default function Page() { return <ObservabilityView /> }
