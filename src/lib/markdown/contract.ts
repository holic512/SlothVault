/**
 * @file contract.ts
 * @project SlothVault
 * @module Markdown Extension Contract
 * @description Shares extension schemas, limits and presets across authoring, rendering and MCP.
 * @logic Parse bounded data-only configuration and reject executable or network-capable chart options.
 * @dependencies zod
 * @index_tags markdown,extensions,presets,validation
 * @author holic512
 */
import { z } from 'zod'

export const markdownLimits = { content: 500_000, block: 50_000, series: 10, dataItems: 5_000, nesting: 6, minHeight: 240, maxHeight: 800, minDuration: 100, maxDuration: 2_000, maxDelay: 1_000 } as const
export const chartTypes = ['line', 'bar', 'pie', 'scatter', 'radar'] as const
export const markdownFencedExtensions = ['mermaid', 'echarts', 'counter'] as const
export type MarkdownFencedExtension = typeof markdownFencedExtensions[number]
const duration = z.number().int().min(100).max(2_000)
export const chartSchema = z.strictObject({
  version: z.literal(1), height: z.number().int().min(240).max(800).default(360),
  caption: z.string().max(500).default(''), option: z.record(z.string(), z.unknown()),
}).superRefine(({ option }, context) => {
  const series = Array.isArray(option.series) ? option.series : option.series ? [option.series] : []
  if (series.length > markdownLimits.series) context.addIssue({ code: 'custom', message: 'SERIES_LIMIT', path: ['option', 'series'] })
  for (const [index, item] of series.entries()) {
    if (!item || typeof item !== 'object' || !chartTypes.includes((item as { type: typeof chartTypes[number] }).type)) context.addIssue({ code: 'custom', message: 'UNSUPPORTED_SERIES', path: ['option', 'series', index] })
  }
  let items = 0
  const walk = (value: unknown, path: (string | number)[] = [], depth = 0) => {
    if (depth > 30) { context.addIssue({ code: 'custom', message: 'CONFIG_DEPTH', path }); return }
    if (typeof value === 'string' && /(?:image:\/\/|https?:|javascript:|data:|url\s*\()/i.test(value)) context.addIssue({ code: 'custom', message: 'EXTERNAL_RESOURCE', path })
    if (!value || typeof value !== 'object') return
    for (const [key, child] of Object.entries(value)) {
      if (['__proto__', 'prototype', 'constructor', 'formatter', 'renderItem', 'link', 'sublink', 'dataView', 'graphic', 'media', 'baseOption', 'options', 'rich', 'image', 'icon', 'backgroundColor'].includes(key) && (key !== 'backgroundColor' || typeof child !== 'string')) context.addIssue({ code: 'custom', message: 'UNSAFE_OPTION', path: [...path, key] })
      if ((key === 'data' || key === 'source') && Array.isArray(child)) items += child.length
      if (key === 'renderMode' && child !== 'richText') context.addIssue({ code: 'custom', message: 'UNSAFE_OPTION', path: [...path, key] })
      walk(child, [...path, key], depth + 1)
    }
  }
  walk(option)
  if (items > markdownLimits.dataItems) context.addIssue({ code: 'custom', message: 'DATA_LIMIT', path: ['option'] })
})
export const counterSchema = z.strictObject({ version: z.literal(1), title: z.string().max(200), from: z.number().finite().default(0), to: z.number().finite(), unit: z.string().max(40).default(''), precision: z.number().int().min(0).max(6).default(0), duration: duration.default(900) })
const empty = z.strictObject({})
export const directiveSchemas = {
  motion: z.strictObject({ effect: z.enum(['fade', 'fade-up', 'stagger']).default('fade-up'), duration: z.coerce.number().int().min(100).max(2_000).default(600), delay: z.coerce.number().int().min(0).max(1_000).default(0) }),
  callout: z.strictObject({ tone: z.enum(['note', 'warning', 'success']).default('note') }),
  details: z.strictObject({ title: z.string().max(200).default('Details') }),
  columns: z.strictObject({ count: z.coerce.number().int().min(2).max(3).default(2) }),
  timeline: empty, steps: empty, tabs: empty,
  tab: z.strictObject({ title: z.string().min(1).max(100) }),
}
export type DirectiveId = keyof typeof directiveSchemas
export type ChartConfig = z.infer<typeof chartSchema>
export type CounterConfig = z.infer<typeof counterSchema>
export type ExtensionPreset = { id: string; extension: string; category: 'charts' | 'motion' | 'layout'; label: string; source: string }
const chart = (id: string, type: string, extras: Record<string, unknown> = {}): ExtensionPreset => ({ id, extension: 'echarts', category: 'charts', label: id, source: '```echarts\n' + JSON.stringify({ version: 1, height: 360, caption: 'Example data', option: type === 'radar' ? { radar: { indicator: [{ name: 'A', max: 100 }, { name: 'B', max: 100 }, { name: 'C', max: 100 }] }, series: [{ type, data: [{ value: [50, 80, 65], name: 'Example' }] }] } : type === 'pie' ? { series: [{ type, data: [{ name: 'A', value: 40 }, { name: 'B', value: 60 }] }] } : { xAxis: { type: 'category', data: ['A', 'B', 'C'] }, yAxis: { type: 'value' }, series: [{ type, data: [20, 45, 32], ...extras }, ...(id === 'stacked' ? [{ type, stack: 'total', data: [12, 25, 18] }] : [])] } }, null, 2) + '\n```' })
export const markdownPresets: ExtensionPreset[] = [
  chart('line', 'line'), chart('area', 'line', { areaStyle: {} }), chart('bar', 'bar'), chart('stacked', 'bar', { stack: 'total' }), chart('pie', 'pie'), chart('scatter', 'scatter'), chart('radar', 'radar'),
  { id: 'counter', extension: 'counter', category: 'motion', label: 'counter', source: '```counter\n' + JSON.stringify({ version: 1, title: 'Example', from: 0, to: 128, unit: '', precision: 0, duration: 900 }, null, 2) + '\n```' },
  ...(['fade', 'fade-up', 'stagger'] as const).map(effect => ({ id: effect, extension: 'motion', category: 'motion' as const, label: effect, source: `:::motion{effect="${effect}" duration="600" delay="0"}\n\n{{selection}}\n\n:::` })),
  ...Object.entries({ callout: ':::callout{tone="note"}\n\n{{selection}}\n\n:::', details: ':::details{title="Details"}\n\n{{selection}}\n\n:::', columns: ':::columns{count="2"}\n\n{{selection}}\n\nSecond column\n\n:::', timeline: ':::timeline\n\n- First milestone\n- Second milestone\n\n:::', steps: ':::steps\n\n1. First step\n2. Second step\n\n:::', tabs: '::::tabs\n\n:::tab{title="First"}\n\n{{selection}}\n\n:::\n\n:::tab{title="Second"}\n\nSecond panel\n\n:::\n\n::::' }).map(([id, source]) => ({ id, extension: id, category: 'layout' as const, label: id, source })),
  { id: 'mermaid', extension: 'mermaid', category: 'charts', label: 'mermaid', source: '```mermaid\nflowchart LR\n  A[Start] --> B[End]\n```' },
]
export function parseConfiguration(id: 'echarts' | 'counter', source: string) {
  if (source.length > markdownLimits.block) throw new Error('BLOCK_LIMIT')
  return (id === 'echarts' ? chartSchema : counterSchema).parse(JSON.parse(source))
}
export function markdownCapabilities(extensionId?: string) {
  const schemas = { echarts: chartSchema, counter: counterSchema, ...directiveSchemas }
  const extensions: { id: string; syntax: string; schema: Record<string, unknown>; presets: ExtensionPreset[]; fallback: string }[] = Object.entries(schemas).map(([id, schema]) => ({ id, syntax: id === 'echarts' || id === 'counter' ? `fenced:${id}` : `container:${id}`, schema: z.toJSONSchema(schema, { unrepresentable: 'any' }), presets: markdownPresets.filter(p => p.extension === id), fallback: 'Local diagnostic and escaped source; surrounding document remains readable.' }))
  extensions.push({ id: 'mermaid', syntax: 'fenced:mermaid', schema: z.toJSONSchema(z.string().max(50_000)), presets: markdownPresets.filter(p => p.extension === 'mermaid'), fallback: 'Escaped source on loading or failure.' })
  return { version: '1.0.0', limits: markdownLimits, chartTypes, restrictions: ['JSON only; no functions, formatter, custom series, external resources, HTML dataView or links.', 'Chart validation also enforces series/data limits and forbidden fields beyond JSON Schema.'], images: { thumbnail: 'Managed images only; variant=markdown-thumbnail; WebP 1280px quality 80; first animation frame.', original: 'Store original URL; load on preview; identical current read authorization.' }, extensions: extensionId ? extensions.filter(e => e.id === extensionId) : extensions }
}
