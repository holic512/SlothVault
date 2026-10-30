'use client'

/**
 * @file extension-blocks.tsx
 * @project SlothVault
 * @module Markdown Interactive Blocks
 * @description Renders validated charts, counters, motion and accessible layout containers.
 * @logic Keep static content visible, initialize expensive charts near the viewport and dispose browser resources.
 * @dependencies React, ECharts, extension contract, next-intl
 * @index_tags markdown,charts,motion,tabs,accessibility
 * @author holic512
 */
import { Children, isValidElement, useEffect, useId, useMemo, useRef, useState, type ReactNode } from 'react'
import { useTranslations } from 'next-intl'
import { useResolvedAppTheme } from '@/components/providers/app-theme-context'
import { MermaidDiagram } from './mermaid-diagram'
import type { directiveConfiguration } from '@/lib/markdown/processor'
import { parseConfiguration, type ChartConfig, type CounterConfig, type MarkdownFencedExtension } from '@/lib/markdown/contract'

const fencedRenderers = {
  mermaid: MermaidDiagram,
  echarts: ({ source }: { source: string }) => <ConfigurationBlock kind="echarts" source={source} />,
  counter: ({ source }: { source: string }) => <ConfigurationBlock kind="counter" source={source} />,
} satisfies Record<MarkdownFencedExtension, (props: { source: string }) => ReactNode>

export function MarkdownFencedBlock({ kind, source }: { kind: MarkdownFencedExtension; source: string }) {
  const Renderer = fencedRenderers[kind]
  return <Renderer source={source} />
}

