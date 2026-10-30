/**
 * @file markdown-links.ts
 * @project SlothVault
 * @module Markdown Link Targets
 * @description Locates rendered Markdown and HTML link targets while preserving source bytes elsewhere.
 * @logic Keep raw destination spans separate from decoded URLs and skip code elements and comments.
 * @dependencies unified, remark-parse, remark-gfm, remark-rehype, rehype-raw
 * @index_tags markdown,links,clone,presentation
 * @author holic512
 */
import { unified } from 'unified'
import { createMarkdownParser, remarkMarkdownContainers, rehypeMarkdownMarkers } from './markdown/processor'
import remarkRehype from 'remark-rehype'
import rehypeRaw from 'rehype-raw'

type PositionNode = { type: string; url?: string; tagName?: string; properties?: Record<string, unknown>; position?: { start: { offset?: number }; end: { offset?: number } }; children?: PositionNode[] }
type Edit = { start: number; end: number; url: string; format: 'markdown' | 'angle' | 'html' }
const parser = createMarkdownParser()
const htmlParser = unified().use(remarkMarkdownContainers).use(remarkRehype, { allowDangerousHtml: true }).use(rehypeRaw).use(rehypeMarkdownMarkers)

export function contentLinkEdits(content: string) {
  const edits: Edit[] = []
  const tree = parser.parse(content)
  collectMarkdownEdits(tree as PositionNode, content, edits)
  collectHtmlEdits(htmlParser.runSync(tree) as PositionNode, content, edits)
  return edits
}

export function replaceContentLinks(content: string, edits: Edit[], replacements: ReadonlyMap<string, string>) {
  for (const edit of edits.sort((a, b) => b.start - a.start)) {
    const replacement = replacements.get(edit.url)
    if (replacement === undefined || replacement === edit.url) continue
    const encoded = edit.format === 'html' ? replacement.replace(/&/g, '&amp;').replace(/"/g, '&quot;').replace(/'/g, '&#39;')
      : edit.format === 'markdown' ? replacement.replace(/[\\()]/g, '\\$&').replace(/\s/g, character => encodeURIComponent(character)) : replacement
    content = content.slice(0, edit.start) + encoded + content.slice(edit.end)
  }
  return content
}

function collectMarkdownEdits(node: PositionNode, source: string, edits: Edit[]) {
  const start = node.position?.start.offset, end = node.position?.end.offset
  if (node.url !== undefined && start !== undefined && end !== undefined) {
    const raw = source.slice(start, end)
    let from: number
    if (node.type === 'definition') from = /^ {0,3}\[(?:\\.|[^\]\\])*\]:/.exec(raw)?.[0].length ?? -1
    else if (raw.startsWith('<')) from = 0
    else if (raw.startsWith('[') || raw.startsWith('![')) {
      const lastChildEnd = node.children?.at(-1)?.position?.end.offset
      const marker = raw.indexOf('](', lastChildEnd === undefined ? 0 : lastChildEnd - start)
      from = marker < 0 ? -1 : marker + 2
    } else from = -1
    if (from >= 0) {
      while (/\s/.test(raw[from] ?? '') && from < raw.length) from++
      const angle = raw[from] === '<'
      if (angle) from++
      let to = from, depth = 0
      for (; to < raw.length; to++) {
        const character = raw[to]
        if (character === '\\') { to++; continue }
        if (angle) { if (character === '>') break }
        else {
          if (character === '(') depth++
          else if (character === ')') { if (depth === 0) break; depth-- }
          else if (/\s/.test(character) && depth === 0) break
        }
      }
      edits.push({ start: start + from, end: start + to, url: node.url, format: angle ? 'angle' : 'markdown' })
    }
  }
  for (const child of node.children ?? []) collectMarkdownEdits(child, source, edits)
}

function collectHtmlEdits(node: PositionNode, source: string, edits: Edit[]) {
  if (['pre', 'code', 'script', 'style'].includes(node.tagName ?? '')) return
  const start = node.position?.start.offset
  if (node.type === 'element' && start !== undefined) {
    const tag = /^<[a-z][a-z0-9:-]*(?:[^"'<>]|"[^"]*"|'[^']*')*>/i.exec(source.slice(start))?.[0]
    if (tag) {
      const seen = new Set<string>()
      for (const match of tag.matchAll(/\s+([^\s"'<>/=]+)(?:\s*=\s*(?:"([^"]*)"|'([^']*)'|([^\s"'=<>`]+)))?/g)) {
        const name = match[1].toLowerCase(), url = node.properties?.[name]
        if (!['href', 'src'].includes(name) || seen.has(name) || typeof url !== 'string') continue
        seen.add(name)
        const raw = match[2] ?? match[3] ?? match[4]
        const equal = match[0].indexOf('=') + 1
        const offset = match.index! + equal + match[0].slice(equal).indexOf(raw)
        edits.push({ start: start + offset, end: start + offset + raw.length, url, format: 'html' })
      }
    }
  }
  for (const child of node.children ?? []) collectHtmlEdits(child, source, edits)
}
