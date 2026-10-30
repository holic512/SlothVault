/**
 * @file processor.ts
 * @project SlothVault
 * @module Markdown Extension Parsing
 * @description Maps Markdown containers to inert block markers and exposes shared static diagnostics.
 * @logic Preserve source positions and Markdown children for rendering, file references and link rewrites.
 * @dependencies unified, remark-directive, extension contract
 * @index_tags markdown,ast,directives,mcp
 * @author holic512
 */
import { unified, type Plugin } from 'unified'
import type { Root } from 'mdast'
import type { Root as HastRoot } from 'hast'
import remarkParse from 'remark-parse'
import remarkGfm from 'remark-gfm'
import remarkDirective from 'remark-directive'
import { directiveSchemas, markdownLimits, parseConfiguration, type DirectiveId } from './contract'

type Node = { type: string; name?: string; lang?: string | null; value?: string; attributes?: Record<string, string>; children?: Node[]; data?: Record<string, unknown>; position?: { start: { line: number; column: number; offset?: number }; end: { offset?: number } } }
export type MarkdownIssue = { level: 'error' | 'warning'; code: string; line: number; column: number; extensionId: string; message: string }
export function createMarkdownParser() { return unified().use(remarkParse).use(remarkGfm).use(remarkDirective) }

export function directiveConfiguration(name: string, attributes: Record<string, unknown>, depth: number, parent?: string) {
  if (!Object.hasOwn(directiveSchemas, name)) throw new Error('UNKNOWN_EXTENSION')
  if (depth > markdownLimits.nesting) throw new Error('NESTING_LIMIT')
  if (name === 'tab' && parent !== 'tabs') throw new Error('TAB_OUTSIDE_TABS')
  return directiveSchemas[name as DirectiveId].parse(attributes)
}

export const remarkMarkdownContainers: Plugin<[], Root> = () => {
  return (root, file) => {
    const tree = root as unknown as Node
    const source = String(file.value)
    const markers = new Map<number, string>()
    file.data.markdownContainerMarkers = markers
    const visit = (node: Node, depth: number, parent?: string) => {
      const container = node.type === 'containerDirective'
      if (container || node.type === 'leafDirective' || node.type === 'textDirective') {
        const raw = source.slice(node.position?.start.offset, node.position?.end.offset)
        let error: string | undefined
        let config: ReturnType<typeof directiveConfiguration> = {}
        try {
          if (!container) throw new Error('CONTAINER_REQUIRED')
          config = directiveConfiguration(node.name!, node.attributes || {}, depth + 1, parent)
          if (node.name === 'tabs' && node.children?.some(child => child.type !== 'containerDirective' || child.name !== 'tab')) throw new Error('TABS_REQUIRE_TAB_CHILDREN')
        } catch (cause) { error = cause instanceof Error ? cause.message : 'INVALID_EXTENSION' }
        if (!container) { node.type = 'text'; node.value = raw; delete node.children; return }
        if (node.position?.start.offset !== undefined) markers.set(node.position.start.offset, node.name!)
        node.data = { ...node.data, hName: 'div', hProperties: { 'dataMarkdownBlock': node.name, 'dataMarkdownAttributes': JSON.stringify(config), 'dataMarkdownDepth': depth + 1, 'dataMarkdownParent': parent || '', ...(error ? { 'dataMarkdownError': error, 'dataMarkdownSource': raw } : {}) } }
        if (error) node.children = [{ type: 'text', value: raw }]
      }
      node.children?.forEach(child => visit(child, container ? depth + 1 : depth, container ? node.name : parent))
    }
    visit(tree, 0)
  }
}

export function validateMarkdown(content: string) {
  const issues: MarkdownIssue[] = []
  if (content.length > markdownLimits.content) issues.push({ level: 'error', code: 'CONTENT_LIMIT', line: 1, column: 1, extensionId: '', message: 'CONTENT_LIMIT' })
  const tree = createMarkdownParser().parse(content) as Node
  const visit = (node: Node, depth: number, parent?: string) => {
    let error: string | undefined
    const id = node.type === 'code' ? node.lang || '' : node.name || ''
    try {
      if (node.type === 'code' && (id === 'echarts' || id === 'counter')) parseConfiguration(id, node.value || '')
      if (node.type === 'code' && id === 'mermaid' && (node.value?.length || 0) > markdownLimits.block) throw new Error('BLOCK_LIMIT')
      if (node.type.endsWith('Directive')) {
        if (node.type !== 'containerDirective') throw new Error('CONTAINER_REQUIRED')
        directiveConfiguration(id, node.attributes || {}, depth + 1, parent)
        if (id === 'tabs' && node.children?.some(child => child.type !== 'containerDirective' || child.name !== 'tab')) throw new Error('TABS_REQUIRE_TAB_CHILDREN')
      }
    } catch (cause) { error = cause instanceof Error ? cause.message : 'INVALID_EXTENSION' }
    if (error) issues.push({ level: 'error', code: error.startsWith('[') ? 'INVALID_CONFIG' : error, message: error, line: node.position?.start.line || 1, column: node.position?.start.column || 1, extensionId: id })
    node.children?.forEach(child => visit(child, node.type === 'containerDirective' ? depth + 1 : depth, node.type === 'containerDirective' ? id : parent))
  }
  visit(tree, 0)
  return { valid: !issues.some(i => i.level === 'error'), issues }
}

/** Raw HTML cannot impersonate the private markers created by the directive AST. */
export const rehypeMarkdownMarkers: Plugin<[], HastRoot> = () => (tree, file) => {
  const markers = file.data.markdownContainerMarkers as Map<number, string> | undefined
  const visit = (node: { properties?: Record<string, unknown>; position?: { start: { offset?: number } }; children?: unknown[] }) => {
    if (node.properties) {
      const offset = node.position?.start.offset
      const trusted = typeof node.properties.dataMarkdownBlock === 'string' && offset !== undefined && markers?.get(offset) === node.properties.dataMarkdownBlock
      if (!trusted) for (const key of Object.keys(node.properties)) if (key.startsWith('dataMarkdown')) delete node.properties[key]
    }
    node.children?.forEach(child => visit(child as Parameters<typeof visit>[0]))
  }
  visit(tree)
}
