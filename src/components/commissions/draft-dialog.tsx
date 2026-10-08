'use client'
/**
 * @file draft-dialog.tsx
 * @project SlothVault
 * @module Commission Template Drafting
 * @description Guides the developer through a versioned template with live legal-document preview.
 * @logic Fill from project and party snapshots, keep scope and price unified, and submit field values rather than a manually assembled body.
 * @dependencies React Query, Ant Design, deterministic templates, shared DTOs
 * @index_tags commissions,contracts,drafts,templates,preview
 * @author holic512
 */
import { useEffect, useState } from 'react'
import { useQuery } from '@tanstack/react-query'
import { Alert, Button, Collapse, Drawer, Form, Select, Space } from 'antd'
import { apiFetch } from '@/lib/api-client'
import { renderContractDocument } from '@/lib/contract-template'
import { beijingDate } from '@/lib/commissions'
import type { CommissionDocumentType } from '@/lib/commissions'
import type { CommissionDetail, CommissionDocumentDto, TemplateDto } from '@/types/commissions'
import { MarkdownView } from '@/components/markdown/markdown-view'
import { TemplateFields } from './template-fields'
export type DraftSpec = { kind: CommissionDocumentType; sourceId?: string; document?: CommissionDocumentDto; commandId?: string }
export function CommissionDraftDialog({ spec, detail, busy, onClose, onSave }: { spec: DraftSpec | null; detail: CommissionDetail; busy: boolean; onClose: () => void; onSave: (payload: Record<string, unknown>) => void }) {
  const [form] = Form.useForm(), [chosen, setChosen] = useState<string | undefined>(), [attachmentSelection, setAttachmentSelection] = useState<string[] | null>(null)
  const attachmentFileIds = attachmentSelection ?? spec?.document?.associatedFiles.map((f) => f.id) ?? detail.files.filter((f) => f.shared && f.purpose === 'REQUIREMENT').map((f) => f.id)
  const templates = useQuery({ queryKey: ['commission-templates'], queryFn: () => apiFetch<TemplateDto[]>('/api/admin/contract-templates'), enabled: Boolean(spec) })
  const versions = (templates.data || []).filter((t) => t.status === 'ACTIVE').flatMap((t) => t.versions.filter((v) => v.status === 'PUBLISHED').map((v) => ({ ...v, name: t.name })))
  const selected = versions.find((v) => v.id === (chosen || spec?.document?.templateVersionId)) || versions[0]
  const versionId = selected?.id
  useEffect(() => {
    if (!spec || !selected) return
    const parties = Object.fromEntries(['Name', 'Identity', 'Phone', 'Email', 'Wechat', 'Address'].flatMap((key) => [['partyA' + key, detail.partyA[key] || ''], ['partyB' + key, detail.partyB[key] || '']]))
    const change = detail.changes.find((c) => c.id === spec.sourceId), acceptance = detail.acceptances.find((a) => a.id === spec.sourceId), delivery = detail.deliveries.find((d) => d.id === acceptance?.deliveryId)
    form.resetFields()
    form.setFieldsValue({ ...selected.defaults, ...parties, payee: detail.partyB.payeeName, payeeAccount: detail.partyB.payeeAccount, payeePlatform: detail.partyB.paymentChannel, supportChannel: detail.partyB.supportChannel, ...detail.documents.find((d) => d.documentType === 'AGREEMENT' && d.status === 2)?.values, contractNumber: detail.commissionId, projectName: detail.title, purpose: detail.purpose, totalFen: detail.quotationFen || undefined, contractDate: beijingDate(new Date()), requirementsDate: beijingDate(new Date()), original: change?.original, proposed: change?.proposed, changeReason: change?.reason, changeFen: change?.feeFen, extensionDays: change?.extensionDays, impact: change?.impact, changeDate: change ? beijingDate(new Date(change.createdAt)) : undefined, changeNumber: change ? `${detail.commissionId}-C${change.id}` : undefined, deliveryVersion: delivery?.version, acceptanceDate: acceptance ? beijingDate(new Date(acceptance.createdAt)) : undefined, deliveredContent: delivery?.items.map((i) => i.label).join('；'), acceptanceBasis: acceptance?.basis, outstanding: acceptance?.outstanding || '无', acceptanceResult: acceptance?.result, ...spec.document?.values })
    // The version selection and document identity are the reset boundary; background refetches keep user input.
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [form, spec, versionId])
  const watched = Form.useWatch([], form)
  let preview = ''
  try { if (selected && spec) preview = renderContractDocument(selected.documents, selected.fields, { ...selected.defaults, ...watched }, spec.kind) } catch (error) { preview = error instanceof Error ? error.message : '请检查模板填写内容' }
  return <Drawer open={Boolean(spec)} title="按模板填写正式文件" size={900} onClose={() => { if (!busy) { setChosen(undefined); onClose() } }} extra={<Button type="primary" loading={busy} disabled={!selected} onClick={() => onSave({ commandId: spec?.commandId, templateVersionId: Number(versionId), documentType: spec!.kind, sourceRecordId: spec?.sourceId ? Number(spec.sourceId) : undefined, documentId: spec?.document ? Number(spec.document.id) : undefined, values: form.getFieldsValue(true), attachmentFileIds: attachmentFileIds.map(Number) })}>保存文件草稿</Button>}>
    {templates.isError ? <Alert type="error" title="模板加载失败" description={String(templates.error)} action={<Button onClick={() => void templates.refetch()}>重试</Button>} /> : null}
    <Space orientation="vertical" style={{ width: '100%' }}>
      <Alert type="info" title="正文与需求附件使用同一份项目数据" description="草稿可以先保存，正式发起时会检查必填项和选项。变更费用及验收结果以对应业务记录为准。" />
      <Select style={{ width: '100%' }} value={versionId} options={versions.map((v) => ({ value: v.id, label: `${v.name} · 版本 ${v.version}` }))} onChange={setChosen} />
      <label>纳入本次确认的关联资料<Select aria-label="本次文件关联资料" mode="multiple" style={{ width: '100%' }} value={attachmentFileIds} onChange={setAttachmentSelection} options={detail.files.filter((f) => f.shared && ['REQUIREMENT', 'TEST'].includes(f.purpose)).map((f) => ({ value: f.id, label: f.originalName }))} /></label>
      {selected && spec ? <Form form={form} layout="vertical"><TemplateFields fields={selected.fields} kind={spec.kind} /></Form> : null}
      <Collapse items={[{ key: 'preview', label: '查看将生成的完整正文', children: <MarkdownView content={preview} /> }]} />
    </Space>
  </Drawer>
}
