/**
 * @file client.tsx
 * @project SlothVault
 * @module Example Plugin UI
 * @description Uses the host theme and shared components in pages, a banner and an injected modal button.
 * @logic Lazily query the plugin API and render only the requested contribution.
 * @dependencies Plugin client SDK, host React
 * @index_tags plugins,example,ui,slot,modal
 * @author holic512
 */
import { App, Button, Card, Descriptions, Spin, Typography, api, useQuery, PluginI18nProvider, useTranslations, type PluginComponentProps } from '@slothvault/plugin-sdk/client'
const messages = { zh: { ExamplePlugin: { action: '插件操作', title: '扩展示例', error: '暂时无法读取插件信息，请稍后重试。' } }, en: { ExamplePlugin: { action: 'Plugin action', title: 'Extension example', error: 'Unable to load plugin information. Try again later.' } } }
export default function Example(props: PluginComponentProps) {
  return <PluginI18nProvider messages={messages}><ExampleContent {...props} /></PluginI18nProvider>
}
function ExampleContent({ pluginId, componentKey }: PluginComponentProps) {
  const t = useTranslations('ExamplePlugin')
  const { modal } = App.useApp()
  const query = useQuery({ queryKey: ['plugin', pluginId, 'status'], queryFn: () => api<{ message: string; counters: { id: string; value: number }[] }>(pluginId, 'status') })
  if (componentKey === 'article-action') return <Button onClick={() => modal.info({ title: t('action'), content: query.data?.message })}>{t('action')}</Button>
  if (query.isPending) return <Spin size="small" />
  if (query.isError) return <Typography.Text type="danger">{t('error')}</Typography.Text>
  return <Card size="small" title={t('title')}><Typography.Paragraph>{query.data.message}</Typography.Paragraph><Descriptions items={query.data.counters.map(row => ({ key: row.id, label: row.id, children: String(row.value) }))} /></Card>
}
