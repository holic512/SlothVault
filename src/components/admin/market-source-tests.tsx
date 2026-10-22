'use client'
/**
 * @file market-source-tests.tsx
 * @project SlothVault
 * @module Market Source Tests
 * @description Presents independent saved-source probes in the shared administrator settings workspace.
 * @logic Bound requests, keep per-source loading and errors, and discard results after configuration changes.
 * @dependencies React, Ant Design, market types, API client
 * @index_tags admin,settings,market,health
 * @author holic512
 */
import { useEffect, useRef, useState } from 'react'
import { Alert, Button, Descriptions, Space, Typography } from 'antd'
import { useTranslations } from 'next-intl'
import { apiFetch } from '@/lib/api-client'
import { MARKET_SOURCES, type MarketSource, type MarketProbe } from '@/types/market-data'
export function MarketSourceTests({ disabled }: { disabled: boolean }) {
  const t = useTranslations('AdminMM.settings.market')
  const [results, setResults] = useState<Partial<Record<MarketSource, MarketProbe>>>({})
  const [pending, setPending] = useState<Partial<Record<MarketSource, boolean>>>({})
  const controllers = useRef(new Map<MarketSource, AbortController>())
  useEffect(() => { const active = controllers.current; return () => { active.forEach(c => c.abort()); active.clear() } }, [])
  const test = async (source: MarketSource) => {
    if (disabled || controllers.current.has(source)) return
    const controller = new AbortController(); controllers.current.set(source, controller)
    setPending(old => ({ ...old, [source]: true }))
    try {
      const result = await apiFetch<MarketProbe>('/api/admin/mm/config/market/test', { method: 'POST', body: JSON.stringify({ source }), signal: controller.signal })
      if (!controller.signal.aborted) setResults(old => ({ ...old, [source]: result }))
    } catch { if (!controller.signal.aborted) setResults(old => ({ ...old, [source]: { source, ok: false, latencyMs: 0, testedAt: new Date().toISOString(), error: 'PRICE_UNAVAILABLE' } })) }
    finally { controllers.current.delete(source); if (!controller.signal.aborted) setPending(old => ({ ...old, [source]: false })) }
  }
  return <Space orientation="vertical" size="middle">
    <Button disabled={disabled || Object.values(pending).some(Boolean)} onClick={() => void Promise.all(MARKET_SOURCES.map(test))}>{t('testAll')}</Button>
    {disabled ? <Typography.Text type="secondary">{t('saveFirst')}</Typography.Text> : null}
    {MARKET_SOURCES.map(source => <section key={source} aria-label={t(source)}>
      <Space><Typography.Text strong>{t(source)}</Typography.Text><Button size="small" loading={pending[source]} disabled={disabled} onClick={() => void test(source)}>{t('test')}</Button></Space>
      {results[source] ? results[source].ok ? <Descriptions size="small" column={1} items={[
        { key: 'price', label: t('price'), children: results[source].quote?.price },
        { key: 'time', label: t('time'), children: results[source].quote?.observedAt },
        { key: 'latency', label: t('latency'), children: `${results[source].latencyMs} ms` },
      ]} /> : <Alert type="warning" showIcon title={t('failed')} /> : null}
    </section>)}
  </Space>
}
