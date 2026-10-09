'use client'
/**
 * @file template-manager.tsx
 * @project SlothVault
 * @module Markdown Template Workspace
 * @description Separates template discovery from a full-page Markdown and variable editor.
 * @logic Infer fields from placeholders, preview escaped defaults and create new versions instead of mutating published text.
 * @dependencies React Query, Ant Design, simple template functions
 * @index_tags commissions,templates,markdown,preview
 * @author holic512
 */
import { useState } from 'react'
import Link from 'next/link'
import { useRouter } from 'next/navigation'
import { useMutation, useQuery, useQueryClient } from '@tanstack/react-query'
import { Alert, App, Button, Checkbox, Empty, Form, Grid, Input, Modal, Select, Space, Spin, Table, Tabs, Tag } from 'antd'
import { apiFetch } from '@/lib/api-client'
import { renderSimpleTemplate, synchronizeFields, type SimpleField, type SimpleTemplate, type SimpleTemplateVersion } from '@/lib/commission-workflow'
import { MarkdownView } from '@/components/markdown/markdown-view'
import styles from '@/styles/modules/commission-workflow.module.css'
export function ContractTemplateManager({ id }: { id?: string }) {
  const router = useRouter(), cache = useQueryClient(), { message } = App.useApp(), screens = Grid.useBreakpoint()
  const [newOpen, setNewOpen] = useState(false), [form] = Form.useForm(), [draft, setEditor] = useState<SimpleTemplateVersion | null>(null)
  const query = useQuery({ queryKey: ['simple-templates'], queryFn: () => apiFetch<SimpleTemplate[]>('/api/admin/contract-templates') })
  const template = query.data?.find((item) => item.id === id)
  const editor = draft || (template ? template.versions[0] || { id: '', version: 1, status: 'DRAFT', body: '# 委托合同\n\n项目名称：{{项目名称}}\n\n委托方：{{委托方}}\n', fields: synchronizeFields('# 委托合同\n\n项目名称：{{项目名称}}\n\n委托方：{{委托方}}\n') } : null)
  const refresh = () => cache.invalidateQueries({ queryKey: ['simple-templates'] })
  const create = useMutation({ mutationFn: (values: { name: string }) => apiFetch<{ id: string | number }>('/api/admin/contract-templates', { method: 'POST', body: JSON.stringify({ name: values.name, key: `markdown-${crypto.randomUUID()}` }) }), onSuccess: (row) => { void refresh(); router.push(`/admin/mm/contract-templates/${row.id}`) }, onError: (error) => message.error(error.message) })
  const save = useMutation({ mutationFn: () => apiFetch<SimpleTemplateVersion>(`/api/admin/contract-templates/${id}/versions`, { method: 'POST', body: JSON.stringify({ body: editor!.body, fields: synchronizeFields(editor!.body, editor!.fields), ...(editor!.id ? { versionId: Number(editor!.id) } : {}) }) }), onSuccess: (value) => { setEditor(value); message.success('模板草稿已保存'); void refresh() }, onError: (error) => message.error(error.message) })
  const publish = useMutation({ mutationFn: async () => { const saved = await apiFetch<SimpleTemplateVersion>(`/api/admin/contract-templates/${id}/versions`, { method: 'POST', body: JSON.stringify({ body: editor!.body, fields: synchronizeFields(editor!.body, editor!.fields), ...(editor!.id ? { versionId: Number(editor!.id) } : {}) }) }); return apiFetch<SimpleTemplateVersion>(`/api/admin/contract-templates/versions/${saved.id}/publish`, { method: 'POST', body: '{}' }) }, onSuccess: (value) => { setEditor(value); message.success('模板版本已发布并冻结'); void refresh() }, onError: (error) => message.error(error.message) })
  const retire = useMutation({ mutationFn: (item: SimpleTemplate) => apiFetch(`/api/admin/contract-templates/${item.id}`, { method: 'PUT', body: JSON.stringify({ status: item.status === 'ACTIVE' ? 'RETIRED' : 'ACTIVE' }) }), onSuccess: refresh, onError: (error) => message.error(error.message) })
  const readonly = editor?.status === 'PUBLISHED'
  let error = '', preview = '', fields = editor?.fields || []
  try { if (editor) { fields = synchronizeFields(editor.body, editor.fields); preview = renderSimpleTemplate(editor.body, fields, {}) } } catch (failure) { error = (failure as Error).message }
  const updateField = (key: string, patch: Partial<SimpleField>) => { if (editor) setEditor({ ...editor, fields: fields.map((field) => field.key === key ? { ...field, ...patch } : field) }) }
  if (!id) return <div className={styles.workspace}><header className={styles.heading}><div><h1>合同模板</h1><p>编写 Markdown，用 {'{{变量名称}}'} 自动生成合同填写项。</p></div><Space><Link href="/admin/mm/commissions"><Button>委托管理</Button></Link><Button type="primary" onClick={() => { form.resetFields(); setNewOpen(true) }}>建立模板</Button></Space></header>
    {query.error ? <Alert type="error" title={query.error.message} /> : null}
    <Table rowKey="id" loading={query.isPending} dataSource={query.data} pagination={false} scroll={{ x: 550 }} columns={[{ title: '模板名称', render: (_, item) => <Link href={`/admin/mm/contract-templates/${item.id}`}>{item.name}</Link> }, { title: '状态', render: (_, item) => <Tag>{item.status === 'ACTIVE' ? '启用' : '停用'}</Tag> }, { title: '发布版本', render: (_, item) => item.versions.find((version) => version.status === 'PUBLISHED')?.version || '尚未发布' }, { title: '操作', render: (_, item) => <Space><Link href={`/admin/mm/contract-templates/${item.id}`}>编辑与预览</Link><Button size="small" onClick={() => retire.mutate(item)}>{item.status === 'ACTIVE' ? '停用' : '启用'}</Button></Space> }]} />
    <Modal title="建立合同模板" open={newOpen} onCancel={() => setNewOpen(false)} onOk={() => form.submit()} confirmLoading={create.isPending} okText="建立" cancelText="返回"><Form form={form} layout="vertical" onFinish={(values) => create.mutate(values)}><Form.Item name="name" label="模板名称" rules={[{ required: true }]}><Input maxLength={255} /></Form.Item></Form></Modal>
  </div>
  if (query.error) return <Alert type="error" title={query.error.message} />
  if (!editor || !template) return query.isPending ? <Spin /> : <Empty description="模板不存在" />
  const markdown = <div><div className={styles['section-heading']}><h2>Markdown 正文</h2><span className={styles.muted}>{fields.length} 个变量</span></div><Input.TextArea className={styles['editor-text']} rows={24} readOnly={readonly} value={editor.body} onChange={(event) => { const body = event.target.value; setEditor({ ...editor, body }); }} /><p className={styles.muted}>同名变量只填写一次。支持中文、字母、数字和下划线，不执行表达式。</p></div>
  const variables = <div>{fields.length ? fields.map((field) => <div key={field.key} className={styles['field-row']}><strong>{'{{'}{field.key}{'}}'}</strong><div className={styles['field-controls']}><Input aria-label={`${field.key}显示名称`} disabled={readonly} value={field.label} onChange={(event) => updateField(field.key, { label: event.target.value })} /><Select aria-label={`${field.key}输入类型`} disabled={readonly} value={field.type} onChange={(type) => updateField(field.key, { type })} options={[{ value: 'text', label: '单行文本' }, { value: 'multiline', label: '多行文本' }, { value: 'number', label: '数字' }, { value: 'money', label: '金额' }, { value: 'date', label: '日期' }, { value: 'select', label: '选项' }]} /><Checkbox disabled={readonly} checked={field.required} onChange={(event) => updateField(field.key, { required: event.target.checked })}>必填</Checkbox></div>
    {field.type === 'select' ? <Input.TextArea disabled={readonly} placeholder="每行一个选项" value={(field.options || []).join('\n')} onChange={(event) => updateField(field.key, { options: event.target.value.split('\n') })} /> : null}<Input.TextArea style={{ marginTop: 10 }} disabled={readonly} rows={field.type === 'multiline' ? 3 : 1} placeholder="默认填写内容（可选）" value={field.defaultValue || ''} onChange={(event) => updateField(field.key, { defaultValue: event.target.value })} /></div>) : <Empty description="正文没有变量，将直接作为固定合同正文使用" />}</div>
  const right = <Tabs items={[{ key: 'preview', label: '实时预览', children: <section className={styles.paper}>{error ? <Alert type="warning" title={error} /> : <MarkdownView content={preview} />}</section> }, { key: 'variables', label: '变量配置', children: variables }]} />
  return <div className={styles.workspace}><Link className={styles.back} href="/admin/mm/contract-templates">返回模板列表</Link><header className={styles.heading}><div><h1>{template.name}</h1><p>正文、输入项与生成内容在同一处维护。</p></div><Space wrap><Select value={editor.id || 'new'} onChange={(value) => setEditor(template.versions.find((version) => version.id === value)!)} options={[...template.versions.map((version) => ({ value: version.id, label: `v${version.version} · ${version.status === 'PUBLISHED' ? '已发布' : '草稿'}` })), ...(!editor.id ? [{ value: 'new', label: '新版本草稿' }] : [])]} />{readonly ? <Button type="primary" onClick={() => setEditor({ ...editor, id: '', version: (template.versions[0]?.version || 0) + 1, status: 'DRAFT' })}>建立新版本</Button> : <><Button loading={save.isPending} disabled={Boolean(error)} onClick={() => save.mutate()}>保存草稿</Button><Button type="primary" disabled={Boolean(error) || save.isPending} loading={publish.isPending} onClick={() => publish.mutate()}>保存并发布</Button></>}</Space></header>
    {readonly ? <Alert type="info" title="此版本已发布并冻结，建立新版本后可继续修改" /> : null}{error ? <Alert type="warning" title={error} /> : null}
    {screens.md === false ? <Tabs items={[{ key: 'edit', label: '编辑正文', children: markdown }, { key: 'settings', label: '变量与预览', children: right }]} /> : <div className={styles['editor-grid']}>{markdown}{right}</div>}
  </div>
}
