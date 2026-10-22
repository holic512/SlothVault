/**
 * @file redeem.tsx
 * @project SlothVault
 * @module Gift-card Account Contribution
 * @description Hosts redemption on an independent account extension page without owning the core balance or ledger.
 * @logic Redeem through the authenticated plugin API and invalidate the shared account caches.
 * @dependencies Plugin client SDK, host React
 * @index_tags plugins,gift-cards,account,redemption
 * @author holic512
 */
import { App, Button, PluginAccountCard, PluginI18nProvider, Typography, Form, Input, api, invalidateAccount, useMutation, useTranslations } from '@slothvault/plugin-sdk/client'
import { messages } from './messages'

export default function Redeem() {
  return <PluginI18nProvider messages={messages}><RedeemContent /></PluginI18nProvider>
}

function RedeemContent() {
  const t = useTranslations('Plugins.giftCards.redeem'), { message } = App.useApp(), [form] = Form.useForm<{ code: string }>()
  const mutation = useMutation({ mutationFn: (values: { code: string }) => api<{ pointsAdded: number }>('slothvault.gift-cards', 'redeem', { method: 'POST', body: JSON.stringify(values) }), onSuccess: async result => { message.success(t('redeemed', { points: result.pointsAdded })); form.resetFields(); await invalidateAccount() }, onError: () => message.error(t('error')) })
  return <div className="account-route"><Typography.Title level={3}>{t('title')}</Typography.Title><Typography.Paragraph type="secondary">{t('description')}</Typography.Paragraph><PluginAccountCard title={t('redeemTitle')} className="account-route-card"><Form form={form} layout="vertical" onFinish={values => mutation.mutate(values)}><Form.Item name="code" label={t('code')} rules={[{ required: true, message: t('codeRequired') }]}><Input aria-label={t('code')} placeholder="SV-XXXXX-XXXXX-XXXXX-XXXXX" /></Form.Item><Button type="primary" htmlType="submit" loading={mutation.isPending}>{t('redeem')}</Button></Form></PluginAccountCard></div>
}
