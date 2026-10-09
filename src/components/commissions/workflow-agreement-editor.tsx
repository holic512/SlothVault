'use client'
/**
 * @file workflow-agreement-editor.tsx
 * @project SlothVault
 * @module Agreement Draft Editor
 * @description Fills auto-generated Markdown variables alongside explicit business terms.
 * @logic Preview the selected published template and save a draft without publishing or confirming it.
 * @dependencies Ant Design, React Query, simple templates
 * @index_tags commissions,contracts,drafts,preview
 * @author holic512
 */
import { useEffect, useRef, useState } from 'react'
import { useQuery } from '@tanstack/react-query'
import { Alert, Button, Drawer, Form, Input, InputNumber, Select, Space } from 'antd'
import { apiFetch } from '@/lib/api-client'
import { MarkdownView } from '@/components/markdown/markdown-view'
import { renderSimpleTemplate, type SimpleTemplate, type SimpleTemplateVersion, type WorkflowAgreement, type WorkflowDetail } from '@/lib/commission-workflow'
import { formatFen, yuanToFen } from '@/lib/commissions'
import { SimpleFields } from './simple-fields'
import styles from '@/styles/modules/commission-workflow.module.css'

export function WorkflowAgreementEditor({ detail, spec, onClose, onSave, busy }: { detail: WorkflowDetail; spec: { agreement?: WorkflowAgreement; kind: string; commandId: string } | null; onClose: () => void; onSave: (input: Record<string, unknown>) => void; busy: boolean }) {
  const [form] = Form.useForm(), [selected, setVersion] = useState<SimpleTemplateVersion | null>(null)
  const initialized = useRef(false)
  const templates = useQuery({ queryKey: ['simple-templates'], enabled: Boolean(spec), queryFn: () => apiFetch<SimpleTemplate[]>('/api/admin/contract-templates') })
  const values = Form.useWatch([], form) || {}
  const available = templates.data?.filter((template) => template.status === 'ACTIVE').flatMap((template) => template.versions.filter((item) => item.status === 'PUBLISHED').map((item) => ({ ...item, name: template.name }))) || []
  const version = selected || spec?.agreement?.template || available[0] || null
  useEffect(() => {
    if (!spec || !templates.data || initialized.current) return
    initialized.current = true
    const initial = spec.agreement?.template || templates.data.filter((item) => item.status === 'ACTIVE').flatMap((item) => item.versions).find((item) => item.status === 'PUBLISHED') || null
    form.resetFields()
    form.setFieldsValue({ title: spec.agreement?.title || `${detail.title}${spec.kind === 'SUPPLEMENT' ? '补充协议' : '委托合同'}`, totalYuan: spec.agreement?.totalFen ? formatFen(spec.agreement.totalFen) : detail.totalFen ? formatFen(detail.totalFen) : '', maintenanceDays: spec.agreement?.maintenanceDays ?? detail.maintenanceDays, confirmationMode: spec.agreement?.confirmationMode || 'ONLINE', fileKeys: spec.agreement?.fileKeys || [], values: spec.agreement?.values || Object.fromEntries((initial?.fields || []).map((field) => [field.key, field.defaultValue || ''])) })
    // A refreshed workspace must not discard an in-progress draft.
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [spec?.commandId, templates.data, form])
  const filled = { ...values.values, 项目名称: detail.title, 合同金额: values.totalYuan || '另行约定', 维护天数: String(values.maintenanceDays || 15), 确认方式: values.confirmationMode === 'OFFLINE' ? '双方线下确认，由管理员上传依据' : '用户在线确认' }
  let preview = '', previewError = ''
  try { if (version) preview = renderSimpleTemplate(version.body, version.fields, filled) } catch (error) { previewError = (error as Error).message }
  return <Drawer title={spec?.agreement ? '编辑合同草稿' : '生成合同草稿'} open={Boolean(spec)} width="min(1180px, 100vw)" onClose={() => !busy && onClose()} extra={<Button type="primary" loading={busy} disabled={!version} onClick={() => form.submit()}>保存草稿</Button>} destroyOnHidden>
    {templates.error ? <Alert type="error" title={templates.error.message} /> : null}
    {!version ? <Alert type="info" title="请先在合同模板中发布一个模板" /> : <div className={styles['editor-grid']}><Form form={form} layout="vertical" onFinish={(input) => {
      onSave({ action: 'agreement.save', commandId: spec!.commandId, ...(spec?.agreement ? { id: Number(spec.agreement.id) } : {}), templateVersionId: Number(version.id), kind: spec!.kind, title: input.title, totalFen: input.totalYuan ? yuanToFen(String(input.totalYuan)) : null, maintenanceDays: input.maintenanceDays, confirmationMode: input.confirmationMode, fileKeys: input.fileKeys || [], values: filled })
    }}>
      <Form.Item label="使用模板"><Select value={version.id} onChange={(id) => setVersion(available.find((item) => item.id === id)!)} options={available.map((item) => ({ value: item.id, label: `${item.name} · v${item.version}` }))} /></Form.Item>
      <Form.Item name="title" label="合同名称" rules={[{ required: true }]}><Input maxLength={255} /></Form.Item>
      <Space align="start"><Form.Item name="totalYuan" label="合同金额（元，可留空）" rules={[{ validator: async (_, value) => { if (value) yuanToFen(String(value)) } }]}><Input placeholder="例如 5000.00" /></Form.Item><Form.Item name="maintenanceDays" label="维护天数" rules={[{ required: true }]}><InputNumber min={1} max={3650} /></Form.Item></Space>
      <Form.Item name="confirmationMode" label="确认方式"><Select options={[{ value: 'ONLINE', label: '用户在线确认' }, { value: 'OFFLINE', label: '管理员记录线下确认' }]} /></Form.Item>
      <Form.Item name="fileKeys" label="需求、合同细则及补充附件"><Select mode="multiple" options={detail.files.map((file) => ({ value: file.key, label: file.name }))} /></Form.Item>
      <p className={styles.muted}>未填写的变量可以暂存草稿，必填项须在正式发布前补齐。</p>
      <SimpleFields fields={version.fields.filter((field) => !['项目名称', '合同金额', '维护天数', '确认方式'].includes(field.key))} />
    </Form><section className={styles.paper}><h3>合同预览</h3>{previewError ? <Alert type="warning" title={previewError} /> : <MarkdownView content={preview} />}</section></div>}
  </Drawer>
}
