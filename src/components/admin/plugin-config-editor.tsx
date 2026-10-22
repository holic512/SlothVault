'use client'
/**
 * @file plugin-config-editor.tsx
 * @project SlothVault
 * @module Plugin Configuration Editor
 * @description Offers localized schema fields and a lossless advanced JSON draft.
 * @logic Keep drafts scoped to one plugin, validate on the server, preserve secrets and block accidental navigation with unsaved changes.
 * @dependencies Ant Design, React Query, next-intl, plugin presentation
 * @index_tags plugins,configuration,form,i18n
 * @author holic512
 */
import { useEffect, useId, useState } from 'react'
import { Alert, App, Button, Form, Input, InputNumber, Select, Switch, Tabs, Typography } from 'antd'
import { useMutation } from '@tanstack/react-query'
import { useLocale, useTranslations } from 'next-intl'
import type { PluginManifest } from '@slothvault/plugin-sdk/protocol'
import { apiFetch, ApiClientError } from '@/lib/api-client'
import { configFields, configDraftFitsFields, configFieldText, configEnumOptions, configEnumSelection, parseConfigDraft, pluginErrorKey } from '@/lib/plugin-presentation'
import styles from '@/styles/modules/plugin-admin.module.css'

export function PluginConfigEditor({ id, manifest, config, installed, onSaved, onDirty }: {
  id: string; manifest: PluginManifest; config: Record<string, unknown>; installed: boolean
  onSaved: () => Promise<void>; onDirty: (dirty: boolean) => void
}) {
  const t = useTranslations('AdminMM.plugins'), locale = useLocale(), { message } = App.useApp()
  const fieldPrefix = useId()
  const incoming = JSON.stringify(config, null, 2)
  const [source, setSource] = useState(incoming)
  const [baseline, setBaseline] = useState(() => JSON.stringify(config, null, 2))
  const [draft, setDraft] = useState(baseline), [mode, setMode] = useState('form')
  const fields = configFields(manifest.configSchema)
  const dirty = draft !== baseline
  if (incoming !== source) {
    setSource(incoming)
    if (!dirty) { setBaseline(incoming); setDraft(incoming) }
  }
  let value: Record<string, unknown> = {}, valid = true
  try { value = parseConfigDraft(draft) } catch { valid = false }
  const formAvailable = !!fields && valid && configDraftFitsFields(fields, value)
  useEffect(() => { onDirty(dirty); return () => onDirty(false) }, [dirty, onDirty])
  useEffect(() => {
    if (!dirty) return
    const prevent = (event: BeforeUnloadEvent) => { event.preventDefault(); event.returnValue = '' }
    window.addEventListener('beforeunload', prevent)
    const navigate = (event: MouseEvent) => {
      const link = event.target instanceof Element ? event.target.closest('a[href]') : null
      if (link && !link.getAttribute('href')?.startsWith('#') && !window.confirm(t('discardDraft'))) { event.preventDefault(); event.stopPropagation() }
    }
    document.addEventListener('click', navigate, true)
    return () => { window.removeEventListener('beforeunload', prevent); document.removeEventListener('click', navigate, true) }
  }, [dirty, t])
  const save = useMutation({
    mutationFn: (text: string) => apiFetch(`/api/admin/mm/plugins/${id}`, { method: 'PATCH', body: JSON.stringify({ config: parseConfigDraft(text) }) }),
    onSuccess: async (_, text) => {
      const saved = parseConfigDraft(text)
      for (const key of manifest.secretFields) if (saved[key]) saved[key] = '••••••••'
      const masked = JSON.stringify(saved, null, 2)
      setBaseline(masked); setDraft(masked); onDirty(false); message.success(t('saved')); await onSaved()
    },
  })
  const issues = save.error instanceof ApiClientError ? (save.error.data as { issues?: { path: (string | number)[] }[] } | null)?.issues ?? [] : []
  const update = (key: string, next: unknown) => { const copy = { ...value }; if (next === undefined || next === null) delete copy[key]; else copy[key] = next; setDraft(JSON.stringify(copy, null, 2)); save.reset() }
  return <div className={styles.editor}>
    <Tabs activeKey={!formAvailable ? 'json' : mode} onChange={setMode} items={[
      { key: 'form', label: t('formMode'), disabled: !formAvailable, children: <Form layout="vertical" disabled={save.isPending || !installed}>
        {fields?.map(([key, field]) => {
          const copy = configFieldText(manifest, key, field, locale)
          const controlId = `${fieldPrefix}-${key}`
          const invalid = issues.some(issue => issue.path[0] === key)
          const required = Array.isArray(manifest.configSchema.required) && manifest.configSchema.required.includes(key)
          const accessibility = { id: controlId, 'aria-required': required, 'aria-invalid': invalid, 'aria-describedby': `${controlId}-help` }
          const help = [copy.description,
            field.minimum !== undefined || field.maximum !== undefined ? t('fieldRange', { min: field.minimum ?? '—', max: field.maximum ?? '—' }) : '',
            field.default !== undefined ? t('fieldDefault', { value: String(field.default) }) : ''].filter(Boolean).join(' ')
          const control = manifest.secretFields.includes(key) ? <Input.Password {...accessibility} autoComplete="new-password" value={String(value[key] ?? '')} onChange={event => update(key, event.target.value)} />
            : field.enum ? <Select {...accessibility} value={configEnumSelection(field.enum, value[key])} allowClear={!required} options={configEnumOptions(field.enum)} onChange={next => update(key, next === undefined ? undefined : field.enum![Number(next)])} />
            : field.type === 'boolean' ? <Switch {...accessibility} checked={value[key] === true} onChange={next => update(key, next)} />
            : field.type === 'number' || field.type === 'integer' ? <InputNumber {...accessibility} className={styles['field-control']} value={typeof value[key] === 'number' ? value[key] as number : null} min={field.minimum} max={field.maximum} precision={field.type === 'integer' ? 0 : undefined} onChange={next => update(key, next)} />
            : <Input {...accessibility} value={String(value[key] ?? '')} placeholder={copy.placeholder} maxLength={field.maxLength} onChange={event => update(key, event.target.value)} />
          return <Form.Item key={key} label={copy.label} htmlFor={controlId} required={required} validateStatus={invalid ? 'error' : undefined}>
            <div className={styles.field}>{control}</div>
            <div id={`${controlId}-help`}>
              {invalid && <Typography.Text type="danger" role="alert">{t('fieldInvalid')}</Typography.Text>}
              {help && <Typography.Paragraph type="secondary">{help}</Typography.Paragraph>}
            </div>
          </Form.Item>
        })}
      </Form> },
      { key: 'json', label: t('advancedJson'), children: <>
        {!formAvailable && valid && <Alert type="info" showIcon title={t('complexSchema')} />}
        <Input.TextArea aria-label={t('config')} rows={14} spellCheck={false} value={draft} disabled={save.isPending || !installed} onChange={event => { setDraft(event.target.value); save.reset() }} />
      </> },
    ]} />
    {!valid && <Alert type="error" showIcon title={t('invalidJson')} />}
    {save.error && <Alert type="error" showIcon title={t(`errors.${pluginErrorKey(save.error)}`)} />}
    <div className={styles['save-bar']}><Typography.Text type="secondary">{dirty ? t('unsaved') : t('schemaNote')}</Typography.Text><Button type="primary" disabled={!installed || !valid || !dirty} loading={save.isPending} onClick={() => save.mutate(draft)}>{t('saveConfig')}</Button></div>
  </div>
}
