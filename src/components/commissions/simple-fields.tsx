'use client'
import { Form, Input, InputNumber, Select } from 'antd'
import type { SimpleField } from '@/lib/commission-workflow'
export function SimpleFields({ fields, businessReadonly = false }: { fields: SimpleField[]; businessReadonly?: boolean }) {
  return fields.map((field) => {
    const readonly = businessReadonly && ['项目名称', '合同金额', '维护天数', '确认方式'].includes(field.key)
    return <Form.Item key={field.key} name={['values', field.key]} label={field.label} required={field.required}>
      {field.type === 'select' ? <Select disabled={readonly} options={(field.options || []).map((value) => ({ value, label: value }))} /> : field.type === 'multiline' ? <Input.TextArea disabled={readonly} rows={3} maxLength={10000} /> : field.type === 'number' ? <InputNumber disabled={readonly} style={{ width: '100%' }} /> : <Input disabled={readonly} type={field.type === 'date' ? 'date' : 'text'} maxLength={10000} />}
    </Form.Item>
  })
}
