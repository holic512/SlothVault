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
import { PluginConfigEditor } from './plugin-config-editor'
import { useState } from 'react'
import { useMutation, useQuery, useQueryClient } from '@tanstack/react-query'
import { Alert, App, Button, Checkbox, Descriptions, Drawer, Dropdown, Input, Modal, Popconfirm, Space, Spin, Table, Tabs, Tag, Typography } from 'antd'
import { useLocale, useTranslations } from 'next-intl'
import { useSearchParams } from 'next/navigation'
import type { PluginListItem, PluginUpdateInfo } from '@slothvault/plugin-sdk/protocol'
import { AdminPage, AdminPageActions, AdminTablePanel } from './admin-page'
import { apiFetch } from '@/lib/api-client'
import { pluginText, pluginErrorKey } from '@/lib/plugin-presentation'
import styles from '@/styles/modules/plugin-admin.module.css'

type Details = PluginListItem & { config: Record<string, unknown>; configError: string | null; tables: { name: string }[]; operations: { id: number; action: string; phase: string; status: string; error: string | null }[]; tasks: { id: number; handler: string; status: string; attempts: number; error: string | null }[] }
const updateKey = (item: PluginListItem) => ['plugin-update', item.id, item.version, item.source]
const fetchUpdate = (item: PluginListItem) => apiFetch<PluginUpdateInfo>(`/api/admin/mm/plugins/${item.id}/updates`)
function UpdateState({ item }: { item: PluginListItem }) {
  const t = useTranslations('AdminMM.plugins'), locale = useLocale()
  const query = useQuery({ queryKey: updateKey(item), queryFn: () => fetchUpdate(item), enabled: false, retry: false })
  return <div className={styles.version}><span>{item.version}{query.data?.status === 'available' ? ` → ${query.data.release?.version}` : ''}</span>
    {item.installed && <Typography.Text type={query.error ? 'danger' : 'secondary'}>{t(`updateStates.${query.isFetching ? 'checking' : query.error ? 'failed' : query.data?.status ?? 'unchecked'}`)}</Typography.Text>}
    {query.data && <Typography.Text type="secondary" title={new Date(query.data.checkedAt).toLocaleString(locale)}>{t('checkedAt', { time: new Date(query.data.checkedAt).toLocaleTimeString(locale, { hour: '2-digit', minute: '2-digit' }) })}</Typography.Text>}
  </div>
}
export function PluginsManager() {
  const locale = useLocale(), t = useTranslations('AdminMM.plugins'), client = useQueryClient(), { message, modal } = App.useApp()
  const params = useSearchParams()
  const [selection, setSelected] = useState<string | null | undefined>()
  const selected = selection === undefined ? params.get('plugin') : selection
  const [tab, setTab] = useState(params.get('tab') === 'config' ? 'config' : 'overview')
  const [dirty, setDirty] = useState(false)
  const [installOpen, setInstallOpen] = useState(false), [installId, setInstallId] = useState<string | undefined>()
  const [uninstall, setUninstall] = useState<PluginListItem | null>(null), [deleteData, setDeleteData] = useState(false), [confirmId, setConfirmId] = useState('')
  const list = useQuery({ queryKey: ['admin-plugins'], queryFn: () => apiFetch<PluginListItem[]>('/api/admin/mm/plugins'), refetchInterval: 30_000 })
  const catalog = useQuery({ queryKey: ['plugin-catalog'], queryFn: () => apiFetch<{ id: string; name: string; nameZh: string }[]>('/api/admin/mm/plugins/sources') })
  const detail = useQuery({ queryKey: ['admin-plugin', selected], queryFn: () => apiFetch<Details>(`/api/admin/mm/plugins/${selected}`), enabled: !!selected })
  const uninstallDetail = useQuery({ queryKey: ['admin-plugin', uninstall?.id], queryFn: () => apiFetch<Details>(`/api/admin/mm/plugins/${uninstall!.id}`), enabled: !!uninstall })
  const refresh = async () => { await Promise.all([client.invalidateQueries({ queryKey: ['admin-plugins'] }), client.invalidateQueries({ queryKey: ['admin-plugin'] }), client.invalidateQueries({ queryKey: ['plugin-contributions'] }), client.invalidateQueries({ queryKey: ['plugin'] })]) }
  const action = useMutation({ mutationFn: ({ id, ...body }: { id: string; action: string; [key: string]: unknown }) => apiFetch(`/api/admin/mm/plugins/${id}`, { method: 'POST', body: JSON.stringify(body) }), onSuccess: async () => { message.success(t('saved')); setUninstall(null); await refresh() }, onError: error => message.error(t(`errors.${pluginErrorKey(error)}`)) })
  const check = useMutation({ mutationFn: async (items: PluginListItem[]) => {
    const queue = [...items]
    await Promise.all(Array.from({ length: Math.min(3, queue.length) }, async () => {
      for (let item = queue.shift(); item; item = queue.shift()) {
        await client.fetchQuery({ queryKey: updateKey(item), queryFn: () => fetchUpdate(item!), staleTime: 0, retry: false }).catch(() => undefined)
      }
    }))
  } })
  const select = (id: string | null) => {
    const apply = () => { setSelected(id); setTab('config'); setDirty(false) }
    if (dirty) modal.confirm({ title: t('discardDraft'), okText: t('discard'), cancelText: t('keepEditing'), onOk: apply })
    else apply()
  }
  const openInstall = (id?: string) => { setInstallId(id); setInstallOpen(true) }
  const label = (value: string) => t.has(`operationLabels.${value}`) ? t(`operationLabels.${value}`) : t('unknownState')
  return <AdminPage>
    <AdminPageActions><Space wrap><Button loading={check.isPending} disabled={!list.data?.some(item => item.installed)} onClick={() => check.mutate((list.data ?? []).filter(item => item.installed))}>{t('checkUpdates')}</Button><Button onClick={() => void refresh()}>{t('refresh')}</Button><Button type="primary" onClick={() => openInstall()}>{t('install')}</Button></Space></AdminPageActions>
    {list.error && <Alert type="error" title={t(`errors.${pluginErrorKey(list.error)}`)} />}
    <AdminTablePanel><Table<PluginListItem> rowKey="id" loading={list.isPending} dataSource={list.data ?? []} pagination={false} scroll={{ x: 760 }} columns={[
      { title: t('plugin'), render: (_, item) => <><Typography.Text strong>{item.manifest.display ? pluginText(item.manifest, 'name', locale) : catalog.data?.find(entry => entry.id === item.id)?.[locale === 'zh' ? 'nameZh' : 'name'] ?? item.name}</Typography.Text><div><Typography.Text type="secondary">{item.id}</Typography.Text></div></> },
      { title: t('version'), width: 190, render: (_, item) => <UpdateState item={item} /> },
      { title: t('state'), width: 150, render: (_, item) => <Space orientation="vertical" size={2}><Tag color={item.enabled ? 'success' : 'default'}>{t.has(`runtimeLabels.${item.runtime}`) ? t(`runtimeLabels.${item.runtime}`) : t('unknownState')}</Tag>{item.codeState === 'MISSING' && <Tag color="warning">{t('codeLabels.MISSING')}</Tag>}{item.error && <Typography.Text type="danger">{t('errors.generic')}</Typography.Text>}</Space> },
      { title: t('operations'), width: 260, render: (_, item) => <Space wrap size={6}><Button size="small" onClick={() => select(item.id)}>{t('configure')}</Button>{item.installed && <Popconfirm title={item.enabled ? t('disableConfirm') : t('enableConfirm')} onConfirm={() => action.mutateAsync({ id: item.id, action: item.enabled ? 'disable' : 'enable' })}><Button size="small" loading={action.isPending}>{item.enabled ? t('disable') : t('enable')}</Button></Popconfirm>}<UpdateButton item={item} onUpdate={() => openInstall(item.id)} /><Dropdown trigger={['click']} menu={{ items: [
        ...(item.installed ? [{ key: 'check', label: t('checkUpdates'), onClick: () => check.mutate([item]) }, { key: 'manual', label: t('manualUpdate'), onClick: () => openInstall(item.id) }] : []),
        ...(item.error ? [{ key: 'retry', label: t('retry'), onClick: () => action.mutate({ id: item.id, action: 'retry' }) }] : []),
        { key: 'repair', label: t('repair'), onClick: () => openInstall(item.id) },
        { key: 'rollback', label: t('rollback'), disabled: !item.installed, onClick: () => modal.confirm({ title: t('rollback'), content: t('rollbackWarning'), onOk: () => action.mutateAsync({ id: item.id, action: 'rollback' }) }) },
        { key: 'uninstall', label: t('uninstall'), danger: true, onClick: () => { setUninstall(item); setDeleteData(false); setConfirmId('') } },
      ] }}><Button size="small">{t('more')}</Button></Dropdown></Space> },
    ]} /></AdminTablePanel>
    {installOpen && <PluginInstaller installed={list.data ?? []} initialId={installId} onClose={() => setInstallOpen(false)} onInstalled={refresh} />}
    <Drawer size={760} title={detail.data ? pluginText(detail.data.manifest, 'name', locale) : t('details')} open={!!selected} onClose={() => select(null)} destroyOnHidden>
      {detail.isPending && <Spin />}
      {detail.error && <Alert type="error" title={t(`errors.${pluginErrorKey(detail.error)}`)} />}
      {detail.data && !detail.error && <Tabs activeKey={tab} onChange={setTab} items={[
        { key: 'overview', label: t('overview'), children: <div className={styles.details}>
          <Typography.Paragraph>{pluginText(detail.data.manifest, 'description', locale)}</Typography.Paragraph>
          <Descriptions column={1} items={[{ key: 'id', label: t('plugin'), children: detail.data.id }, { key: 'version', label: t('version'), children: detail.data.version }, { key: 'source', label: t('source'), children: detail.data.source ?? t('manual') }, { key: 'data', label: t('data'), children: t('tableCount', { count: detail.data.tables.length }) }]} />
          <details className={styles.technical}><summary>{t('technicalDetails')}</summary><Descriptions column={1} items={[{ key: 'compatibility', label: t('compatibility'), children: `SlothVault ${detail.data.manifest.engines.slothvault} · SDK ${detail.data.manifest.engines.sdk} · Node ${detail.data.manifest.engines.node}` }, { key: 'capabilities', label: t('capabilities'), children: detail.data.manifest.capabilities.join(', ') }, { key: 'dependencies', label: t('dependencies'), children: Object.entries(detail.data.manifest.dependencies).map(([id, range]) => `${id} ${range}`).join(', ') || '—' }, { key: 'tables', label: t('data'), children: detail.data.tables.map(table => table.name).join(', ') || '—' }]} /><pre>{JSON.stringify(detail.data.manifest.configSchema, null, 2)}</pre></details>
        </div> },
        { key: 'config', label: t('configure'), forceRender: true, children: <>{detail.data.configError && <Alert type="warning" title={t('errors.configKeyMismatch')} />}<PluginConfigEditor key={detail.data.id} id={detail.data.id} manifest={detail.data.manifest} config={detail.data.config} installed={detail.data.installed} onSaved={refresh} onDirty={setDirty} /></> },
        { key: 'history', label: t('operationHistory'), children: <div className={styles.details}><Table size="small" rowKey="id" dataSource={detail.data.operations} pagination={{ pageSize: 5 }} scroll={{ x: 480 }} columns={[{ title: t('operations'), dataIndex: 'action', render: label }, { title: t('phase'), dataIndex: 'phase', render: label }, { title: t('state'), dataIndex: 'status', render: label }, { title: t('error'), dataIndex: 'error', render: value => value ? <Typography.Text title={value}>{t('errors.generic')}</Typography.Text> : '—' }]} />{detail.data.tasks.length > 0 && <Table size="small" rowKey="id" dataSource={detail.data.tasks} pagination={{ pageSize: 5 }} columns={[{ title: t('tasks'), dataIndex: 'handler' }, { title: t('state'), dataIndex: 'status', render: label }, { title: t('attempts'), dataIndex: 'attempts' }]} />}</div> },
      ]} />}
    </Drawer>
    <Modal title={t('uninstall')} open={!!uninstall} okText={t('uninstall')} okButtonProps={{ danger: true, disabled: !uninstallDetail.data || (deleteData && confirmId !== uninstall?.id) }} confirmLoading={action.isPending} onCancel={() => setUninstall(null)} onOk={() => uninstall && action.mutate({ id: uninstall.id, action: 'uninstall', deleteData, confirmPluginId: confirmId })}>
      <Space orientation="vertical" style={{ width: '100%' }}><Typography.Paragraph>{t('retainDefault')}</Typography.Paragraph><Typography.Text>{uninstall?.id} · {t('tableCount', { count: uninstall?.retainedTables ?? 0 })}</Typography.Text><Typography.Text code>{uninstallDetail.data?.tables.map(table => table.name).join(', ') || '—'}</Typography.Text>{uninstallDetail.error && <Alert type="error" title={t(`errors.${pluginErrorKey(uninstallDetail.error)}`)} />}<Checkbox checked={deleteData} onChange={e => setDeleteData(e.target.checked)}>{t('deleteData')}</Checkbox>{deleteData && <><Alert type="warning" title={t('deleteWarning')} /><Input placeholder={uninstall?.id} value={confirmId} onChange={e => setConfirmId(e.target.value)} /></>}</Space>
    </Modal>
  </AdminPage>
}
function UpdateButton({ item, onUpdate }: { item: PluginListItem; onUpdate: () => void }) {
  const t = useTranslations('AdminMM.plugins')
  const query = useQuery({ queryKey: updateKey(item), queryFn: () => fetchUpdate(item), enabled: false })
  return query.data?.status === 'available' && !query.error ? <Button size="small" type="primary" onClick={onUpdate}>{t('updateNow')}</Button> : null
}
