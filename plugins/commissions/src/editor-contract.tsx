/**
 * @file editor-contract.tsx
 * @project SlothVault
 * @module Four-step contract editor
 * @description Template selection, structured terms, complete preview and explicit publication in a focused page.
 * @logic Carry only semantically and type-compatible fields, keep drafts editable and guard departure, freeze only after validation and review.
 * @dependencies React, plugin client SDK, commissions DTOs
 * @index_tags commissions,contracts,wizard,templates,drafts
 * @author holic512
 */
import { useState } from 'react'
import { Alert, App, Button, Checkbox, Form, Input, InputNumber, PluginMarkdown, Select, Space, Steps, Tag } from '@slothvault/plugin-sdk/client'
import type { CommissionDetail, ContractDraft, ContractTemplate, FieldValue } from './domain'
import { ErrorNotice, Loading, useCommand, useTemplates, useUnsavedChanges } from './ui'
import { initialDraft, renderBody } from './presentation'
export function TemplateCards({ templates, selected, hasMain = false, onSelect, onPreview }: { templates: ContractTemplate[]; selected?: string; hasMain?: boolean; onSelect: (template: ContractTemplate) => void; onPreview?: (template: ContractTemplate) => void }) {
  return <div className="commission-template-grid">{templates.map(template => {
    const disabled = template.kind === 'SUPPLEMENT' && !hasMain
    return <article key={template.id} className={`commission-template${selected === template.id ? ' is-selected' : ''}`}>
      <div className="commission-section-heading"><h3>{template.title}</h3><Tag>{template.kind === 'MAIN' ? '主合同' : '补充协议'} · v{template.version}</Tag></div>
      <p>{template.scenario}</p><dl><dt>适用条件</dt><dd>{template.applicableWhen}</dd><dt>准备资料</dt><dd>{template.requiredMaterials.join('、')}</dd></dl>
      {disabled && <p className="commission-muted">已有生效主合同后，才可使用补充协议。</p>}
      <Space wrap><Button disabled={disabled} aria-pressed={selected === template.id} onClick={() => onSelect(template)}>{selected === template.id ? '已选择此模板' : '使用此模板'}</Button>{onPreview && <Button type="text" onClick={() => onPreview(template)}>预览正文</Button>}</Space>
    </article>
  })}</div>
}
export function ContractEditor({ detail, preferredTemplate, onClose }: { detail: CommissionDetail; preferredTemplate?: string; onClose: () => void }) {
  const templates = useTemplates(detail.commission.contractDraft?.templateId ?? preferredTemplate)
  if (templates.isPending) return <Loading />
  if (templates.error) return <ErrorNotice error={templates.error} retry={() => { void templates.refetch() }} />
  return <Editor detail={detail} templates={templates.data?.list ?? []} preferredTemplate={preferredTemplate} onClose={onClose} />
}
function Editor({ detail, templates, preferredTemplate, onClose }: { detail: CommissionDetail; templates: ContractTemplate[]; preferredTemplate?: string; onClose: () => void }) {
  const { modal, message } = App.useApp(), [form] = Form.useForm(), command = useCommand(detail)
  const [draft, setDraft] = useState<ContractDraft>(() => detail.commission.contractDraft ?? initialDraft(detail, templates.find(t => t.id === preferredTemplate)))
  const [saved, setSaved] = useState(() => JSON.stringify(detail.commission.contractDraft ?? initialDraft(detail, templates.find(t => t.id === preferredTemplate))))
  const [fileIds, setFileIds] = useState<string[]>([])
  const [step, setStep] = useState(0), [reviewed, setReviewed] = useState(false), [localError, setLocalError] = useState<unknown>(null), [saving, setSaving] = useState(false)
  const template = templates.find(t => t.id === draft.templateId), hasMain = detail.commission.contracts.some(c => c.kind === 'MAIN' && c.effectiveAt)
  const dirty = JSON.stringify(draft) !== saved, guard = useUnsavedChanges(dirty)
  const select = (next: ContractTemplate) => {
    if (next.id === draft.templateId) return
    const apply = () => {
      const fresh = initialDraft(detail, next)
      for (const field of next.fields) {
        const old = template?.fields.find(other => other.semantic === field.semantic && other.type === field.type)
        if (old && draft.fields[old.key] !== undefined) fresh.fields[field.key] = draft.fields[old.key]
      }
      fresh.body = renderBody(next, fresh.fields); setDraft(fresh); form.setFieldsValue({ title: fresh.title, fields: fresh.fields }); setReviewed(false)
    }
    if (draft.templateId) modal.confirm({ title: '切换合同模板？', content: '仅保留含义与类型一致的字段。正文编辑及不兼容条款将被替换，新字段使用模板默认值；请重新核对全文。', okText: '切换模板', cancelText: '保留当前模板', onOk: apply })
    else apply()
  }
  const validate = async () => {
    if (!template) throw new Error('请选择一个已发布模板。')
    if (template.kind === 'SUPPLEMENT' && !hasMain) throw new Error('补充协议需要一份已生效的主合同。')
    if (!draft.title.trim()) throw new Error('请填写合同名称。')
    const missing = template.fields.find(f => f.required && (draft.fields[f.key] === undefined || String(draft.fields[f.key]).trim() === ''))
    if (missing) { setStep(1); setTimeout(() => form.scrollToField(['fields', missing.key], { focus: true }), 0); throw new Error(`请填写：${missing.label}`) }
    if (!draft.body.trim() || /【待填写：/.test(draft.body) || /\{\{[^}]+\}\}/.test(draft.body)) { setStep(2); throw new Error('合同正文仍有待填写内容，请完成后重新核对。') }
  }
  const save = async (publish = false) => {
    if (saving) return
    setSaving(true); setLocalError(null)
    try {
      if (publish) await validate()
      if (!draft.templateId) throw new Error('请先选择模板。')
      await command.run('save-contract', { draft }); setSaved(JSON.stringify(draft)); guard.markSaved()
      if (publish) { await command.run('publish-contract', { fileIds }); message.success('合同已冻结，请在当前步骤完成主网存证。'); onClose() }
      else message.success('合同草稿已保存，尚未发布或上链。')
    } catch (error) { setLocalError(error) } finally { setSaving(false) }
  }
  const next = async () => {
    setLocalError(null)
    try { if (step === 1) await form.validateFields(); if (step === 2) await validate(); setStep(Math.min(3, step + 1)) } catch (error) { if (error instanceof Error) setLocalError(error) }
  }
  return <section className="commission-editor">
    <header className="commission-heading"><div><h2>{draft.kind === 'SUPPLEMENT' ? '准备补充协议' : '准备主合同'}</h2><p>先完成合同内容，再冻结发布。草稿保存不会触发存证。</p></div><Button disabled={saving} onClick={() => { void guard.confirmLeave().then(ok => { if (ok) onClose() }) }}>返回委托</Button></header>
    <Steps current={step} size="small" items={['选择模板', '当事人与条款', '完整预览', '确认发布'].map(title => ({ title }))} />
    <ErrorNotice error={localError || command.error} />
    {step === 0 && <><p>请选择与你的业务场景匹配的范本。模板不是通用法律适用性的保证，请按双方真实约定调整。</p>{templates.length ? <TemplateCards templates={templates} selected={draft.templateId} hasMain={hasMain} onSelect={select} /> : <Alert type="info" title="暂无已发布模板，请先在模板库发布一个版本。" />}</>}
    {step === 1 && template && <div className="commission-editor-grid"><Form form={form} layout="vertical" initialValues={{ title: draft.title, fields: draft.fields }} scrollToFirstError onValuesChange={(_, values: { title: string; fields: Record<string, FieldValue> }) => {
      const fields = { ...draft.fields, ...values.fields }, generated = renderBody(template, draft.fields)
      setDraft({ ...draft, title: values.title, fields, body: draft.body === generated ? renderBody(template, fields) : draft.body }); setReviewed(false)
    }}>
      <Form.Item name="title" label="合同名称" rules={[{ required: true, whitespace: true, message: '请填写合同名称' }]}><Input maxLength={200} /></Form.Item>
      {template.fields.map(field => <Form.Item key={field.key} name={['fields', field.key]} label={field.label} valuePropName={field.type === 'boolean' ? 'checked' : 'value'} rules={[{ required: field.required, message: `请填写${field.label}` }]}>
        {field.type === 'boolean' ? <Checkbox>是</Checkbox> : field.type === 'number' ? <InputNumber className="commission-full" /> : <Input.TextArea autoSize={{ minRows: 2, maxRows: 6 }} maxLength={10000} />}
      </Form.Item>)}
    </Form><aside className="commission-help"><h3>核对真实约定</h3><p>{template.applicableWhen}</p><p>未知的客户、服务方或金额信息请填写后再发布；系统不会猜测。切换模板后请重新核对条款。</p><h3>所需资料</h3><ul>{template.requiredMaterials.map(item => <li key={item}>{item}</li>)}</ul><p>主合同确定基础约定；补充协议只补充已有生效主合同，不覆盖历史版本。</p></aside></div>}
    {step === 2 && <div className="commission-editor-grid"><section><h3>合同全文</h3><PluginMarkdown className="commission-markdown" content={draft.body} /></section><section><h3>调整正文</h3><p className="commission-muted">修改正文后，不再自动覆盖你的条款；后续字段调整请同步核对正文。</p><Input.TextArea aria-label="合同完整正文" value={draft.body} onChange={event => { setDraft({ ...draft, body: event.target.value }); setReviewed(false) }} rows={22} maxLength={200000} /></section></div>}
    {step === 3 && <section className="commission-review"><h3>{draft.title}</h3><p>{template?.title} · v{template?.version} · {draft.kind === 'MAIN' ? '主合同' : '补充协议'}</p><Alert type="info" showIcon title="发布后冻结当前版本，完成存证后才开放客户确认" description="客户确认合同内容与管理员钱包签名是两个独立步骤。管理员在 Solana 主网签名并承担手续费；此处发布不直接扣费。" /><PluginMarkdown className="commission-markdown" content={draft.body} /><div className="commission-contract-files"><label htmlFor="contract-file-selection">随合同冻结的附件（可选）</label><Select id="contract-file-selection" className="commission-full" mode="multiple" value={fileIds} onChange={value => { setFileIds(value); setReviewed(false) }} options={detail.attachments.filter(file => file.purpose === 'contract').map(file => ({ value: file.id, label: file.name }))} placeholder="选择已上传的合同附件" /><p className="commission-muted">如需添加文件，先保存草稿并返回委托上传合同附件。</p></div><Checkbox checked={reviewed} onChange={event => setReviewed(event.target.checked)}>我已核对当事人、服务范围、费用、交付物、维护约定及完整正文</Checkbox>{!detail.allowedActions.includes('publish-contract') && <Alert type="warning" title="当前阶段不能发布合同" description={detail.commission.stage === 'DRAFT' ? '可先保存合同草稿；请返回委托提交需求，完成需求存证并接单后再发布。' : '请返回委托，处理当前待办或暂停状态后再发布。'} />}{detail.blockers.length > 0 && <Alert type="warning" title="发布前还需处理" description={<ul>{detail.blockers.map(item => <li key={item}>{item}</li>)}</ul>} />}</section>}
    <footer className="commission-footer"><span role="status">{dirty ? '有未保存的修改' : '草稿未发布；发布后需完成存证'}</span><Space wrap>{step > 0 && <Button disabled={saving} onClick={() => setStep(step - 1)}>上一步</Button>}<Button loading={saving && !command.busy} disabled={!draft.templateId || saving} onClick={() => { void save() }}>保存草稿</Button>{step < 3 ? <Button type="primary" disabled={!draft.templateId || saving} onClick={() => { void next() }}>下一步</Button> : <Button type="primary" loading={saving} disabled={!reviewed || !detail.allowedActions.includes('publish-contract')} onClick={() => { void save(true) }}>保存并发布，等待存证</Button>}</Space></footer>
  </section>
}
