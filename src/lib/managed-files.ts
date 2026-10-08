/**
 * @file managed-files.ts
 * @project SlothVault
 * @module Managed Content References
 * @description Extracts rendered local file references without altering source Markdown or HTML.
 * @logic Parse the same Markdown and sanitized raw HTML as the reader, distinguish inline images from links, and normalize local upload paths.
 * @dependencies unified, remark-parse, remark-gfm, remark-rehype, rehype-raw, rehype-sanitize
 * @index_tags files,markdown,html,references,permissions,immutable-content
 * @author holic512
 */
import { unified } from 'unified'
import remarkParse from 'remark-parse'
import remarkGfm from 'remark-gfm'
import remarkRehype from 'remark-rehype'
import rehypeRaw from 'rehype-raw'
import rehypeSanitize from 'rehype-sanitize'
import { managedUploadPath, isInlineImagePath } from './managed-file-paths'
export { managedUploadPath, isInlineImagePath, contextualFileUrl } from './managed-file-paths'

export type FileUsage = 'READ_MEDIA' | 'DOWNLOAD'
export const FILE_SOURCE_TYPES = ['NOTE_CONTENT', 'PROJECT_HOME', 'PROJECT_MENU', 'ARTICLE', 'SYSTEM_HOMEPAGE', 'PROJECT_AVATAR', 'USER_AVATAR', 'SYSTEM_CONFIG'] as const
export type FileSourceType = typeof FILE_SOURCE_TYPES[number]
export type ManagedFileLink = { filePath: string; usage: FileUsage }

const processor = unified().use(remarkParse).use(remarkGfm)
  .use(remarkRehype, { allowDangerousHtml: true }).use(rehypeRaw).use(rehypeSanitize)
type HtmlNode = { tagName?: string; properties?: Record<string, unknown>; children?: HtmlNode[] }

export function extractManagedFiles(content: string): ManagedFileLink[] {
  if (!content.includes('/uploads/')) return []
  const tree = processor.runSync(processor.parse(content))
  const links = new Map<string, ManagedFileLink>()
  function visit(node: HtmlNode) {
    const value = node.tagName === 'img' ? node.properties?.src : node.tagName === 'a' ? node.properties?.href : null
    if (typeof value === 'string') {
      const filePath = managedUploadPath(value)
      if (filePath) {
        const usage: FileUsage = node.tagName === 'img' && isInlineImagePath(filePath) ? 'READ_MEDIA' : 'DOWNLOAD'
        links.set(`${filePath}:${usage}`, { filePath, usage })
      }
    }
    node.children?.forEach(visit)
  }
  visit(tree as HtmlNode)
  return [...links.values()]
}
