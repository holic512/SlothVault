/**
 * @file ui.tsx
 * @project SlothVault
 * @module Commission UI infrastructure
 * @description Shared plugin-only transport, status presentation and draft navigation protection.
 * @logic Keep command identities stable across retries, invalidate authoritative detail after writes, and guard unsaved navigation.
 * @dependencies React, plugin client SDK, commissions domain
 * @index_tags commissions,ui,commands,drafts
 * @author holic512
 */
import { useCallback, useEffect, useLayoutEffect, useRef, useState } from 'react'
import { Alert, App, Button, Space, Spin, Tag, api, useQuery, useQueryClient, useLocale, formatAdminDate } from '@slothvault/plugin-sdk/client'
import { API, PLUGIN_ID, type CommandAction, type CommandResult, type CommissionDetail, type CommissionStage, type ContractTemplate, type EvidenceStatus } from './domain'
export const queryRoot = ['commissions'] as const
export const stageNames: Record<CommissionStage, string> = { DRAFT: '草稿', REQUESTED: '待接单', CONTRACT_PREPARATION: '合同准备', AWAITING_CONFIRMATION: '待客户确认', READY: '待启动', IN_PROGRESS: '实施中', MAINTENANCE: '维护中', CLOSED: '已结束', TERMINATED: '已终止' }
export const evidenceNames: Record<EvidenceStatus, string> = { AWAITING_ADMIN: '待管理员办理', PREPARED: '待钱包签名', SUBMITTED: '链上确认中', FINALIZED: '已完成', FAILED: '失败待处理', EXPIRED: '交易已过期', WITHDRAWN: '已撤回' }
export const kindNames = { REQUEST: '需求提交', CONTRACT: '合同发布', CONFIRMATION: '客户确认记录', DELIVERY: '正式交付' }
export const actionNames: Record<CommandAction, string> = { 'update-draft': '编辑需求', 'submit-request': '提交需求', accept: '接单并准备合同', 'return-request': '退回补充', 'save-contract': '准备合同', 'publish-contract': '发布合同', 'confirm-contract': '确认合同内容', 'record-confirmation': '记录线下确认', start: '启动实施', deliver: '正式交付', pause: '暂停委托', resume: '恢复委托', terminate: '终止委托', payment: '更新付款比例', comment: '记录沟通', 'maintenance-feedback': '提交维护反馈', 'maintenance-resolve': '记录维护处理', withdraw: '撤回待生效记录', invite: '邀请客户认领', 'revoke-invitation': '撤销邀请', 'decline-contract': '退回合同修改', 'close-maintenance': '提前结束维护' }
import { endpoint, pageUrl, errorText } from './presentation'
export { endpoint, pageUrl } from './presentation'
export const get = <T,>(path: string, params?: Record<string, string | number | undefined>) => api<T>(PLUGIN_ID, endpoint(path, params))
export const post = <T,>(path: string, body: unknown) => api<T>(PLUGIN_ID, path, { method: 'POST', body: JSON.stringify(body) })
export const fileUrl = (path: string, params: Record<string, string>) => `/api/plugins/${PLUGIN_ID}/${endpoint(path, params)}`