export function ExtensionError({ source, message }: { source: string; message: string }) {
  const t = useTranslations('MarkdownExtensions')
  return <div className="sloth-extension-error" role="note"><strong>{t('invalid')}</strong><p>{message}</p><details><summary>{t('source')}</summary><pre><code>{source}</code></pre></details></div>
}
export function ConfigurationBlock({ kind, source }: { kind: 'echarts' | 'counter'; source: string }) {
  const result = useMemo(() => {
    try { return { config: parseConfiguration(kind, source) } }
    catch (error) { return { error: error instanceof Error ? error.message : 'INVALID_CONFIG' } }
  }, [kind, source])
  if (!result.config) return <ExtensionError source={source} message={result.error || 'INVALID_CONFIG'} />
  return kind === 'echarts' ? <ChartBlock config={result.config as ChartConfig} source={source} /> : <CounterBlock config={result.config as CounterConfig} />
}
function ChartBlock({ config, source }: { config: ChartConfig; source: string }) {
  const ref = useRef<HTMLDivElement>(null)
  const theme = useResolvedAppTheme()
  const t = useTranslations('MarkdownExtensions')
  const [result, setResult] = useState<{ source: string; theme: string; status: 'ready' | 'error' }>()
  const current = result?.source === source && result.theme === theme ? result.status : undefined
  const failed = current === 'error'
  const ready = current === 'ready'
  useEffect(() => {
    const element = ref.current!
    let cancelled = false
    let cleanup: (() => void) | undefined
    const draw = async () => {
      try {
        const [core, charts, components, renderers] = await Promise.all([import('echarts/core'), import('echarts/charts'), import('echarts/components'), import('echarts/renderers')])
        if (cancelled) return
        core.use([charts.LineChart, charts.BarChart, charts.PieChart, charts.ScatterChart, charts.RadarChart, components.GridComponent, components.LegendComponent, components.TooltipComponent, components.TitleComponent, components.DatasetComponent, components.AriaComponent, renderers.SVGRenderer])
        const chart = core.init(element, undefined, { renderer: 'svg' })
        cleanup = () => chart.dispose()
        const style = getComputedStyle(element)
        const option = structuredClone(config.option)
        option.textStyle = { color: style.getPropertyValue('--sv-text').trim(), fontFamily: style.fontFamily, ...(option.textStyle as object || {}) }
        option.color ??= [style.getPropertyValue('--sv-primary').trim(), '#5b8fbd', '#71a38b', '#ba9465', '#9b83b5']
        const tooltip = typeof option.tooltip === 'object' && option.tooltip ? option.tooltip : {}
        option.tooltip = { ...tooltip, renderMode: 'richText', confine: true }
        for (const key of ['xAxis', 'yAxis', 'legend']) {
          if (!option[key]) continue
          const values = Array.isArray(option[key]) ? option[key] as Record<string, unknown>[] : [option[key] as Record<string, unknown>]
          const themed = values.map(value => ({
            ...value,
            textStyle: { color: style.getPropertyValue('--sv-text-muted').trim(), ...(value.textStyle as object || {}) },
            ...(key !== 'legend' ? {
              axisLabel: { color: style.getPropertyValue('--sv-text-muted').trim(), ...(value.axisLabel as object || {}) },
              splitLine: { lineStyle: { color: style.getPropertyValue('--sv-border').trim() }, ...(value.splitLine as object || {}) },
            } : {}),
          }))
          option[key] = Array.isArray(option[key]) ? themed : themed[0]
        }
        option.aria = { enabled: true }
        if (matchMedia('(prefers-reduced-motion: reduce)').matches) option.animation = false
        chart.setOption(option, { notMerge: true })
        const observer = new ResizeObserver(() => chart.resize())
        observer.observe(element)
        cleanup = () => { observer.disconnect(); chart.dispose() }
        setResult({ source, theme, status: 'ready' })
      } catch { cleanup?.(); cleanup = undefined; if (!cancelled) setResult({ source, theme, status: 'error' }) }
    }
    const observer = new IntersectionObserver(entries => { if (entries.some(entry => entry.isIntersecting)) { observer.disconnect(); void draw() } }, { rootMargin: '200px' })
    observer.observe(element)
    return () => { cancelled = true; observer.disconnect(); cleanup?.() }
  }, [config, source, theme])
  return <figure className="sloth-chart"><div ref={ref} hidden={failed} style={{ height: config.height }} role="img" aria-label={config.caption || t('chart')} data-chart-ready={ready} />{failed && <ExtensionError source={source} message={t('chartFailed')} />}{!ready && !failed && <p role="status">{t('loading')}</p>}{config.caption && <figcaption>{config.caption}</figcaption>}<details><summary>{t('source')}</summary><pre><code>{source}</code></pre></details></figure>
}
function CounterBlock({ config }: { config: CounterConfig }) {
  const ref = useRef<HTMLOutputElement>(null)
  useEffect(() => {
    const element = ref.current!
    if (matchMedia('(prefers-reduced-motion: reduce)').matches) return
    let frame = 0
    const observer = new IntersectionObserver(entries => {
      if (!entries.some(entry => entry.isIntersecting)) return
      observer.disconnect()
      const start = performance.now()
      const tick = (now: number) => {
        const progress = Math.min(1, (now - start) / config.duration)
        element.textContent = (config.from + (config.to - config.from) * (1 - (1 - progress) ** 3)).toFixed(config.precision) + config.unit
        if (progress < 1) frame = requestAnimationFrame(tick)
      }
      frame = requestAnimationFrame(tick)
    })
    observer.observe(element)
    const print = () => { cancelAnimationFrame(frame); element.textContent = config.to.toFixed(config.precision) + config.unit }
    window.addEventListener('beforeprint', print)
    return () => { observer.disconnect(); cancelAnimationFrame(frame); window.removeEventListener('beforeprint', print) }
  }, [config])
  return <div className="sloth-counter"><span>{config.title}</span><output ref={ref} aria-label={`${config.title}: ${config.to.toFixed(config.precision)}${config.unit}`}>{config.to.toFixed(config.precision)}{config.unit}</output></div>
}
function Motion({ children, config }: { children: ReactNode; config: { effect: string; duration: number; delay: number } }) {
  const ref = useRef<HTMLDivElement>(null)
  useEffect(() => {
    if (matchMedia('(prefers-reduced-motion: reduce)').matches) return
    const element = ref.current!
    const animations: Animation[] = []
    const observer = new IntersectionObserver(entries => {
      if (!entries.some(entry => entry.isIntersecting)) return
      observer.disconnect()
      const targets = config.effect === 'stagger' ? [...element.children] : [element]
      targets.forEach((target, index) => animations.push(target.animate([{ opacity: 0.25, transform: config.effect === 'fade' ? 'none' : 'translateY(16px)' }, { opacity: 1, transform: 'none' }], { duration: config.duration, delay: Math.min(1_000, config.delay + index * 80), easing: 'cubic-bezier(0.16,1,0.3,1)' })))
    })
    observer.observe(element)
    const print = () => animations.forEach(animation => animation.finish())
    window.addEventListener('beforeprint', print)
    return () => { observer.disconnect(); animations.forEach(animation => animation.cancel()); window.removeEventListener('beforeprint', print) }
  }, [config])
  return <div ref={ref} className="sloth-motion">{children}</div>
}
function Tabs({ children }: { children: ReactNode }) {
  const id = useId()
  const [active, setActive] = useState(0)
  const panels = Children.toArray(children).filter(isValidElement<{ attributes?: string; node?: { properties?: { dataMarkdownAttributes?: string } }; 'data-markdown-attributes'?: string; children?: ReactNode }>)
  return <div className="sloth-tabs"><div role="tablist">{panels.map((panel, index) => {
    const title = JSON.parse(panel.props.attributes || panel.props.node?.properties?.dataMarkdownAttributes || panel.props['data-markdown-attributes'] || '{}').title || String(index + 1)
    return <button key={index} type="button" id={`${id}-tab-${index}`} role="tab" aria-selected={active === index} aria-controls={`${id}-panel-${index}`} tabIndex={active === index ? 0 : -1} onClick={() => setActive(index)} onKeyDown={event => {
      const next = event.key === 'Home' ? 0 : event.key === 'End' ? panels.length - 1 : event.key === 'ArrowRight' ? (index + 1) % panels.length : event.key === 'ArrowLeft' ? (index - 1 + panels.length) % panels.length : -1
      if (next >= 0) { event.preventDefault(); setActive(next); document.getElementById(`${id}-tab-${next}`)?.focus() }
    }}>{title}</button>
  })}</div>{panels.map((panel, index) => <div key={index} id={`${id}-panel-${index}`} role="tabpanel" aria-labelledby={`${id}-tab-${index}`} hidden={active !== index} tabIndex={0}>{panel}</div>)}</div>
}
export function ContainerBlock({ name, attributes, error, source, children }: { name: string; attributes: string; error?: string; source?: string; children: ReactNode }) {
  let config: ReturnType<typeof directiveConfiguration>
  try {
    if (error) throw new Error(error)
    config = JSON.parse(attributes) as ReturnType<typeof directiveConfiguration>
  } catch (cause) { return <ExtensionError source={source || ''} message={cause instanceof Error ? cause.message : 'INVALID_EXTENSION'} /> }
    switch (name) {
      case 'motion': return <Motion config={config as { effect: string; duration: number; delay: number }}>{children}</Motion>
      case 'callout': return <aside className={`sloth-callout sloth-callout-${'tone' in config ? config.tone : 'note'}`}>{children}</aside>
      case 'details': return <details className="sloth-disclosure"><summary>{'title' in config ? config.title : ''}</summary>{children}</details>
      case 'columns': return <div className="sloth-content-grid" style={{ gridTemplateColumns: `repeat(${'count' in config ? config.count : 2}, minmax(0, 1fr))` }}>{children}</div>
      case 'timeline': case 'steps': return <div className={`sloth-${name}`}>{children}</div>
      case 'tabs': return <Tabs>{children}</Tabs>
      default: return <div>{children}</div>
    }
}
