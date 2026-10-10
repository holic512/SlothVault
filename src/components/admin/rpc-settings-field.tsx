'use client'

import { Button, Input, Tag, Tooltip, Typography } from 'antd'
import { useLocale, useTranslations } from 'next-intl'

import { formatAdminDate, formatAdminError } from '@/lib/admin-localization'
import type { SettingsConfigItem } from '@/lib/admin-settings-draft'
import type { RpcNodeTestState } from '@/lib/admin-rpc-test'
import type { RpcConfigKey } from '@/types/admin-rpc'

export function RpcSettingsField({ config, value, dirty, locked, testingDisabled, state, onChange, onTest }: {
  config: SettingsConfigItem & { key: RpcConfigKey }
  value: string
  dirty: boolean
  locked: boolean
  testingDisabled: boolean
  state?: RpcNodeTestState
  onChange: (value: string) => void
  onTest: () => void
}) {
  const t = useTranslations('AdminMM.settings')
  const errorT = useTranslations('AdminMM.errors')
  const locale = useLocale()
  const effectiveValue = config.effectiveValue || ''
  const current = !dirty && state?.endpoint === effectiveValue ? state : undefined
  const result = current?.result
  let color: string | undefined
  let status = t(effectiveValue ? 'rpc.status.idle' : 'rpc.status.unconfigured')
  if (dirty) {
    color = 'warning'
    status = t('rpc.saveFirst')
  } else if (current?.pending) {
    color = 'processing'
    status = t('rpc.status.pending')
  } else if (current?.error) {
    color = 'error'
    status = current.error.message === 'RPC_CONFIGURATION_CHANGED' ? t('rpc.errors.configurationChanged')
      : current.error.message === 'RPC_TEST_REQUEST_TIMEOUT' ? t('rpc.errors.requestTimeout')
        : formatAdminError(current.error, errorT)
  } else if (result) {
    color = result.status === 'success' ? 'success' : result.status === 'unconfigured' ? undefined : 'error'
    status = result.status === 'success' ? t('rpc.status.success', { latency: result.latencyMs ?? 0 })
      : result.status === 'timeout' ? t('rpc.status.timeout')
        : result.status === 'unconfigured' ? t('rpc.status.unconfigured')
          : result.errorCode === 'HTTP_ERROR' ? t('rpc.errors.http', { status: result.httpStatus ?? 0 })
            : t(`rpc.errors.${result.errorCode || 'NETWORK_ERROR'}`)
  }

  const label = t(`rpc.fields.${config.key}`)
  return <div className="settings-field settings-rpc-field">
    <label className="settings-field-label" htmlFor={config.key}>{label}</label>
    <Typography.Text type="secondary">{t(`configDesc.${config.key}`)}</Typography.Text>
    <div className="settings-rpc-control">
      <Input
        id={config.key}
        type="text"
        disabled={locked}
        value={value}
        maxLength={500}
        placeholder={config.defaultValue || t('rpc.placeholder')}
        onChange={(event) => onChange(event.target.value)}
        aria-describedby={`${config.key}-status`}
      />
      <Tooltip title={dirty ? t('rpc.saveFirst') : undefined}>
        <Button
          size="small"
          loading={current?.pending}
          disabled={testingDisabled || dirty || current?.pending || !effectiveValue}
          onClick={onTest}
          aria-label={t('rpc.testNodeLabel', { node: label })}
        >{t('rpc.testNode')}</Button>
      </Tooltip>
    </div>
    <div className="settings-rpc-result" id={`${config.key}-status`} role="status" aria-live="polite">
      <Tooltip title={result ? t('rpc.testedAt', { date: formatAdminDate(locale, result.testedAt) }) : undefined}>
        <Tag className="settings-rpc-status" data-tone={color || 'neutral'} color={color}>{status}</Tag>
      </Tooltip>
      {!dirty && !value && effectiveValue ? <Typography.Text type="secondary">{t('rpc.defaultHint')}</Typography.Text> : null}
    </div>
  </div>
}
