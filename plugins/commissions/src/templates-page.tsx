/**
 * @file templates-page.tsx
 * @project SlothVault
 * @module Commission template library
 * @description Browse scenario templates, initiate a shared creation flow and publish immutable revisions.
 * @logic Select the latest published family version, never replace a published snapshot, and require explicit review before publishing changes.
 * @dependencies React, plugin client SDK, commissions DTOs
 * @index_tags commissions,templates,versions
 * @author holic512
 */
import { useRef, useState } from 'react'
import { Alert, App, Button, Empty, Form, Input, PluginMarkdown, PluginPage, Select, Space, Tag, useQueryClient } from '@slothvault/plugin-sdk/client'
import { API, type ContractTemplate } from './domain'
import { TemplateCards } from './editor-contract'
import { AdminNavigation, ErrorNotice, Loading, pageUrl, post, queryRoot, useTemplates, useUnsavedChanges } from './ui'
const scenarios: Record<string, string> = {
  website: '网站与后台',
  mobile: '小程序与移动端',
  automation: '自动化与数据',
  integration: '接口集成',
  optimization: '优化与重构',
  maintenance: '维护与支持',
  general: '通用开发',
  change: '需求与费用变更'
}
export default function TemplatesPage() {
  const query = useTemplates(),
    [scenario, setScenario] = useState(''),
    [search, setSearch] = useState(''),
    [preview, setPreview] = useState<ContractTemplate | null>(null),
    [editing, setEditing] = useState<ContractTemplate | null>(null)
  const templates = (query.data?.list ?? []).filter(t => (!scenario || t.scenario === scenario) && `${t.title} ${t.applicableWhen}`.includes(search))
  return <PluginPage className="commissions">
    <AdminNavigation current="templates" />
    {editing
      ? <TemplateRevision key={editing.id} template={editing} onClose={() => setEditing(null)} />
      : <>
        <header className="commission-heading">
          <div><h1>合同模板库</h1><p>按业务场景选范本，从这里发起委托会进入同一条创建流程。已发布版本保持不变，调整会生成新版本。</p></div>
          <Button href={pageUrl(true, undefined, { create: '1' })}>不选模板，先写需求</Button>
        </header>
        <div className="commission-filters">
          <Input.Search
            aria-label="搜索模板用途"
            placeholder="搜索模板名称或适用条件"
            allowClear
            value={search}
            onChange={event => setSearch(event.target.value)}
          />
          <Select
            aria-label="筛选模板场景"
            value={scenario}
            onChange={setScenario}
            options={[
              { value: '', label: '全部场景' },
              ...Array.from(new Set((query.data?.list ?? []).map(t => t.scenario))).map(value => ({
                value,
                label: scenarios[value] ?? (query.data?.list.find(t => t.scenario === value)?.title || value)
              }))
            ]}
          />
        </div>
        <ErrorNotice error={query.error} retry={() => {
          void query.refetch()
        }} />
        {query.isPending
          ? <Loading />
          : templates.length
            ? <TemplateCards
              templates={templates}
              onSelect={template => window.location.assign(pageUrl(true, undefined, { create: '1', templateId: template.id }))}
              onPreview={setPreview}
            />
            : !query.error && <Empty description="没有匹配的已发布模板，请调整筛选条件。" />}
        {preview && <section className="commission-template-preview">
          <header className="commission-section-heading">
            <h2>{preview.title}</h2>
            <Tag>{preview.kind === 'MAIN' ? '主合同' : '补充协议'} · v{preview.version}</Tag>
          </header>
          <Alert type="info" title="可编辑业务范本，不保证适用于所有法律管辖区" description="请按双方真实约定核对条款。预览中的占位符需要在合同准备步骤填写。" />
          <PluginMarkdown className="commission-markdown" content={preview.body} />
          <Space wrap>
            <Button onClick={() => setPreview(null)}>收起预览</Button>
            <Button onClick={() => {
              setEditing(preview)
              setPreview(null)
            }}>基于此版本修订</Button>
            {preview.kind === 'MAIN'
              ? <Button type="primary" href={pageUrl(true, undefined, { create: '1', templateId: preview.id })}>从此模板发起</Button>
              : <Button href={pageUrl(true)}>到已有委托准备补充协议</Button>}
          </Space>
        </section>}
      </>}
  </PluginPage>
}
function TemplateRevision({ template, onClose }: { template: ContractTemplate; onClose: () => void }) {
  const [value, setValue] = useState(template),
    [busy, setBusy] = useState(false),
    [error, setError] = useState<unknown>(null),
    id = useRef(crypto.randomUUID()),
    cache = useQueryClient(),
    { modal, message } = App.useApp()
  const guard = useUnsavedChanges(JSON.stringify(value) !== JSON.stringify(template))
  return <section>
    <header className="commission-heading">
      <div><h1>修订模板</h1><p>基于 {template.title} v{template.version} 创建新版本；历史合同不受影响。</p></div>
      <Button disabled={busy} onClick={() => {
        void guard.confirmLeave().then(ok => {
          if (ok) onClose()
        })
      }}>取消修订</Button>
    </header>
    <ErrorNotice error={error} />
    <Form
      layout="vertical"
      initialValues={template}
      onValuesChange={(_, fields) => setValue({ ...template, ...fields })}
      onFinish={() => modal.confirm({
        title: '发布模板新版本？',
        content: '发布后此版本不可覆盖，之后的修改将继续创建新版本。已存在的合同不会自动更新。',
        okText: '发布新版本',
        cancelText: '继续编辑',
        onOk: async () => {
          setBusy(true)
          setError(null)
          try {
            await post(API.templateSave, { commandId: id.current, revision: template.version, template: value })
            guard.markSaved()
            await cache.invalidateQueries({ queryKey: queryRoot })
            message.success('模板新版本已发布')
            onClose()
          } catch (cause) {
            setError(cause)
            throw cause
          } finally {
            setBusy(false)
          }
        }
      })}
    >
      <div className="commission-editor-grid">
        <section>
          <Form.Item name="title" label="模板名称" rules={[{ required: true, whitespace: true }]}>
            <Input maxLength={200} />
          </Form.Item>
          <Form.Item name="applicableWhen" label="适用条件" rules={[{ required: true, whitespace: true }]}>
            <Input.TextArea rows={3} />
          </Form.Item>
          <Form.Item name="body" label="完整正文（保留字段占位符）" rules={[{ required: true, whitespace: true }]}>
            <Input.TextArea rows={22} maxLength={200000} />
          </Form.Item>
          <p className="commission-muted">可用字段：{template.fields.map(field => `{{${field.key}}}`).join('、')}</p>
        </section>
        <section><h2>正文预览</h2><PluginMarkdown className="commission-markdown" content={value.body} /></section>
      </div>
      <footer className="commission-footer">
        <span>不覆盖 v{template.version}</span>
        <Button type="primary" htmlType="submit" loading={busy}>核对并发布新版本</Button>
      </footer>
    </Form>
  </section>
}