export const publicUrl = (page: 'invitation' | 'receipt', params: Record<string, string>) => endpoint(`/extensions/${PLUGIN_ID}/${page}`, params)
export function useUrlValue(name: string) {
  const [value, setValue] = useState('')
  useEffect(() => { const read = () => setValue(new URL(window.location.href).searchParams.get(name) ?? ''); read(); window.addEventListener('popstate', read); return () => window.removeEventListener('popstate', read) }, [name])
  return value
}
export function useTemplates(templateId?: string) { return useQuery({ queryKey: [...queryRoot, 'templates', templateId], queryFn: () => get<{ list: ContractTemplate[] }>(API.templates, { templateId }) }) }
export function useDate() { const locale = useLocale(); return (value: string | null | undefined) => formatAdminDate(locale, value) }
export function Status({ value, evidence = false }: { value: CommissionStage | EvidenceStatus; evidence?: boolean }) {
  return <Tag color={value === 'FINALIZED' || value === 'CLOSED' ? 'success' : value === 'FAILED' || value === 'TERMINATED' ? 'error' : value === 'SUBMITTED' || value === 'PREPARED' ? 'processing' : undefined}>{evidence ? evidenceNames[value as EvidenceStatus] : stageNames[value as CommissionStage]}</Tag>
}
export function ErrorNotice({ error, retry }: { error: unknown; retry?: () => void }) {
  if (!error) return null
  return <Alert type="error" showIcon title="操作未完成" description={errorText(error)} action={retry ? <Button onClick={retry}>重试</Button> : undefined} />
}
export function Loading() { return <div className="commission-loading" role="status"><Spin /><span>正在加载委托内容…</span></div> }
export function AdminNavigation({ current }: { current: string }) {
  return <nav aria-label="委托管理"><Space wrap>{[['admin', '委托列表'], ['templates', '模板库'], ['evidence', '存证待办']].map(([key, label]) => <Button key={key} href={pageUrl(true, key)} type={current === key ? 'default' : 'text'} aria-current={current === key ? 'page' : undefined}>{label}</Button>)}</Space></nav>
}
export function useCommand(detail: CommissionDetail) {
  const cache = useQueryClient(), [busy, setBusy] = useState(false), [error, setError] = useState<unknown>(null), identity = useRef(new Map<string, string>()), lock = useRef(false)
  const run = async (action: CommandAction, data: Record<string, unknown> = {}) => {
    if (lock.current) throw new Error('上一项操作仍在处理中，请稍候。')
    lock.current = true; setBusy(true); setError(null)
    const current = cache.getQueryData<CommissionDetail>([...queryRoot, 'detail', detail.commission.id]) ?? detail
    const key = JSON.stringify([current.commission.id, current.commission.revision, action, data])
    const commandId = identity.current.get(key) ?? crypto.randomUUID(); identity.current.set(key, commandId)
    try {
      const result = await post<CommandResult>(API.command, { commissionId: detail.commission.id, revision: current.commission.revision, commandId, action, data })
      cache.setQueryData([...queryRoot, 'detail', detail.commission.id], result.detail)
      await cache.invalidateQueries({ queryKey: queryRoot }); identity.current.delete(key)
      return result
    } catch (cause) { setError(cause); throw cause } finally { lock.current = false; setBusy(false) }
  }
  return { run, busy, error }
}
export function useUnsavedChanges(dirty: boolean) {
  const { modal } = App.useApp(), latest = useRef(dirty)
  useLayoutEffect(() => { latest.current = dirty }, [dirty])
  const confirmLeave = useCallback(() => !latest.current ? Promise.resolve(true) : new Promise<boolean>(resolve => {
    modal.confirm({ title: '离开并放弃未保存的修改？', content: '已保存的草稿会保留；本次尚未保存的修改将丢失。', okText: '放弃修改', cancelText: '继续编辑', onOk: () => { latest.current = false; resolve(true) }, onCancel: () => resolve(false) })
  }), [modal])
  useEffect(() => {
    if (!dirty) return
    const previous = { href: window.location.href, state: window.history.state }
    const unload = (event: BeforeUnloadEvent) => { if (latest.current) { event.preventDefault(); event.returnValue = '' } }
    const click = (event: MouseEvent) => {
      const anchor = event.target instanceof Element ? event.target.closest('a[href]') as HTMLAnchorElement | null : null
      if (!latest.current || !anchor || anchor.target === '_blank' || anchor.hasAttribute('download') || event.ctrlKey || event.metaKey || event.shiftKey || event.altKey || event.button !== 0) return
      const url = new URL(anchor.href, window.location.href)
      if (url.href === window.location.href || (url.pathname === window.location.pathname && url.search === window.location.search && url.hash)) return
      event.preventDefault(); event.stopImmediatePropagation(); void confirmLeave().then(ok => { if (ok) window.location.assign(url.href) })
    }
    const back = (event: PopStateEvent) => {
      if (!latest.current) return
      const destination = window.location.href
      event.stopImmediatePropagation(); window.history.pushState(previous.state, '', previous.href)
      void confirmLeave().then(ok => { if (ok) window.location.assign(destination) })
    }
    window.addEventListener('beforeunload', unload); document.addEventListener('click', click, true); window.addEventListener('popstate', back, true)
    return () => { window.removeEventListener('beforeunload', unload); document.removeEventListener('click', click, true); window.removeEventListener('popstate', back, true) }
  }, [dirty, confirmLeave])
  return { confirmLeave, markSaved: () => { latest.current = false } }
}
