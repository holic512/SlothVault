'use client'
/**
 * @file template-manager.tsx
 * @project SlothVault
 * @module Contract Template Administration
 * @description Edits legal document bodies, typed fields, choices, repeated rows, defaults, and provider/calendar presets.
 * @logic Clone published definitions into new drafts, preview deterministic output, and publish immutable versions after explicit review.
 * @dependencies Ant Design, template APIs, restricted template renderer
 * @index_tags templates,versions,editor,calendar,commissions
 * @author holic512
 */
import { useState } from 'react'
import { useMutation, useQuery, useQueryClient } from '@tanstack/react-query'
import { Alert, App, Button, Card, Drawer, Form, Input, List, Modal, Select, Space, Tabs, Tag } from 'antd'
import { apiFetch } from '@/lib/api-client'
import { renderContractDocument } from '@/lib/contract-template'
import { MarkdownView } from '@/components/markdown/markdown-view'
import { TemplateFields } from './template-fields'
import type { TemplateDto, TemplateField, TemplateVersionDto } from '@/types/commissions'
import type { CommissionDocumentType, WorkingCalendar } from '@/lib/commissions'
import styles from '@/styles/modules/commissions.module.css'

const kinds = { AGREEMENT: '正文与附件一', CHANGE: '附件二：变更确认单', ACCEPTANCE: '附件三：验收确认单' } as const
const bodies = { AGREEMENT: '合同正文', REQUIREMENTS: '附件一', CHANGE: '附件二', ACCEPTANCE: '附件三' } as const
const types: TemplateField['type'][] = ['text', 'multiline', 'date', 'money', 'number', 'select', 'multiselect', 'boolean', 'rows']
const typeNames = ['文本', '多行文本', '日期', '金额', '数字', '单选', '多选', '勾选', '重复表格']
function FieldEditor({ fields, onChange }: { fields: TemplateField[]; onChange: (fields: TemplateField[]) => void }) {
  const [editing, setEditing] = useState<{ index: number; value: TemplateField } | null>(null)
  const update = (value: Partial<TemplateField>) => setEditing((e) => e && ({ ...e, value: { ...e.value, ...value } }))
  return <>
    <Button onClick={() => setEditing({ index: fields.length, value: { key: '', label: '', type: 'text', documents: ['AGREEMENT'] } })}>添加字段</Button>
    <List dataSource={fields} renderItem={(f, index) => <List.Item actions={[<Button key="edit" onClick={() => setEditing({ index, value: structuredClone(f) })}>编辑</Button>, <Button key="delete" danger onClick={() => onChange(fields.filter((_, i) => i !== index))}>移除</Button>]}><List.Item.Meta title={`${f.label} · ${f.key}`} description={`${typeNames[types.indexOf(f.type)]}${f.required ? '，必填' : ''}；插入语法：{{${f.key}}}`} /></List.Item>} />
    <Modal title="字段与选项" open={Boolean(editing)} width={760} okText="保存字段" cancelText="返回" onCancel={() => setEditing(null)} onOk={() => { if (!editing?.value.key.trim() || !editing.value.label.trim()) return; onChange(fields.map((f, i) => i === editing.index ? editing.value : f).concat(editing.index === fields.length ? [editing.value] : [])); setEditing(null) }}>
      {editing ? <Space orientation="vertical" style={{ width: '100%' }}>
        <label>变量名<Input value={editing.value.key} onChange={(e) => update({ key: e.target.value })} placeholder="例如 projectName，只能使用字母、数字和下划线" /></label>
        <label>填写标签<Input value={editing.value.label} onChange={(e) => update({ label: e.target.value })} /></label>
        <Select style={{ width: '100%' }} value={editing.value.type} options={types.map((value, i) => ({ value, label: typeNames[i] }))} onChange={(type) => update({ type, ...(type === 'rows' ? { fields: editing.value.fields || [] } : {}), ...(['select', 'multiselect'].includes(type) ? { options: editing.value.options || [] } : {}) })} />
        <Select style={{ width: '100%' }} value={editing.value.required ? 'yes' : 'no'} options={[{ value: 'yes', label: '必填' }, { value: 'no', label: '可选' }]} onChange={(v) => update({ required: v === 'yes' })} />
        <Select<CommissionDocumentType[]> style={{ width: '100%' }} mode="multiple" value={editing.value.documents || ['AGREEMENT', 'CHANGE', 'ACCEPTANCE']} options={Object.entries(kinds).map(([value, label]) => ({ value, label }))} onChange={(documents) => update({ documents })} />
        <label>填写提示<Input value={editing.value.help} onChange={(e) => update({ help: e.target.value })} /></label>
        {['select', 'multiselect'].includes(editing.value.type) ? <label>选项（每行：值 | 显示文字）<Input.TextArea rows={5} value={editing.value.options?.map((o) => `${o.value} | ${o.label}`).join('\n')} onChange={(e) => update({ options: e.target.value.split('\n').filter(Boolean).map((line) => { const [value, ...labels] = line.split('|'); return { value: value.trim(), label: labels.join('|').trim() || value.trim() } }) })} /></label> : null}
        <label>条件显示（可选：变量名 | 值）<Input value={editing.value.when ? `${editing.value.when.key} | ${editing.value.when.value}` : ''} onChange={(e) => { const [key, value] = e.target.value.split('|').map((s) => s.trim()); update({ when: key ? { key, value: value || '' } : undefined }) }} /></label>
        {editing.value.type === 'rows' ? <div><p>表格列</p><FieldEditor fields={editing.value.fields || []} onChange={(fields) => update({ fields })} /></div> : null}
      </Space> : null}
    </Modal>
  </>
}
export function ContractTemplateManager() {
  const { message, modal } = App.useApp(), cache = useQueryClient()
  const list = useQuery({ queryKey: ['commission-templates'], queryFn: () => apiFetch<TemplateDto[]>('/api/admin/contract-templates') })
  const settings = useQuery({ queryKey: ['commission-settings'], queryFn: () => apiFetch<{ provider: Record<string, string>; calendar: WorkingCalendar }>('/api/admin/commissions/settings') })
  const [editor, setEditor] = useState<(TemplateVersionDto & { name: string; newVersion: boolean }) | null>(null)
  const [kind, setKind] = useState<CommissionDocumentType>('AGREEMENT'), [bodyKind, setBodyKind] = useState<keyof typeof bodies>('AGREEMENT'), [insertKey, setInsertKey] = useState<string>(), [presetOpen, setPresetOpen] = useState(false), [newOpen, setNewOpen] = useState(false)
  const [previewForm] = Form.useForm(), [presetForm] = Form.useForm(), [newForm] = Form.useForm()
  const watched = Form.useWatch([], previewForm)
  const refresh = () => cache.invalidateQueries({ queryKey: ['commission-templates'] })
  const save = useMutation({ mutationFn: () => apiFetch(`/api/admin/contract-templates/${editor!.templateId}/versions`, { method: 'POST', body: JSON.stringify({ ...(editor!.newVersion ? {} : { versionId: Number(editor!.id) }), documents: editor!.documents, fields: editor!.fields, defaults: previewForm.getFieldsValue(true) }) }), onSuccess: async () => { setEditor(null); message.success('模板草稿已保存'); await refresh() }, onError: (e) => message.error(e.message) })
  const publish = useMutation({ mutationFn: (id: string) => apiFetch(`/api/admin/contract-templates/versions/${id}/publish`, { method: 'POST', body: '{}' }), onSuccess: async () => { message.success('模板版本已发布'); await refresh() }, onError: (e) => message.error(e.message) })
  const status = useMutation({ mutationFn: (t: TemplateDto) => apiFetch(`/api/admin/contract-templates/${t.id}`, { method: 'PUT', body: JSON.stringify({ status: t.status === 'ACTIVE' ? 'RETIRED' : 'ACTIVE' }) }), onSuccess: refresh, onError: (e) => message.error(e.message) })
  const create = useMutation({ mutationFn: (values: Record<string, unknown>) => apiFetch('/api/admin/contract-templates', { method: 'POST', body: JSON.stringify(values) }), onSuccess: async () => { setNewOpen(false); await refresh(); message.success('模板已建立，可从内置模板复制一份版本后编辑') }, onError: (e) => message.error(e.message) })
  const presetSave = useMutation({ mutationFn: (values: Record<string, string>) => apiFetch('/api/admin/commissions/settings', { method: 'PUT', body: JSON.stringify({ provider: Object.fromEntries(Object.entries(values).filter(([key]) => !['holidays', 'workdays'].includes(key))), calendar: { holidays: (values.holidays || '').split(/\s+/).filter(Boolean), workdays: (values.workdays || '').split(/\s+/).filter(Boolean) } }) }), onSuccess: () => { setPresetOpen(false); message.success('资料预设与工作日历已保存'); void cache.invalidateQueries({ queryKey: ['commission-settings'] }) }, onError: (e) => message.error(e.message) })
  const openEditor = (t: TemplateDto, v?: TemplateVersionDto) => {
    const source = v || t.versions[0] || list.data?.find((item) => item.key === 'software-custom-development')?.versions[0]
    if (!source) return
    const clone = structuredClone(source)
    setEditor({ ...clone, templateId: t.id, name: t.name, newVersion: !v || v.status !== 'DRAFT' })
    previewForm.resetFields(); previewForm.setFieldsValue(clone.defaults)
  }
  let preview = ''
  try { if (editor) preview = renderContractDocument(editor.documents, editor.fields, { ...editor.defaults, ...watched }, kind) } catch (e) { preview = e instanceof Error ? e.message : '请检查变量与字段定义' }
  return <div className={styles.workspace}>
    <div className={styles.heading}><div><h1>合同模板与合作规则</h1><p>已发布版本固定保留。调整条款或字段时创建新版本，已发起文件继续使用原快照。</p></div><Space wrap><Button onClick={() => { presetForm.resetFields(); presetForm.setFieldsValue({ ...settings.data?.provider, holidays: settings.data?.calendar.holidays?.join('\n'), workdays: settings.data?.calendar.workdays?.join('\n') }); setPresetOpen(true) }} disabled={!settings.data}>乙方资料与工作日历</Button><Button type="primary" onClick={() => { newForm.resetFields(); setNewOpen(true) }}>建立模板</Button></Space></div>
    {list.isError || settings.isError ? <Alert type="error" title="模板或设置加载失败" action={<Button onClick={() => { void list.refetch(); void settings.refetch() }}>重试</Button>} /> : null}
    <List loading={list.isPending} dataSource={list.data || []} renderItem={(t) => <List.Item><Card title={<>{t.name} <Tag>{t.status === 'ACTIVE' ? '启用' : '已停用'}</Tag></>} style={{ width: '100%' }} extra={<Space><Button onClick={() => status.mutate(t)}>{t.status === 'ACTIVE' ? '停用' : '启用'}</Button><Button onClick={() => openEditor(t)}>创建新版本</Button></Space>}>
      <List dataSource={t.versions} locale={{ emptyText: '创建首个版本，默认复制完整内置模板' }} renderItem={(v) => <List.Item actions={[<Button key="edit" onClick={() => openEditor(t, v)}>{v.status === 'DRAFT' ? '编辑草稿' : '以此版本创建新草稿'}</Button>, ...(v.status === 'DRAFT' ? [<Button key="publish" type="primary" loading={publish.isPending} onClick={() => modal.confirm({ title: '发布此模板版本', content: '发布后该版本正文与字段不可修改。请先完成填写预览并检查条款。', onOk: () => publish.mutateAsync(v.id) })}>发布</Button>] : [])]}><List.Item.Meta title={`版本 ${v.version} · ${v.status === 'DRAFT' ? '草稿' : '已发布'}`} description={`${v.fields.length} 个字段${v.publishedAt ? '；发布时间：' + new Date(v.publishedAt).toLocaleString('zh-CN', { timeZone: 'Asia/Shanghai' }) : ''}`} /></List.Item>} />
    </Card></List.Item>} />
    <Drawer open={Boolean(editor)} size={1000} title={`${editor?.name} · ${editor?.newVersion ? '新版本草稿' : '编辑草稿'}`} onClose={() => !save.isPending && setEditor(null)} extra={<Button type="primary" loading={save.isPending} onClick={() => save.mutate()}>保存草稿</Button>}>
      {editor ? <Tabs items={[{ key: 'body', label: '文件正文与变量', children: <Space orientation="vertical" style={{ width: '100%' }}>
        <Alert type="info" title="支持变量、勾选、条件与重复表格" description={'例如 {{projectName}}、{{money totalFen}}、{{check ipMode "transfer"}}、{{#if licenseScope}}…{{/if}}、{{#each modules}}| {{this.name}} |{{/each}}。金额和重复信息由字段计算。'} />
        <Select value={bodyKind} onChange={setBodyKind} options={Object.entries(bodies).map(([value, label]) => ({ value, label }))} />
        <Space wrap><Select showSearch style={{ minWidth: 260 }} placeholder="选择字段" value={insertKey} onChange={setInsertKey} options={editor.fields.map((f) => ({ value: f.key, label: `${f.label} (${f.key})` }))} /><Button disabled={!insertKey} onClick={() => setEditor({ ...editor, documents: { ...editor.documents, [bodyKind]: `${editor.documents[bodyKind]}\n{{${insertKey}}}` } })}>插入字段到正文末尾</Button></Space>
        <Input.TextArea rows={26} value={editor.documents[bodyKind]} onChange={(e) => setEditor({ ...editor, documents: { ...editor.documents, [bodyKind]: e.target.value } })} />
      </Space> }, { key: 'fields', label: '字段、选项与表格', children: <FieldEditor fields={editor.fields} onChange={(fields) => setEditor({ ...editor, fields })} /> }, { key: 'preview', label: '默认填写与完整预览', forceRender: true, children: <Space orientation="vertical" style={{ width: '100%' }}><Select value={kind} onChange={setKind} options={Object.entries(kinds).map(([value, label]) => ({ value, label }))} /><Form form={previewForm} layout="vertical"><TemplateFields fields={editor.fields} kind={kind} /></Form><MarkdownView content={preview} /></Space> }]} /> : null}
    </Drawer>
    <Modal title="建立合同模板" open={newOpen} onCancel={() => setNewOpen(false)} onOk={() => newForm.submit()} confirmLoading={create.isPending} okText="建立" cancelText="返回"><Form form={newForm} layout="vertical" onFinish={(values) => create.mutate(values)}><Form.Item name="name" label="模板名称" rules={[{ required: true }]}><Input /></Form.Item><Form.Item name="key" label="英文标识（小写字母与短横线）" rules={[{ required: true, pattern: /^[a-z][a-z0-9-]{1,79}$/ }]}><Input /></Form.Item></Form></Modal>
    <Modal title="乙方资料预设与工作日历" open={presetOpen} width={700} onCancel={() => setPresetOpen(false)} onOk={() => presetForm.submit()} confirmLoading={presetSave.isPending} okText="保存预设" cancelText="返回"><Form form={presetForm} layout="vertical" onFinish={(values) => presetSave.mutate(values)}>
      <p>新建项目复制乙方资料快照；已发起的文件保留原约定。所有期限使用北京时间，默认周一至周五为工作日。</p>
      {Object.entries({ Name: '姓名或单位名称', Identity: '身份证或统一社会信用代码', Phone: '电话', Email: '邮箱', Wechat: '微信', Address: '地址', payeeName: '收款人', payeeAccount: '收款账号', paymentChannel: '收款平台', supportChannel: '售后联系渠道' }).map(([key, label]) => <Form.Item key={key} name={key} label={label}><Input maxLength={1000} /></Form.Item>)}
      <Form.Item name="holidays" label="休息日（每行 YYYY-MM-DD）"><Input.TextArea rows={4} /></Form.Item><Form.Item name="workdays" label="调休工作日（每行 YYYY-MM-DD）"><Input.TextArea rows={4} /></Form.Item>
    </Form></Modal>
  </div>
}
