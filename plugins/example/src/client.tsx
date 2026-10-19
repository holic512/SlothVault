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
import { App, Button, Card, Descriptions, Spin, Typography, api, useQuery, type PluginComponentProps } from '@slothvault/plugin-sdk/client'
export default function Example({ pluginId, componentKey }: PluginComponentProps) {
  const { modal } = App.useApp()
  const query = useQuery({ queryKey: ['plugin', pluginId, 'status'], queryFn: () => api<{ message: string; counters: { id: string; value: number }[] }>(pluginId, 'status') })
  if (componentKey === 'article-action') return <Button onClick={() => modal.info({ title: 'Plugin action', content: query.data?.message })}>Plugin action</Button>
  if (query.isPending) return <Spin size="small" />
  if (query.isError) return <Typography.Text type="danger">{query.error.message}</Typography.Text>
  return <Card size="small" title="Extension example"><Typography.Paragraph>{query.data.message}</Typography.Paragraph><Descriptions items={query.data.counters.map(row => ({ key: row.id, label: row.id, children: String(row.value) }))} /></Card>
}
