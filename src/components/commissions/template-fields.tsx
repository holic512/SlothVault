'use client'
/**
 * @file template-fields.tsx
 * @project SlothVault
 * @module Typed Contract Forms
 * @description Renders editable contract fields and repeated requirement rows from the frozen template definition.
 * @logic Keep money exact, hide conditional license inputs, and retain draft values across grouped form tabs.
 * @dependencies Ant Design forms, shared template definitions and currency rules
 * @index_tags commissions,templates,forms,requirements
 * @author holic512
 */
import { Button, Checkbox, Form, Input, InputNumber, Select, Space, Tabs } from 'antd'
import { formatFen, yuanToFen } from '@/lib/commissions'
import type { TemplateField } from '@/types/commissions'
import type { CommissionDocumentType } from '@/lib/commissions'
export function MoneyInput({ value, onChange }: { value?: string; onChange?: (value: string | undefined) => void }) {
  return <InputNumber<string> stringMode precision={2} min="0" value={value ? formatFen(value) : undefined} onChange={(next) => onChange?.(next === null ? undefined : yuanToFen(next))} addonBefore="¥" style={{ width: '100%' }} />
}
type Name = string | number | Array<string | number>
function Field({ field, name }: { field: TemplateField; name: Name }) {
  if (field.type === 'rows') return <Form.Item label={field.label} help={field.help}><Form.List name={name}>{(rows, { add, remove }) => <Space orientation="vertical" style={{ width: '100%' }}>
    {rows.map((row) => <div className="commission-form-row" key={row.key}>{field.fields?.map((child) => <Field key={child.key} field={child} name={[row.name, child.key]} />)}<Button danger onClick={() => remove(row.name)}>移除本行</Button></div>)}
    <Button onClick={() => add({ included: false })}>添加清单行</Button>
  </Space>}</Form.List></Form.Item>
  const isPercent = ['startBps', 'progressBps'].includes(field.key)
  const label = isPercent ? `${field.key === 'startBps' ? '启动款' : '进度款'}支付比例（%）` : field.label
  const control = field.type === 'money' ? <MoneyInput /> : field.type === 'multiline' ? <Input.TextArea rows={3} maxLength={10000} /> : field.type === 'date' ? <Input type="date" /> : field.type === 'number' ? <InputNumber min={0} precision={isPercent ? 2 : 0} max={isPercent ? 100 : 1000000} style={{ width: '100%' }} /> : field.type === 'select' || field.type === 'multiselect' ? <Select mode={field.type === 'multiselect' ? 'multiple' : undefined} allowClear options={field.options} /> : field.type === 'boolean' ? <Checkbox>包含</Checkbox> : <Input maxLength={10000} />
  return <Form.Item name={name} label={label} required={field.required} extra={field.help} valuePropName={field.type === 'boolean' ? 'checked' : 'value'} getValueProps={isPercent ? (value) => ({ value: value === undefined ? undefined : Number(value) / 100 }) : undefined} getValueFromEvent={isPercent ? (value) => value === null ? undefined : Math.round(Number(value) * 100) : undefined}>{control}</Form.Item>
}
export function TemplateFields({ fields, kind }: { fields: TemplateField[]; kind: CommissionDocumentType }) {
  const form = Form.useFormInstance(), values = Form.useWatch([], form) || {}
  const visible = fields.filter((field) => (!field.documents || field.documents.includes(kind)) && (!field.when || String(values[field.when.key]) === field.when.value))
  const group = (field: TemplateField) => /^party[AB]/.test(field.key) ? 'parties' : /Fen$|Bps$|Days$|Rounds$|Date$|duration|payee|invoice|support|deploymentCount/.test(field.key) ? 'terms' : /license|ipMode|portfolio|delay|special/.test(field.key) ? 'rights' : 'scope'
  return <Tabs items={[['parties', '双方主体'], ['scope', '项目与交付'], ['terms', '费用与工期'], ['rights', '权利与其他']].map(([key, label]) => ({ key, label, forceRender: true, children: visible.filter((field) => group(field) === key).map((field) => <Field key={field.key} field={field} name={field.key} />) }))} />
}
