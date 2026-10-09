'use client'
/**
 * @file action-dialog.tsx
 * @project SlothVault
 * @module Commission Action Forms
 * @description Provides small, labelled lifecycle forms for explicit timeline commands and confirmation dates.
 * @logic Keep each dialog focused on one business action and return typed values to the authenticated workspace.
 * @dependencies Ant Design
 * @index_tags commissions,forms,dialogs
 * @author holic512
 */
import { useEffect } from 'react'
import { Form, Input, InputNumber, Modal, Select } from 'antd'
export type ActionField = { key: string; label: string; type?: 'text' | 'textarea' | 'number' | 'select' | 'multi' | 'date'; required?: boolean; options?: Array<{ label: string; value: string | number }>; initial?: unknown }
export type ActionDialogSpec = { title: string; action: string; commandId: string; fields: ActionField[]; initial?: Record<string, unknown>; fixed?: Record<string, unknown> }
export function ActionDialog({ spec, busy, onClose, onSave }: { spec: ActionDialogSpec | null; busy: boolean; onClose: () => void; onSave: (values: Record<string, unknown>) => void }) {
  const [form] = Form.useForm()
  useEffect(() => { if (!spec) return; form.resetFields(); form.setFieldsValue({ ...Object.fromEntries(spec.fields.map((f) => [f.key, f.initial])), ...spec.initial })
    // Field options may load later; only a new operation resets user input.
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [form, spec?.commandId])
  return <Modal open={Boolean(spec)} title={spec?.title} onCancel={() => !busy && onClose()} onOk={() => form.submit()} confirmLoading={busy} destroyOnHidden width={620} okText="保存记录" cancelText="返回">
    <Form form={form} layout="vertical" onFinish={(values) => {
      for (const field of spec?.fields || []) if (field.type === 'date' && values[field.key]) values[field.key] = `${values[field.key]}T00:00:00+08:00`
      onSave({ ...values, ...spec?.fixed, action: spec?.action, commandId: spec?.commandId })
    }}>{spec?.fields.map((field) => <Form.Item key={field.key} name={field.key} label={field.label} rules={field.required ? [{ required: true, message: `请填写${field.label}` }] : []}>
      {field.type === 'textarea' ? <Input.TextArea rows={3} maxLength={10000} /> : field.type === 'number' ? <InputNumber min={0} max={1000000} style={{ width: '100%' }} /> : field.type === 'select' || field.type === 'multi' ? <Select allowClear mode={field.type === 'multi' ? 'multiple' : undefined} options={field.options} /> : field.type === 'date' ? <Input type="date" /> : <Input maxLength={255} />}
    </Form.Item>)}</Form>
  </Modal>
}
