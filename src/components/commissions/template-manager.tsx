'use client'
/**
 * @file template-manager.tsx
 * @project SlothVault
 * @module Markdown Template Workspace
 * @description Uses shared admin list surfaces and a responsive Markdown, variable and preview workspace.
 * @logic Filter templates locally, infer fields from placeholders, preview escaped defaults and freeze published versions.
 * @dependencies React Query, Ant Design, admin layout primitives, simple template functions
 * @index_tags commissions,templates,markdown,preview
 * @author holic512
 */
import { useState } from 'react'
import Link from 'next/link'
import { useRouter } from 'next/navigation'
import { useMutation, useQuery, useQueryClient } from '@tanstack/react-query'
import { Alert, App, Button, Checkbox, Empty, Form, Grid, Input, Modal, Select, Skeleton, Space, Table, Tabs, Tag } from 'antd'
import { ArrowLeft, FilePenLine, FileSignature, Plus, RefreshCw, Save, Send } from 'lucide-react'
import { AdminPage, AdminPageActions, AdminTablePanel, AdminToolbar } from '@/components/admin/admin-page'
import { apiFetch } from '@/lib/api-client'
import { renderSimpleTemplate, synchronizeFields, type SimpleField, type SimpleTemplate, type SimpleTemplateVersion } from '@/lib/commission-workflow'
import { MarkdownView } from '@/components/markdown/markdown-view'
import styles from '@/styles/modules/commission-workflow.module.css'

const initialBody = '# 委托合同\n\n项目名称：{{项目名称}}\n\n委托方：{{委托方}}\n'

