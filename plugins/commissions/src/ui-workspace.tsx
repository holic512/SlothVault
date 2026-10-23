/**
 * @file ui-workspace.tsx
 * @project SlothVault
 * @module Commission stage workspace
 * @description Shared administrator/customer list, creation and stage-focused detail with files and audit history.
 * @logic Derive actions from server permissions, isolate pending evidence, preserve draft edits, and keep all transport inside the plugin namespace.
 * @dependencies React, plugin client SDK, commissions DTOs, contract editor, evidence controls
 * @index_tags commissions,workspace,stages,files,invitation,maintenance
 * @author holic512
 */
import { useRef, useState } from 'react'
import { Alert, App, Button, Collapse, Descriptions, Empty, Form, Input, InputNumber, PluginMarkdown, PluginPage, PluginTablePanel, PluginToolbar, Progress, Select, Space, Steps, Switch, Table, Tag, Timeline, Typography, Upload, api, useQuery, useQueryClient } from '@slothvault/plugin-sdk/client'
import { API, PLUGIN_ID, STAGES, type AttachmentPurpose, type CommandAction, type CommandResult, type Commission, type CommissionDetail, type UserOption } from './domain'
import { AdminNavigation, ErrorNotice, Loading, Status, actionNames, endpoint, fileUrl, get, pageUrl, post, publicUrl, queryRoot, stageNames, useCommand, useDate, useTemplates, useUnsavedChanges, useUrlValue } from './ui'
import { ContractEditor } from './editor-contract'
import { EvidencePanel } from './ui-evidence'
export function Workspace({ admin }: { admin: boolean }) {
  const commissionId = useUrlValue('commissionId'), templateId = useUrlValue('templateId'), create = useUrlValue('create')
  return <PluginPage className="commissions">{admin && <AdminNavigation current="admin" />}{commissionId ? <DetailPage key={commissionId} id={commissionId} admin={admin} preferredTemplate={templateId} /> : create || templateId ? <CreatePage admin={admin} templateId={templateId} /> : <CommissionList admin={admin} />}</PluginPage>
}
function CommissionList({ admin }: { admin: boolean }) {
  const [search, setSearch] = useState(''), [stage, setStage] = useState(''), date = useDate()
  const query = useQuery({ queryKey: [...queryRoot, 'list', admin], queryFn: () => get<{ list: Commission[] }>(API.list, { scope: admin ? 'admin' : 'mine' }) })
  const rows = (query.data?.list ?? []).filter(item => (!stage || item.stage === stage) && `${item.title} ${item.id}`.toLowerCase().includes(search.toLowerCase()))
  return <><header className="commission-heading"><div><h1>{admin ? '委托列表' : '我的委托'}</h1><p>{admin ? '先看当前阶段，再处理需求、合同与交付。关键节点完成主网存证后生效。' : '提交需求、确认合同、跟进交付与维护。链上存证由管理员办理。'}</p></div><Button type="primary" href={pageUrl(admin, undefined, { create: '1' })}>发起新委托</Button></header>
    <PluginToolbar className="commission-filters"><Input.Search aria-label="搜索委托名称或编号" placeholder="搜索委托名称或编号" allowClear value={search} onChange={event => setSearch(event.target.value)} /><Select aria-label="筛选委托阶段" value={stage} onChange={setStage} options={[{ value: '', label: '全部阶段' }, ...STAGES.map(value => ({ value, label: stageNames[value] }))]} /></PluginToolbar>
    <ErrorNotice error={query.error} retry={() => { void query.refetch() }} />
    <PluginTablePanel><Table<Commission> rowKey="id" loading={query.isPending} dataSource={rows} scroll={{ x: 700 }} pagination={{ pageSize: 12, hideOnSinglePage: true }} locale={{ emptyText: <Empty description={search || stage ? '没有符合条件的委托，请调整筛选条件。' : '还没有委托，从发起一份需求开始。'} /> }} columns={[
      { title: '委托', dataIndex: 'title', render: (_, item) => <div><a href={pageUrl(admin, undefined, { commissionId: item.id })}>{item.title}</a><div className="commission-muted commission-break">{item.id}</div></div> },
      { title: '阶段', dataIndex: 'stage', render: (_, item) => <><Status value={item.stage} />{item.paused && <Tag>已暂停</Tag>}</> },
      { title: '付款比例', dataIndex: 'paymentPercent', render: value => `${value}%` },
      { title: '更新时间', dataIndex: 'updatedAt', render: date },
      { title: '操作', key: 'actions', render: (_, item) => <Button href={pageUrl(admin, undefined, { commissionId: item.id })}>查看当前步骤</Button> },
    ]} /></PluginTablePanel>{admin && <ReceivingSettings />}</>
}
function ReceivingSettings() {
  const { modal } = App.useApp(), cache = useQueryClient(), [busy, setBusy] = useState(false), [error, setError] = useState<unknown>(null)
  const query = useQuery({ queryKey: [...queryRoot, 'settings'], queryFn: () => get<{ acceptingNew: boolean; revision: number }>(API.settings) })
  return <Collapse items={[{ key: 'settings', label: '接单设置', children: <><ErrorNotice error={error || query.error} /><Space wrap><Switch aria-label="接受新委托" checked={query.data?.acceptingNew ?? false} loading={busy || query.isPending} disabled={!query.data} onChange={value => modal.confirm({ title: value ? '恢复接受新委托？' : '暂停接受新委托？', content: '存量委托仍可继续办理，不会停用插件。', okText: '确认', cancelText: '取消', onOk: async () => { setBusy(true); setError(null); try { await post(API.settings, { acceptingNew: value, revision: query.data!.revision, commandId: crypto.randomUUID() }); await cache.invalidateQueries({ queryKey: [...queryRoot, 'settings'] }) } catch (cause) { setError(cause) } finally { setBusy(false) } } })} /><span>{query.data?.acceptingNew ? '正在接受新委托' : '已暂停新委托；存量事务不受影响'}</span></Space></> }]} />
}
function CustomerSelect({ value, onChange }: { value?: number | null; onChange?: (value: number | null) => void }) {
  const [search, setSearch] = useState('')
  const users = useQuery({ queryKey: [...queryRoot, 'users', search], queryFn: () => get<{ list: UserOption[] }>(API.users, { query: search }) })
  return <><Select showSearch={{ onSearch: setSearch, filterOption: false }} aria-label="检索客户账户" allowClear placeholder="选择客户，或稍后通过邀请绑定" loading={users.isFetching} value={value ?? undefined} onChange={value => onChange?.(value ?? null)} options={(users.data?.list ?? []).map(user => ({ value: user.id, label: `${user.displayName || user.username} (@${user.username})` }))} /><ErrorNotice error={users.error} /></>
}
function CreatePage({ admin, templateId }: { admin: boolean; templateId: string }) {
  const [busy, setBusy] = useState(false), [dirty, setDirty] = useState(false), [error, setError] = useState<unknown>(null), [form] = Form.useForm(), id = useRef(crypto.randomUUID()), guard = useUnsavedChanges(dirty), templates = useTemplates()
  return <><header className="commission-heading"><div><h1>发起新委托</h1><p>先保存需求草稿。提交需求后等待管理员主网存证，再进入接单流程。</p></div><Button href={pageUrl(admin)}>返回列表</Button></header><ErrorNotice error={error || templates.error} />
    <Form form={form} layout="vertical" className="commission-form" initialValues={{ title: '', description: '', maintenanceDays: 30, templateId: admin ? templateId || undefined : undefined }} onValuesChange={() => setDirty(true)} scrollToFirstError onFinish={async values => {
      if (busy) return
      setBusy(true); setError(null)
      try { const result = await post<CommandResult>(API.create, { ...values, commandId: id.current, revision: 0 }); guard.markSaved(); setDirty(false); window.location.assign(pageUrl(admin, undefined, { commissionId: result.detail.commission.id, ...(values.templateId ? { templateId: values.templateId } : {}) })) } catch (cause) { setError(cause) } finally { setBusy(false) }
    }}>
      <Form.Item name="title" label="项目名称" rules={[{ required: true, whitespace: true, message: '请填写项目名称' }]}><Input maxLength={200} /></Form.Item>
      <Form.Item name="description" label="需求与预期交付" extra="说明业务目标、服务范围、希望收到的成果和时间要求。附件可在保存草稿后上传。"><Input.TextArea rows={7} maxLength={50000} /></Form.Item>
      {admin && <Form.Item name="customerId" label="客户账户"><CustomerSelect /></Form.Item>}
      <Form.Item name="maintenanceDays" label="交付后的维护天数" rules={[{ required: true }]}><InputNumber min={0} max={3650} precision={0} /></Form.Item>
      {admin && <Form.Item name="templateId" label="合同场景模板（可选）" extra="现在选模板仅用于准备草稿，正式发布仍须满足需求、客户绑定和阶段条件。"><Select allowClear loading={templates.isPending} options={(templates.data?.list ?? []).filter(t => t.kind === 'MAIN').map(t => ({ value: t.id, label: `${t.title} · v${t.version}` }))} /></Form.Item>}
      <footer className="commission-footer"><span>保存草稿不会上链或扣费</span><Button type="primary" htmlType="submit" loading={busy}>保存并进入委托</Button></footer>
    </Form></>
}
export function DetailPage({ id, admin, preferredTemplate }: { id: string; admin: boolean; preferredTemplate?: string }) {
  const query = useQuery({ queryKey: [...queryRoot, 'detail', id], queryFn: () => get<CommissionDetail>(API.detail, { commissionId: id }), refetchInterval: state => state.state.data?.pendingAction ? 8000 : false })
  if (query.isPending) return <Loading />
  if (query.error) return <ErrorNotice error={query.error} retry={() => { void query.refetch() }} />
  if (!query.data) return null
  return <Detail detail={query.data} admin={admin} preferredTemplate={preferredTemplate} />
}
function Detail({ detail, admin, preferredTemplate }: { detail: CommissionDetail; admin: boolean; preferredTemplate?: string }) {
  const { commission: item, pendingAction } = detail, date = useDate(), { modal, message } = App.useApp(), command = useCommand(detail)
  const [editing, setEditing] = useState(false), [composer, setComposer] = useState<CommandAction | null>(null), [invitation, setInvitation] = useState('')
  const allowed = (action: CommandAction) => detail.allowedActions.includes(action)
  const primary: Partial<Record<Commission['stage'], CommandAction>> = { DRAFT: 'submit-request', REQUESTED: 'accept', CONTRACT_PREPARATION: 'save-contract', AWAITING_CONFIRMATION: admin ? 'record-confirmation' : 'confirm-contract', READY: 'start', IN_PROGRESS: 'deliver', MAINTENANCE: admin ? 'maintenance-resolve' : 'maintenance-feedback' }
  const next = item.paused ? 'resume' : primary[item.stage]
  const perform = async (action: CommandAction, data: Record<string, unknown> = {}) => {
    try { const result = await command.run(action, data); if (result.invitationToken) setInvitation(`${window.location.origin}${publicUrl('invitation', { token: result.invitationToken })}`); setComposer(null); message.success(pendingAction ? '操作已记录' : '已提交，当前状态已更新') } catch { /* Inline error retains the user's form. */ }
  }
  const activate = (action: CommandAction) => {
    if (action === 'save-contract') { setEditing(true); return }
    if (['deliver', 'return-request', 'terminate', 'payment', 'comment', 'maintenance-feedback', 'maintenance-resolve', 'record-confirmation', 'confirm-contract', 'decline-contract', 'close-maintenance', 'submit-request'].includes(action)) { setComposer(action); return }
    modal.confirm({ title: `${actionNames[action]}？`, content: action === 'submit-request' ? '当前需求和附件将冻结。管理员完成主网存证后，才进入待接单阶段。' : action === 'withdraw' ? '仅未广播记录可以撤回。撤回后可修改内容并重新提交。' : action === 'start' ? '确认合同已生效且具备启动条件。此操作仅留存审计记录，不额外要求钱包签名。' : '操作将留存记录，请确认继续。', okText: actionNames[action], cancelText: '取消', onOk: () => perform(action, action === 'withdraw' ? { evidenceId: pendingAction?.id } : {}) })
  }
  if (editing) return <ContractEditor detail={detail} preferredTemplate={preferredTemplate} onClose={() => setEditing(false)} />
  return <>
    <header className="commission-heading"><div><h1>{item.title}</h1><Space wrap><Status value={item.stage} />{item.paused && <Tag color="warning">已暂停</Tag>}<Typography.Text type="secondary">{item.id}</Typography.Text></Space></div><Button href={pageUrl(admin)}>返回列表</Button></header>
    <details className="commission-mobile-stages"><summary>当前阶段：{stageNames[item.stage]} · 查看完整流程</summary><ol>{STAGES.filter(stage => stage !== 'TERMINATED').map(stage => <li key={stage} aria-current={stage === item.stage ? 'step' : undefined}>{stageNames[stage]}{stage === item.stage ? '（当前）' : ''}</li>)}</ol></details>
    <nav className="commission-stage-nav" aria-label="委托阶段"><Steps size="small" current={STAGES.indexOf(item.stage)} status={item.stage === 'TERMINATED' ? 'error' : undefined} items={STAGES.filter(stage => stage !== 'TERMINATED').map(stage => ({ title: stageNames[stage] }))} /></nav>
    <section className="commission-current" aria-labelledby="commission-current-heading"><div className="commission-section-heading"><h2 id="commission-current-heading">{pendingAction ? '当前内容已冻结，等待存证生效' : item.stage === 'CLOSED' || item.stage === 'TERMINATED' ? '委托已结束' : next ? actionNames[next] : '当前办理事项'}</h2><span className="commission-muted">当前责任：{detail.nextActor === 'ADMIN' ? '管理员' : detail.nextActor === 'CUSTOMER' ? '客户' : '无需操作'}</span></div>
      <ErrorNotice error={command.error} />
      {detail.blockers.length > 0 && <Alert showIcon type="warning" title="继续前需要处理" description={<ul>{detail.blockers.map(reason => <li key={reason}>{reason}</li>)}</ul>} />}
      {item.paused && <Alert type="info" title="委托已暂停" description="恢复前不能推进业务；已广播交易仍应继续核对。" />}
      {pendingAction ? <EvidencePanel key={pendingAction.id} detail={detail} record={pendingAction} admin={admin} onWithdraw={allowed('withdraw') ? () => activate('withdraw') : undefined} /> : <>
        {item.stage === 'DRAFT' && allowed('update-draft') && !composer ? <DraftForm detail={detail} admin={admin} onSubmitRequest={() => activate('submit-request')} /> : item.description && <section><h3>需求说明</h3><p className="commission-prewrap">{item.description}</p></section>}
        {item.stage === 'AWAITING_CONFIRMATION' && <section><h3>待确认合同</h3>{item.contracts.filter(contract => !contract.effectiveAt).map(contract => <article key={contract.id}><h4>{contract.title} <Tag>{contract.kind === 'MAIN' ? '主合同' : '补充协议'} · v{contract.version}</Tag></h4><PluginMarkdown className="commission-markdown" content={contract.body} /></article>)}<p>客户确认的是合同内容，不是钱包交易。确认记录仍需管理员完成存证后才生效。</p></section>}
        {item.stage === 'MAINTENANCE' && <Alert type="info" title={`维护截止：${date(item.maintenanceEndsAt)}`} description={`正式交付已生效，维护从 ${date(item.maintenanceStartedAt)} 起计时。到期自动关闭，不需管理员额外签名。`} />}
        {composer ? <ActionComposer key={composer} action={composer} detail={detail} busy={command.busy} onCancel={() => setComposer(null)} onSubmit={data => perform(composer, data)} /> : item.stage !== 'DRAFT' && next && allowed(next) && <Button className="commission-main-action" type="primary" disabled={command.busy} onClick={() => activate(next)}>{actionNames[next]}</Button>}
        {!composer && next && !allowed(next) && !['CLOSED', 'TERMINATED'].includes(item.stage) && <p className="commission-muted">{detail.nextActor === 'ADMIN' ? '等待管理员处理当前步骤。' : detail.nextActor === 'CUSTOMER' ? '等待客户确认或补齐材料。' : '请先处理上方阻塞事项。'}</p>}
      </>}
    </section>
    <div className="commission-detail-grid"><section><h2>辅助资料</h2><Collapse items={[
      { key: 'contracts', label: `合同与版本（${item.contracts.length}）`, children: <>{item.contractDraft && <p>已保存合同草稿：{item.contractDraft.title}（尚未发布）</p>}{admin && allowed('save-contract') && <Button onClick={() => setEditing(true)}>{item.contracts.some(c => c.kind === 'MAIN' && c.effectiveAt) ? '准备补充协议' : '准备或继续编辑合同'}</Button>}{!item.contracts.length ? <Empty description="暂无已发布合同；草稿不会替代正式合同版本。" /> : item.contracts.map(contract => <details key={contract.id} className="commission-record"><summary>{contract.title} · {contract.kind === 'MAIN' ? '主合同' : '补充协议'} · v{contract.version} · {contract.effectiveAt ? '已生效' : '待生效'}</summary><p>发布：{date(contract.publishedAt)}；生效：{date(contract.effectiveAt)}</p>{contract.confirmation && <p>客户确认方式：{contract.confirmation.method === 'ONLINE' ? '客户在线确认' : '管理员记录线下确认'}；{date(contract.confirmation.recordedAt)}</p>}<PluginMarkdown className="commission-markdown" content={contract.body} /></details>)}</> },
      { key: 'files', label: `文件与归档（${detail.attachments.length}）`, children: <Files detail={detail} /> },
      { key: 'history', label: `沟通与操作记录（${detail.events.length}）`, children: detail.events.length ? <Timeline items={[...detail.events].reverse().map(event => ({ title: date(event.createdAt), content: <><strong>{actionNames[event.type as CommandAction] ?? event.type}</strong><p className="commission-prewrap">{String(event.payload.text ?? event.payload.reason ?? event.payload.description ?? event.payload.note ?? '')}</p></> }))} /> : <Empty description="暂无操作记录" /> },
      { key: 'evidence', label: `完整存证历史（${detail.evidence.length}）`, children: detail.evidence.length ? detail.evidence.map(record => <EvidencePanel key={record.id} detail={detail} record={record} admin={false} />) : <Empty description="没有正式提交的记录；草稿编辑不需要存证。" /> },
    ]} /></section><aside className="commission-summary"><h2>委托信息</h2><Descriptions size="small" column={1} items={[{ key: 'customer', label: '客户绑定', children: item.customerId ? `账户 #${item.customerId}` : '尚未绑定' }, { key: 'maintenance', label: '维护约定', children: `${item.maintenanceDays} 天` }, { key: 'updated', label: '最近更新', children: date(item.updatedAt) }]} /><h3>付款记录</h3><Progress percent={item.paymentPercent} size="small" /><p className="commission-muted">付款比例独立记录，不自动推进阶段或在结束时补足。</p>
      <Space wrap>{(['invite', 'revoke-invitation', 'decline-contract', 'close-maintenance', 'payment', 'comment', 'return-request', 'pause', 'resume', 'terminate'] as CommandAction[]).filter(action => allowed(action) && action !== next).map(action => <Button key={action} danger={action === 'terminate'} disabled={command.busy} onClick={() => activate(action)}>{actionNames[action]}</Button>)}</Space>
      {invitation && <Alert type="success" title="邀请链接已生成" description={<><p>请仅发送给指定客户。链接含一次性凭证，不会再次展示。</p><Typography.Paragraph className="commission-break" copyable>{invitation}</Typography.Paragraph></>} />}
    </aside></div>
  </>
}
function DraftForm({ detail, admin, onSubmitRequest }: { detail: CommissionDetail; admin: boolean; onSubmitRequest: () => void }) {
  const command = useCommand(detail), [dirty, setDirty] = useState(false), guard = useUnsavedChanges(dirty), { message } = App.useApp()
  return <Form layout="vertical" initialValues={detail.commission} onValuesChange={() => setDirty(true)} onFinish={async values => { try { await command.run('update-draft', values); guard.markSaved(); setDirty(false); message.success('需求草稿已保存') } catch { /* Retain fields. */ } }} scrollToFirstError>
    <ErrorNotice error={command.error} /><Form.Item name="title" label="项目名称" rules={[{ required: true, whitespace: true }]}><Input maxLength={200} /></Form.Item><Form.Item name="description" label="需求与预期交付"><Input.TextArea rows={6} maxLength={50000} /></Form.Item>
    {admin && <Form.Item name="customerId" label="客户账户"><CustomerSelect /></Form.Item>}<Form.Item name="maintenanceDays" label="维护天数"><InputNumber min={0} max={3650} precision={0} /></Form.Item>
    <Space wrap><Button htmlType="submit" loading={command.busy}>保存需求草稿</Button>{detail.allowedActions.includes('submit-request') && <Button type="primary" disabled={dirty || command.busy} onClick={onSubmitRequest}>提交需求，等待存证</Button>}</Space>{dirty && <p role="status" className="commission-muted">请先保存修改，再提交需求。离开前会提醒你保留草稿。</p>}
  </Form>
}
function ActionComposer({ action, detail, busy, onCancel, onSubmit }: { action: CommandAction; detail: CommissionDetail; busy: boolean; onCancel: () => void; onSubmit: (data: Record<string, unknown>) => Promise<void> }) {
  const [dirty, setDirty] = useState(false), guard = useUnsavedChanges(dirty)
  const confirmation = action === 'confirm-contract' || action === 'record-confirmation'
  const contracts = detail.commission.contracts.filter(contract => !contract.effectiveAt && !contract.rejectedAt && !contract.confirmation)
  return <Form layout="vertical" className="commission-action-form" initialValues={{ percent: detail.commission.paymentPercent, contractId: contracts.at(-1)?.id, fileIds: [] }} onValuesChange={() => setDirty(true)} onFinish={async values => { await onSubmit(values) }} scrollToFirstError>
    <h3>{actionNames[action]}</h3>
    {action === 'submit-request' ? <><Alert type="info" title="提交后冻结当前需求，等待管理员存证" description="请核对已保存的需求与本次需要提交的附件。未选附件不会被纳入此次冻结记录。" /><Form.Item name="fileIds" label="需求附件（可选）"><Select mode="multiple" options={detail.attachments.filter(file => file.purpose === 'request').map(file => ({ value: file.id, label: file.name }))} /></Form.Item></> : action === 'decline-contract' ? <><Form.Item name="contractId" label="需要修改的合同" rules={[{ required: true }]}><Select options={contracts.map(contract => ({ value: contract.id, label: `${contract.title} · v${contract.version}` }))} /></Form.Item><Form.Item name="reason" label="修改意见与原因" rules={[{ required: true, whitespace: true }]}><Input.TextArea rows={5} /></Form.Item></> : action === 'deliver' ? <><Alert type="info" title="正式交付完成主网存证后，立即进入维护" description="不增加客户验收环节。请确认文件完整，维护期限将从交付实际生效时开始。" /><Form.Item name="description" label="交付说明与使用指引" rules={[{ required: true, whitespace: true }]}><Input.TextArea rows={5} /></Form.Item><Form.Item name="fileIds" label="正式交付文件" rules={[{ required: true, type: 'array', min: 1, message: '请至少选择一个已上传的交付文件' }]}><Select mode="multiple" options={detail.attachments.filter(file => file.purpose === 'delivery').map(file => ({ value: file.id, label: file.name }))} /></Form.Item><p>需要更多文件？先在下方“文件与归档”上传交付文件，再选择。</p></> : confirmation ? <><Form.Item name="contractId" label="确认的合同版本" rules={[{ required: true }]}><Select options={contracts.map(contract => ({ value: contract.id, label: `${contract.title} · v${contract.version}` }))} /></Form.Item><Form.Item name="note" label={action === 'record-confirmation' ? '线下确认依据（时间、渠道与确认内容）' : '确认说明（可选）'} rules={action === 'record-confirmation' ? [{ required: true, whitespace: true }] : []}><Input.TextArea rows={4} /></Form.Item><Alert type="info" title="确认记录将冻结，存证完成后合同才在系统内生效" description="本操作不是客户钱包签署；链上签名由管理员完成。" /></> : <>{action === 'payment' && <Form.Item name="percent" label="已付比例（%）" rules={[{ required: true }]}><InputNumber min={0} max={100} precision={0} /></Form.Item>}<Form.Item name={['return-request', 'terminate', 'payment', 'close-maintenance'].includes(action) ? 'reason' : 'text'} label={['return-request', 'terminate', 'payment', 'close-maintenance'].includes(action) ? '原因与依据' : '具体内容'} rules={[{ required: true, whitespace: true }]}><Input.TextArea rows={5} maxLength={50000} /></Form.Item></>}
    <Space wrap><Button disabled={busy} onClick={() => { void guard.confirmLeave().then(ok => { if (ok) onCancel() }) }}>取消</Button><Button type="primary" danger={action === 'terminate'} htmlType="submit" loading={busy}>{actionNames[action]}{action === 'deliver' || action === 'submit-request' || confirmation ? '，等待存证' : ''}</Button></Space>
  </Form>
}
function Files({ detail }: { detail: CommissionDetail }) {
  const cache = useQueryClient(), [uploading, setUploading] = useState(false), [error, setError] = useState<unknown>(null)
  const stage = detail.commission.stage
  const [purpose, setPurpose] = useState<AttachmentPurpose>(stage === 'IN_PROGRESS' ? 'delivery' : stage === 'MAINTENANCE' ? 'maintenance' : stage === 'DRAFT' ? 'request' : 'contract')
  const labels: Record<AttachmentPurpose, string> = { request: '需求附件', contract: '合同附件', delivery: '交付文件', maintenance: '维护材料' }
  return <div className="commission-files"><ErrorNotice error={error} /><Space wrap><Select aria-label="上传文件用途" value={purpose} onChange={setPurpose} disabled={uploading} options={Object.entries(labels).map(([value, label]) => ({ value, label }))} /><Upload showUploadList={false} multiple={false} disabled={uploading || !!detail.pendingAction || ['CLOSED', 'TERMINATED'].includes(stage)} beforeUpload={async file => {
    setUploading(true); setError(null)
    try { await api(PLUGIN_ID, endpoint(API.upload, { commissionId: detail.commission.id, purpose, revision: detail.commission.revision, commandId: crypto.randomUUID() }), { method: 'POST', body: file, headers: { 'Content-Type': 'application/octet-stream', 'X-File-Name': encodeURIComponent(file.name), 'X-File-Size': String(file.size) } }); await cache.invalidateQueries({ queryKey: queryRoot }) } catch (cause) { setError(cause) } finally { setUploading(false) }
    return false
  }}><Button loading={uploading} disabled={!!detail.pendingAction || ['CLOSED', 'TERMINATED'].includes(stage)}>上传私有文件</Button></Upload><Button href={fileUrl(API.archive, { commissionId: detail.commission.id })} download>下载完整归档</Button></Space><p className="commission-muted">上传本身不触发存证。正式提交后，文件摘要随记录冻结；公开回执不会披露文件内容。</p>
    {detail.attachments.length ? <ul className="commission-file-list">{detail.attachments.map(file => <li key={file.id}><div><a href={fileUrl(API.download, { commissionId: detail.commission.id, fileId: file.id })} download>{file.name}</a><span className="commission-muted">{labels[file.purpose]} · {Number(file.size).toLocaleString()} 字节</span></div><details><summary>文件摘要</summary><code>{file.sha256}</code></details></li>)}</ul> : <Empty description="尚未上传文件" />}
  </div>
}
