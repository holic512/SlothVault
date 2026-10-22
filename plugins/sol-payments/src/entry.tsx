import { Button, PluginI18nProvider, useRouter } from '@slothvault/plugin-sdk/client'
import { ID, useCopy } from './ui'
import { messages } from './messages'
export default function Entry() {
  return <PluginI18nProvider messages={messages}><PurchaseEntry /></PluginI18nProvider>
}
function PurchaseEntry() {
  const c = useCopy(), router = useRouter()
  return <Button onClick={() => router.push(`/account/extensions/${ID}/purchase`)}>{c.title}</Button>
}
