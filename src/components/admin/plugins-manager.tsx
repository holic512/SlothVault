'use client'
/**
 * @file plugins-manager.tsx
 * @project SlothVault
 * @module Plugin Administration
 * @description Manages independently released packages, explicit code trust, configuration, lifecycle and optional data removal.
 * @logic Preview unexecuted packages before confirmation, distinguish code/installation/runtime state, and default uninstall to retaining tables.
 * @dependencies Ant Design, React Query, existing admin primitives, plugin management APIs
 * @index_tags plugins,admin,installation,configuration,uninstall
 * @author holic512
 */
import { PluginInstaller } from './plugin-installer'
import { useState } from 'react'
import { useMutation, useQuery, useQueryClient } from '@tanstack/react-query'
import { Alert, App, Button, Checkbox, Descriptions, Form, Input, Modal, Popconfirm, Space, Spin, Table, Tag, Typography } from 'antd'
import { useLocale, useTranslations } from 'next-intl'
import type { PluginListItem } from '@slothvault/plugin-sdk/protocol'
import { AdminPage, AdminPageActions, AdminTablePanel } from './admin-page'
import { apiFetch } from '@/lib/api-client'
type Details = PluginListItem & { config: Record<string, unknown>; configError: string | null; tables: { name: string }[]; operations: { id: number; action: string; phase: string; status: string; error: string | null }[]; tasks: { id: number; handler: string; status: string; attempts: number; error: string | null }[] }
export function PluginsManager() {
  const locale = useLocale()
  const catalog = useQuery({ queryKey: ['plugin-catalog'], queryFn: () => apiFetch<{ id: string; name: string; nameZh: string }[]>('/api/admin/mm/plugins/sources') })
  const t = useTranslations('AdminMM.plugins'), client = useQueryClient(), { message } = App.useApp()
  const [installOpen, setInstallOpen] = useState(false), [installId, setInstallId] = useState<string | undefined>()
  const [selected, setSelected] = useState<string | null>(null), [uninstall, setUninstall] = useState<PluginListItem | null>(null), [deleteData, setDeleteData] = useState(false), [confirmId, setConfirmId] = useState('')
  const list = useQuery({ queryKey: ['admin-plugins'], queryFn: () => apiFetch<PluginListItem[]>('/api/admin/mm/plugins'), refetchInterval: 30_000 })
  const detail = useQuery({ queryKey: ['admin-plugin', selected], queryFn: () => apiFetch<Details>(`/api/admin/mm/plugins/${selected}`), enabled: !!selected })
  const uninstallDetail = useQuery({ queryKey: ['admin-plugin', uninstall?.id], queryFn: () => apiFetch<Details>(`/api/admin/mm/plugins/${uninstall!.id}`), enabled: !!uninstall })
  const refresh = async () => { await Promise.all([client.invalidateQueries({ queryKey: ['admin-plugins'] }), client.invalidateQueries({ queryKey: ['admin-plugin'] }), client.invalidateQueries({ queryKey: ['plugin-contributions'] }), client.invalidateQueries({ queryKey: ['plugin'] })]) }
  const action = useMutation({ mutationFn: ({ id, ...body }: { id: string; action: string; [key: string]: unknown }) => apiFetch(`/api/admin/mm/plugins/${id}`, { method: 'POST', body: JSON.stringify(body) }), onSuccess: async () => { message.success(t('saved')); setInstallOpen(false); setUninstall(null); await refresh() }, onError: error => message.error(error.message) })
  return <AdminPage>
    <AdminPageActions><Space><Button onClick={() => void refresh()}>{t('refresh')}</Button><Button type="primary" onClick={() => { setInstallId(undefined); setInstallOpen(true) }}>{t('install')}</Button></Space></AdminPageActions>
    <Typography.Paragraph type="secondary">{t('architecture')}</Typography.Paragraph>
    {list.error && <Alert type="error" title={list.error.message} />}
    <AdminTablePanel><Table<PluginListItem> rowKey="id" loading={list.isPending} dataSource={list.data ?? []} pagination={false} scroll={{ x: 900 }} columns={[
      { title: t('plugin'), dataIndex: 'name', render: (name, item) => <><Typography.Text strong>{catalog.data?.find(entry => entry.id === item.id)?.[locale === 'zh' ? 'nameZh' : 'name'] ?? name}</Typography.Text><div><Typography.Text type="secondary">{item.id}</Typography.Text></div></> },
      { title: t('version'), dataIndex: 'version', width: 100 },
      { title: t('state'), render: (_, item) => <Space orientation="vertical" size={2}><Tag color={item.enabled ? 'success' : 'default'}>{t.has(`runtimeLabels.${item.runtime}`) ? t(`runtimeLabels.${item.runtime}`) : item.runtime}</Tag><Tag color={item.codeState === 'MISSING' ? 'warning' : 'default'}>{t(`codeLabels.${item.codeState}`)}</Tag>{item.error && <Typography.Text type="danger">{item.error}</Typography.Text>}</Space> },
      { title: t('data'), render: (_, item) => t('tableCount', { count: item.retainedTables }), width: 120 },
      { title: t('operations'), width: 360, render: (_, item) => <Space wrap><Button size="small" onClick={() => setSelected(item.id)}>{t('details')}</Button>{item.error && <Button size="small" onClick={() => action.mutate({ id: item.id, action: 'retry' })}>{t('retry')}</Button>}{item.installed && <Popconfirm title={item.enabled ? t('disableConfirm') : t('enableConfirm')} onConfirm={() => action.mutateAsync({ id: item.id, action: item.enabled ? 'disable' : 'enable' })}><Button size="small" loading={action.isPending}>{item.enabled ? t('disable') : t('enable')}</Button></Popconfirm>}<Button size="small" onClick={() => { setInstallId(item.id); setInstallOpen(true) }}>{t('update')}</Button><Button size="small" danger onClick={() => { setUninstall(item); setDeleteData(false); setConfirmId('') }}>{t('uninstall')}</Button></Space> },
    ]} /></AdminTablePanel>
    {installOpen && <PluginInstaller installed={list.data ?? []} initialId={installId} onClose={() => setInstallOpen(false)} onInstalled={refresh} />}
    <Modal width={820} title={t('details')} open={!!selected} onCancel={() => setSelected(null)} footer={null} destroyOnHidden>
      {detail.isPending && <Spin />}
      {detail.error && <Alert type="error" title={detail.error.message} />}
      {detail.data && !detail.error && <Space orientation="vertical" style={{ width: '100%' }}>
        <Descriptions column={1} items={[{ key: 'id', label: t('plugin'), children: detail.data.id }, { key: 'version', label: t('version'), children: detail.data.version }, { key: 'compatibility', label: t('compatibility'), children: `SlothVault ${detail.data.manifest.engines.slothvault} · SDK ${detail.data.manifest.engines.sdk} · Node ${detail.data.manifest.engines.node}` }, { key: 'dependencies', label: t('dependencies'), children: Object.entries(detail.data.manifest.dependencies).map(([id, range]) => `${id} ${range}`).join(', ') || '—' }, { key: 'capabilities', label: t('capabilities'), children: detail.data.manifest.capabilities.join(', ') || '—' }, { key: 'desc', label: t('description'), children: detail.data.description }, { key: 'source', label: t('source'), children: detail.data.source ?? t('manual') }, { key: 'tables', label: t('data'), children: detail.data.tables.map(t => t.name).join(', ') || '—' }]} />
        {detail.data.configError && <Alert type="warning" title={detail.data.configError} />}
        <PluginConfigEditor key={`${detail.data.id}:${detail.data.generation}`} detail={detail.data} onSaved={refresh} />
        <Popconfirm title={t('rollbackWarning')} onConfirm={() => action.mutateAsync({ id: detail.data!.id, action: 'rollback' })}>
          <Button disabled={!detail.data.installed} loading={action.isPending}>{t('rollback')}</Button>
        </Popconfirm>
        <Typography.Text type="secondary">{t('schemaNote')}</Typography.Text><details><summary>JSON Schema</summary><pre>{JSON.stringify(detail.data.manifest.configSchema, null, 2)}</pre></details>
        <Table size="small" rowKey="id" dataSource={detail.data.operations} pagination={{ pageSize: 5 }} columns={[{ title: t('operations'), dataIndex: 'action' }, { title: t('phase'), dataIndex: 'phase' }, { title: t('state'), dataIndex: 'status' }, { title: t('error'), dataIndex: 'error' }]} />
        <Table size="small" rowKey="id" dataSource={detail.data.tasks} pagination={{ pageSize: 5 }} columns={[{ title: t('tasks'), dataIndex: 'handler' }, { title: t('state'), dataIndex: 'status' }, { title: t('attempts'), dataIndex: 'attempts' }, { title: t('error'), dataIndex: 'error' }]} />
      </Space>}
    </Modal>
    <Modal title={t('uninstall')} open={!!uninstall} okText={t('uninstall')} okButtonProps={{ danger: true, disabled: !uninstallDetail.data || (deleteData && confirmId !== uninstall?.id) }} confirmLoading={action.isPending} onCancel={() => setUninstall(null)} onOk={() => uninstall && action.mutate({ id: uninstall.id, action: 'uninstall', deleteData, confirmPluginId: confirmId })}>
      <Space orientation="vertical" style={{ width: '100%' }}><Typography.Paragraph>{t('retainDefault')}</Typography.Paragraph><Typography.Text>{uninstall?.id} · {t('tableCount', { count: uninstall?.retainedTables ?? 0 })}</Typography.Text><Typography.Text code>{uninstallDetail.data?.tables.map(table => table.name).join(', ') || '—'}</Typography.Text>{uninstallDetail.error && <Alert type="error" title={uninstallDetail.error.message} />}<Checkbox checked={deleteData} onChange={e => setDeleteData(e.target.checked)}>{t('deleteData')}</Checkbox>{deleteData && <><Alert type="warning" title={t('deleteWarning')} /><Input placeholder={uninstall?.id} value={confirmId} onChange={e => setConfirmId(e.target.value)} /></>}</Space>
    </Modal>
  </AdminPage>
}

// Keep the draft and save target together: a slow response for plugin A must
// never populate plugin B's editor after the administrator changes selection.
function PluginConfigEditor({ detail, onSaved }: { detail: Details; onSaved: () => Promise<void> }) {
  const t = useTranslations('AdminMM.plugins')
  const { message } = App.useApp()
  const [config, setConfig] = useState(() => JSON.stringify(detail.config, null, 2))
  const save = useMutation({
    mutationFn: (text: string) => apiFetch(`/api/admin/mm/plugins/${detail.id}`, {
      method: 'PATCH', body: JSON.stringify({ config: JSON.parse(text) }),
    }),
    onSuccess: async () => { message.success(t('saved')); await onSaved() },
    onError: error => message.error(error.message),
  })
  return <Form layout="vertical" onFinish={() => save.mutate(config)}>
    <Form.Item label={t('config')}>
      <Input.TextArea rows={8} value={config} onChange={event => setConfig(event.target.value)} spellCheck={false} disabled={save.isPending} />
    </Form.Item>
    <Button htmlType="submit" loading={save.isPending} disabled={!detail.installed}>{t('saveConfig')}</Button>
  </Form>
}