export function ContractTemplateManager({ id }: { id?: string }) {
  const router = useRouter()
  const cache = useQueryClient()
  const { message, modal } = App.useApp()
  const screens = Grid.useBreakpoint()
  const [newOpen, setNewOpen] = useState(false)
  const [form] = Form.useForm()
  const [draft, setEditor] = useState<SimpleTemplateVersion | null>(null)
  const [keyword, setKeyword] = useState('')
  const [status, setStatus] = useState<string>()
  const [page, setPage] = useState(1)
  const query = useQuery({ queryKey: ['simple-templates'], queryFn: () => apiFetch<SimpleTemplate[]>('/api/admin/contract-templates') })
  const template = query.data?.find((item) => item.id === id)
  const editor = draft || (template ? template.versions[0] || { id: '', version: 1, status: 'DRAFT', body: initialBody, fields: synchronizeFields(initialBody) } : null)
  const refresh = () => cache.invalidateQueries({ queryKey: ['simple-templates'] })
  const create = useMutation({
    mutationFn: (values: { name: string }) => apiFetch<{ id: string | number }>('/api/admin/contract-templates', { method: 'POST', body: JSON.stringify({ name: values.name, key: `markdown-${crypto.randomUUID()}` }) }),
    onSuccess: (row) => { setNewOpen(false); void refresh(); router.push(`/admin/mm/contract-templates/${row.id}`) },
    onError: (error) => message.error(error.message),
  })
  const saveVersion = () => apiFetch<SimpleTemplateVersion>(`/api/admin/contract-templates/${id}/versions`, {
    method: 'POST',
    body: JSON.stringify({ body: editor!.body, fields: synchronizeFields(editor!.body, editor!.fields), ...(editor!.id ? { versionId: Number(editor!.id) } : {}) }),
  })
  const save = useMutation({
    mutationFn: saveVersion,
    onSuccess: (value) => { setEditor(value); message.success('模板草稿已保存'); void refresh() },
    onError: (error) => message.error(error.message),
  })
  const publish = useMutation({
    mutationFn: async () => {
      const saved = await saveVersion()
      // Retain the saved draft if publication fails, so retrying does not create another version.
      setEditor(saved)
      return apiFetch<SimpleTemplateVersion>(`/api/admin/contract-templates/versions/${saved.id}/publish`, { method: 'POST', body: '{}' })
    },
    onSuccess: (value) => { setEditor(value); message.success('模板版本已发布并冻结'); void refresh() },
    onError: (error) => { message.error(error.message); void refresh() },
  })
  const retire = useMutation({
    mutationFn: (item: SimpleTemplate) => apiFetch(`/api/admin/contract-templates/${item.id}`, { method: 'PUT', body: JSON.stringify({ status: item.status === 'ACTIVE' ? 'RETIRED' : 'ACTIVE' }) }),
    onSuccess: async (_value, item) => { message.success(item.status === 'ACTIVE' ? '模板已停用' : '模板已启用'); await refresh() },
    onError: (error) => message.error(error.message),
  })
  const readonly = editor?.status === 'PUBLISHED'
  const busy = save.isPending || publish.isPending
  let error = '', preview = '', fields = editor?.fields || []
  try {
    if (editor) { fields = synchronizeFields(editor.body, editor.fields); preview = renderSimpleTemplate(editor.body, fields, {}) }
  } catch (failure) { error = (failure as Error).message }
  const updateField = (key: string, patch: Partial<SimpleField>) => {
    if (editor) setEditor({ ...editor, fields: fields.map((field) => field.key === key ? { ...field, ...patch } : field) })
  }
  const openCreate = () => { form.resetFields(); setNewOpen(true) }
  const filtered = Boolean(keyword.trim() || status)
  const resetFilters = () => { setKeyword(''); setStatus(undefined); setPage(1) }
  const rows = query.data?.filter((item) => item.name.toLocaleLowerCase().includes(keyword.trim().toLocaleLowerCase()) && (!status || item.status === status)) || []
  const retry = <Button size="small" loading={query.isFetching} onClick={() => void refresh()}>重试</Button>

  if (!id) return (
    <AdminPage className={`${styles.workspace} ${styles['admin-workspace']}`}>
      <AdminPageActions className={styles['list-actions']}>
        <Space wrap>
          <Button href="/admin/mm/commissions" icon={<FileSignature size={15} />}>委托管理</Button>
          <Button icon={<RefreshCw size={15} />} loading={query.isFetching} onClick={() => void refresh()}>刷新</Button>
          <Button type="primary" icon={<Plus size={15} />} onClick={openCreate}>建立模板</Button>
        </Space>
      </AdminPageActions>
      <AdminToolbar>
        <div className="admin-filters">
          <Input.Search aria-label="搜索模板名称" allowClear value={keyword} placeholder="搜索模板名称" onChange={(event) => { setKeyword(event.target.value); setPage(1) }} onSearch={() => setPage(1)} />
          <Select aria-label="模板状态" allowClear value={status} placeholder="全部状态" onChange={(value) => { setStatus(value); setPage(1) }} options={[{ value: 'ACTIVE', label: '启用' }, { value: 'RETIRED', label: '停用' }]} />
        </div>
      </AdminToolbar>
      {query.error ? <Alert showIcon type="error" title="模板加载失败" description={query.error.message} action={retry} /> : null}
      <AdminTablePanel>
        <Table<SimpleTemplate>
          rowKey="id"
          loading={query.isPending}
          dataSource={rows}
          pagination={{ current: page, pageSize: 20, showSizeChanger: false, hideOnSinglePage: true, onChange: setPage }}
          scroll={{ x: 800 }}
          locale={{ emptyText: query.error ? '模板加载失败，请重试' : <Empty image={Empty.PRESENTED_IMAGE_SIMPLE} description={filtered ? '没有符合筛选条件的模板' : '还没有合同模板，建立后即可编写正文与变量'}><Button type={filtered ? 'default' : 'primary'} onClick={filtered ? resetFilters : openCreate}>{filtered ? '清除筛选' : '建立模板'}</Button></Empty> }}
          columns={[
            { title: '模板名称', dataIndex: 'name', ellipsis: true, render: (name, item) => <Link href={`/admin/mm/contract-templates/${item.id}`}>{name}</Link> },
            { title: '状态', width: 110, render: (_, item) => <Tag color={item.status === 'ACTIVE' ? 'success' : 'default'}>{item.status === 'ACTIVE' ? '启用' : '停用'}</Tag> },
            { title: '发布版本', width: 130, render: (_, item) => {
              const version = item.versions.find((version) => version.status === 'PUBLISHED')
              return version ? <Tag>v{version.version}</Tag> : <span className={styles.muted}>尚未发布</span>
            } },
            { title: '最新版本', width: 140, render: (_, item) => {
              const version = item.versions[0]
              return version ? <Space size={4}><span>v{version.version}</span>{version.status === 'DRAFT' ? <Tag color="warning">草稿</Tag> : <Tag color="success">已发布</Tag>}</Space> : <span className={styles.muted}>待编写</span>
            } },
            { title: '操作', fixed: 'right', width: 220, render: (_, item) => <Space size={2}>
              <Button type="link" href={`/admin/mm/contract-templates/${item.id}`} icon={<FilePenLine size={14} />}>编辑与预览</Button>
              <Button type="link" disabled={retire.isPending} loading={retire.isPending && retire.variables?.id === item.id} onClick={() => {
                if (item.status !== 'ACTIVE') { retire.mutate(item); return }
                modal.confirm({ title: `停用「${item.name}」？`, content: '停用后将无法用于生成新合同，已有合同不受影响。', okText: '停用模板', cancelText: '取消', onOk: () => retire.mutateAsync(item) })
              }}>{item.status === 'ACTIVE' ? '停用' : '启用'}</Button>
            </Space> },
          ]}
        />
      </AdminTablePanel>
      <Modal title="建立合同模板" open={newOpen} onCancel={() => setNewOpen(false)} onOk={() => form.submit()} confirmLoading={create.isPending} okText="建立模板" cancelText="取消">
        <Form form={form} layout="vertical" onFinish={(values) => create.mutate(values)}>
          <Form.Item name="name" label="模板名称" rules={[{ required: true, whitespace: true, message: '请输入模板名称' }]}><Input maxLength={255} placeholder="例如：软件开发委托合同" /></Form.Item>
          <p className={styles.muted}>建立后可编写 Markdown 正文，用 {'{{变量名称}}'} 生成合同填写项。</p>
        </Form>
      </Modal>
    </AdminPage>
  )

  if (!editor || !template) return <AdminPage>
    <div><Button type="link" href="/admin/mm/contract-templates" icon={<ArrowLeft size={14} />}>返回模板列表</Button></div>
    {query.isPending ? <Skeleton active /> : query.error ? <Alert showIcon type="error" title="模板加载失败" description={query.error.message} action={retry} /> : <Empty description="模板不存在或已被移除" />}
  </AdminPage>

  const markdown = <section className={styles['editor-pane']}>
    <div className={styles['pane-heading']}><label htmlFor="contract-template-body">Markdown 正文</label><span className={styles.muted}>{fields.length} 个变量</span></div>
    <Input.TextArea id="contract-template-body" className={styles['editor-text']} rows={24} readOnly={readonly} disabled={busy} value={editor.body} onChange={(event) => setEditor({ ...editor, body: event.target.value })} />
    <p className={styles['editor-help']}>用 {'{{变量名称}}'} 插入填写项，同名变量只填写一次。支持中文、字母、数字和下划线。</p>
  </section>
  const variables = <Form component={false} layout="vertical"><div className={styles['variable-list']}>{fields.length ? fields.map((field, index) => {
    const fieldId = `template-field-${index}`
    return <section key={field.key} aria-label={`${field.key}变量配置`} className={styles['field-row']}>
      <strong>{'{{'}{field.key}{'}}'}</strong>
      <div className={styles['variable-controls']}>
        <Form.Item label="显示名称" htmlFor={`${fieldId}-label`}><Input id={`${fieldId}-label`} disabled={readonly || busy} value={field.label} onChange={(event) => updateField(field.key, { label: event.target.value })} /></Form.Item>
        <Form.Item label="输入类型" htmlFor={`${fieldId}-type`}><Select id={`${fieldId}-type`} disabled={readonly || busy} value={field.type} onChange={(type) => updateField(field.key, { type })} options={[{ value: 'text', label: '单行文本' }, { value: 'multiline', label: '多行文本' }, { value: 'number', label: '数字' }, { value: 'money', label: '金额' }, { value: 'date', label: '日期' }, { value: 'select', label: '选项' }]} /></Form.Item>
      </div>
      <Checkbox disabled={readonly || busy} checked={field.required} onChange={(event) => updateField(field.key, { required: event.target.checked })}>必填</Checkbox>
      {field.type === 'select' ? <Form.Item label="可选内容" htmlFor={`${fieldId}-options`}><Input.TextArea id={`${fieldId}-options`} disabled={readonly || busy} placeholder="每行一个选项" value={(field.options || []).join('\n')} onChange={(event) => updateField(field.key, { options: event.target.value.split('\n') })} /></Form.Item> : null}
      <Form.Item label="默认内容（可选）" htmlFor={`${fieldId}-default`}><Input.TextArea id={`${fieldId}-default`} disabled={readonly || busy} rows={field.type === 'multiline' ? 3 : 1} placeholder={field.type === 'date' ? 'YYYY-MM-DD' : field.type === 'money' ? '例如：1000.00' : '未设置时由填写合同的人补充'} value={field.defaultValue || ''} onChange={(event) => updateField(field.key, { defaultValue: event.target.value })} /></Form.Item>
    </section>
  }) : <Empty image={Empty.PRESENTED_IMAGE_SIMPLE} description="正文没有变量，将作为固定合同正文使用" />}</div></Form>
  const previewPane = <section className={styles['preview-pane']}><p className={styles['editor-help']}>预览使用变量的默认内容，未填写的必填项会显示提示。</p>{error ? <Empty image={Empty.PRESENTED_IMAGE_SIMPLE} description="修正正文或变量内容后恢复预览" /> : <div className={styles['preview-paper']}><MarkdownView content={preview} /></div>}</section>
  const right = <section className={styles['editor-pane']}><Tabs className={styles['pane-tabs']} items={[{ key: 'preview', label: '实时预览', children: previewPane }, { key: 'variables', label: `变量配置（${fields.length}）`, children: variables }]} /></section>

  return <AdminPage className={`${styles.workspace} ${styles['admin-workspace']} ${styles['template-workspace']}`}>
    <div><Button type="link" href="/admin/mm/contract-templates" icon={<ArrowLeft size={14} />}>返回模板列表</Button></div>
    <header className={styles['template-heading']}>
      <div className={styles['template-title']}><h1>{template.name}</h1><Tag color={readonly ? 'success' : 'warning'}>{readonly ? '已发布 · 只读' : '草稿'}</Tag></div>
      <Space wrap>
        <Select aria-label="模板版本" className={styles['version-select']} disabled={busy} value={editor.id || 'new'} onChange={(value) => { const selected = template.versions.find((version) => version.id === value); if (selected) setEditor(selected) }} options={[...template.versions.map((version) => ({ value: version.id, label: `v${version.version} · ${version.status === 'PUBLISHED' ? '已发布' : '草稿'}` })), ...(!editor.id ? [{ value: 'new', label: '新版本草稿' }] : [])]} />
        {readonly ? <Button type="primary" icon={<Plus size={15} />} onClick={() => setEditor({ ...editor, id: '', version: (template.versions[0]?.version || 0) + 1, status: 'DRAFT' })}>建立新版本</Button> : <>
          <Button icon={<Save size={15} />} loading={save.isPending} disabled={Boolean(error) || publish.isPending} onClick={() => save.mutate()}>保存草稿</Button>
          <Button type="primary" icon={<Send size={15} />} disabled={Boolean(error) || save.isPending} loading={publish.isPending} onClick={() => publish.mutate()}>保存并发布</Button>
        </>}
      </Space>
    </header>
    {query.error ? <Alert showIcon type="error" title="模板刷新失败" description={query.error.message} action={retry} /> : null}
    {readonly ? <Alert showIcon type="info" title="此版本已发布并冻结，建立新版本后可继续修改" /> : null}
    {error ? <Alert showIcon type="warning" title={error} /> : null}
    {screens.lg === false ? <Tabs className={styles['mobile-editor-tabs']} items={[{ key: 'edit', label: '编辑正文', children: markdown }, { key: 'variables', label: `变量配置（${fields.length}）`, children: <section className={styles['editor-pane']}>{variables}</section> }, { key: 'preview', label: '实时预览', children: <section className={styles['editor-pane']}>{previewPane}</section> }]} /> : <div className={styles['template-editor-grid']}>{markdown}{right}</div>}
  </AdminPage>
}
