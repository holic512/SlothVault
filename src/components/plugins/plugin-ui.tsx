'use client'
/**
 * @file plugin-ui.tsx
 * @project SlothVault
 * @module Lazy Plugin UI Runtime
 * @description Renders authorized native React contributions with shared contexts and per-contribution error boundaries.
 * @logic Fetch safe metadata, load only requested entries, pin registrations to script digests, and remove scoped styles after unmount.
 * @dependencies React, React Query, plugin protocol types, lazy host facade
 * @index_tags plugins,ui,slots,lazy,error-boundary
 * @author holic512
 */
import { Component, useEffect, useState, type ComponentType, type ReactNode } from 'react'
import { useQuery, useQueryClient } from '@tanstack/react-query'
import { useLocale } from 'next-intl'
import Link from 'next/link'
import { usePathname } from 'next/navigation'
import type { PluginUi } from '@slothvault/plugin-sdk/protocol'
import type { PluginComponentProps } from '@slothvault/plugin-sdk/client'
import { apiFetch } from '@/lib/api-client'
type Host = ReturnType<typeof import('./ui-facade')['createUiFacade']> & { register(id: string, key: string, component: ComponentType<PluginComponentProps>): void }
declare global { interface Window { SlothVaultPluginHost?: Host } }
const components = new Map<string, ComponentType<PluginComponentProps>>()
const loads = new Map<string, Promise<void>>()
const keyOf = (ui: PluginUi) => `${ui.pluginId}/${ui.digest}/${ui.key}`
export function usePluginContributions(surface: 'admin' | 'account' | 'public') {
  return useQuery({ queryKey: ['plugin-contributions', surface], queryFn: ({ signal }) => apiFetch<PluginUi[]>(`/api/plugins/contributions?surface=${surface}`, { signal }), staleTime: 15_000, retry: false, refetchOnWindowFocus: true, refetchInterval: 30_000 })
}
export function pluginPageHref(ui: PluginUi) { return `${ui.surface === 'admin' ? '/admin/mm' : ui.surface === 'account' ? '/account' : ''}/extensions/${ui.pluginId}${ui.path ? '/' + ui.path : ''}` }
export function PluginMenuLinks({ surface, onNavigate }: { surface: 'account' | 'public'; onNavigate?: () => void }) {
  const query = usePluginContributions(surface), locale = useLocale(), pathname = usePathname()
  return query.data?.filter(ui => ui.kind === 'page' && ui.menu).map(ui => <Link key={keyOf(ui)} href={pluginPageHref(ui)} className={pathname === pluginPageHref(ui) ? 'is-active' : ''} onClick={onNavigate}>{locale === 'zh' ? ui.titleZh ?? ui.title : ui.title}</Link>)
}
class PluginBoundary extends Component<{ children: ReactNode }, { failed: boolean }> {
  state = { failed: false }
  static getDerivedStateFromError() { return { failed: true } }
  componentDidCatch() { console.error('[plugins] UI contribution failed') }
  render() { return this.state.failed ? <div role="alert">Plugin UI unavailable / 插件界面暂不可用</div> : this.props.children }
}
export function PluginContribution({ contribution, path }: { contribution: PluginUi; path?: string[] }) {
  const queryClient = useQueryClient(), [loaded, setLoaded] = useState<{ key: string; View: ComponentType<PluginComponentProps> } | null>(null), [errorKey, setErrorKey] = useState<string | null>(null)
  useEffect(() => {
    let active = true; let style: HTMLLinkElement | undefined
    const load = async () => {
      if (!window.SlothVaultPluginHost) {
        const { createUiFacade } = await import('./ui-facade')
        window.SlothVaultPluginHost ??= { ...createUiFacade(queryClient), register(id, key, component) {
          const script = document.currentScript as HTMLScriptElement | null
          const digest = script?.dataset.pluginDigest
          if (digest && script.dataset.pluginId === id && (typeof component === 'function' || (component !== null && typeof component === 'object'))) {
            components.set(`${id}/${digest}/${key}`, component)
            if (components.size > 128) { const oldest = components.keys().next().value!; components.delete(oldest); loads.delete(oldest) }
          }
        } }
      }
      const key = keyOf(contribution)
      if (!loads.has(key)) {
        const promise = new Promise<void>((resolve, reject) => {
          const script = document.createElement('script')
          script.src = `/api/plugins/assets/${encodeURIComponent(contribution.pluginId)}/${contribution.digest}/${contribution.asset}`
          script.dataset.pluginDigest = contribution.digest; script.dataset.pluginId = contribution.pluginId; script.async = true
          script.onload = () => { script.remove(); if (!components.has(key)) reject(new Error('Plugin did not register its component')); else resolve() }
          script.onerror = () => { script.remove(); reject(new Error('Plugin script failed to load')) }
          document.head.appendChild(script)
        }).catch(error => { loads.delete(key); throw error })
        loads.set(key, promise)
      }
      await loads.get(key)
      if (!active) return
      if (contribution.css) { style = document.createElement('link'); style.rel = 'stylesheet'; style.href = `/api/plugins/assets/${contribution.pluginId}/${contribution.digest}/${contribution.css}`; document.head.appendChild(style) }
      setLoaded({ key, View: components.get(key)! })
    }
    void load().catch(() => { if (active) setErrorKey(keyOf(contribution)) })
    return () => { active = false; style?.remove() }
  }, [contribution, queryClient])
  if (errorKey === keyOf(contribution)) return <div role="alert">Plugin UI unavailable / 插件界面暂不可用</div>
  if (!loaded || loaded.key !== keyOf(contribution)) return <span aria-busy="true" />
  const { View } = loaded
  return <PluginBoundary key={keyOf(contribution)}><div data-sv-plugin={contribution.pluginId} className={contribution.kind === 'page' ? `plugin-page-host plugin-page-host--${contribution.surface}` : 'plugin-slot-host'}><View pluginId={contribution.pluginId} componentKey={contribution.key} path={path} /></div></PluginBoundary>
}
export function PluginSlot({ name, surface }: { name: string; surface: 'admin' | 'account' | 'public' }) {
  const query = usePluginContributions(surface)
  return <>{query.data?.filter(ui => ui.kind === 'slot' && ui.slot === name).map(ui => <PluginContribution key={keyOf(ui)} contribution={ui} />)}</>
}
export function PluginPageView({ pluginId, surface, path = [] }: { pluginId: string; surface: 'admin' | 'account' | 'public'; path?: string[] }) {
  const query = usePluginContributions(surface)
  const pages = query.data?.filter(ui => ui.pluginId === pluginId && ui.kind === 'page')
  const match = pages?.find(ui => ui.path === path.join('/')) ?? pages?.find(ui => !ui.path)
  if (query.isPending) return <div aria-busy="true" />
  if (!match) return <div role="alert">Plugin is disabled, unavailable, or access is denied. / 插件已禁用、不可用或无访问权限。</div>
  return <PluginContribution contribution={match} path={path} />
}
