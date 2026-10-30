/**
 * @file public-content-links.ts
 * @project SlothVault
 * @module Content Link Presentation
 * @description Converts local content link targets without changing stored publication bytes.
 * @logic Resolve public UUIDs or legacy public aliases with ancestor checks, interpret admin preview integers as internal IDs, and rewrite only rendered link targets.
 * @dependencies Prisma, unified, remark-parse, public content visibility
 * @index_tags public-id,markdown,links,preview,legacy,publication
 * @author holic512
 */
import 'server-only'
import { contentLinkEdits, replaceContentLinks } from '@/lib/markdown-links'
import { prisma } from '@/server/prisma'
import { publicContentIdPattern } from '@/lib/public-content-id'
import { publishedProjectWhere, publishedVersionWhere } from './public-content-ids'

type Audience = { preview?: boolean; projectId?: number; versionId?: number }
export async function presentContentLinks(content: string, audience: Audience = {}) {
  const edits = contentLinkEdits(content)
  const urls = [...new Set(edits.map(edit => edit.url))]
  const replacements = await presentContentUrls(urls, audience)
  return replaceContentLinks(content, edits, replacements)
}

export async function presentContentUrls(urls: string[], audience: Audience = {}) {
  const queries = new Map<string, Promise<string>>()
  const resolve = (url: string) => {
    let result = queries.get(url)
    if (!result) { result = presentUrl(url, audience); queries.set(url, result) }
    return result
  }
  return new Map(await Promise.all(urls.map(async url => [url, await resolve(url)] as const)))
}

function identity(value: string, preview = false) {
  if (publicContentIdPattern.test(value)) return { publicId: value }
  if (/^[1-9]\d{0,9}$/.test(value) && Number(value) <= 2_147_483_647) return preview ? { id: Number(value) } : { legacyUrlId: Number(value) }
  return null
}

async function presentUrl(value: string, audience: Audience): Promise<string> {
  let url: URL
  const origin = process.env.NEXT_PUBLIC_SITE_ORIGIN || 'http://slothvault.local'
  try {
    if (!value.startsWith('/') && !/^https?:\/\//.test(value)) return value
    url = new URL(value, origin)
    if (url.origin !== new URL(origin).origin) return value
  } catch { return value }
  const article = /^\/articles\/([^/]+)$/.exec(url.pathname)
  if (article) {
    const selector = identity(article[1])
    if (!selector) return value
    const row = await prisma.article.findFirst({ where: { ...selector, isDeleted: false, status: 1, publishedAt: { not: null } }, select: { publicId: true } })
    if (row) url.pathname = `/articles/${row.publicId}`
    return row ? url.pathname + url.search + url.hash : value
  }
  if (url.pathname.startsWith('/uploads/')) {
    const raw = url.searchParams.get('projectId'), selector = raw ? identity(raw) : null
    if (!selector) return value
    const project = await prisma.project.findFirst({ where: { ...selector, ...(audience.preview ? { isDeleted: false } : publishedProjectWhere) }, select: { publicId: true } })
    if (!project) return value
    url.searchParams.set('projectId', project.publicId)
    return url.pathname + url.search + url.hash
  }
  const match = /^\/(?:preview\/)?project\/([^/]+)(?:\/v\/([^/]+))?(?:\/(home|docs)(?:\/([^/]+))?)?$/.exec(url.pathname)
  if (!match) return value
  const preview = url.pathname.startsWith('/preview/')
  const projectSelector = identity(match[1], preview), versionSelector = match[2] ? identity(match[2], preview) : null, noteSelector = match[4] ? identity(match[4], preview) : null
  if (!projectSelector || (match[2] && !versionSelector) || (match[4] && !noteSelector)) return value
  const project = await prisma.project.findFirst({ where: { ...projectSelector, ...(audience.preview ? { isDeleted: false } : publishedProjectWhere) }, select: { id: true, publicId: true } })
  if (!project) return value
  let path = `/project/${project.publicId}`
  if (versionSelector) {
    const version = await prisma.projectVersion.findFirst({ where: { ...versionSelector, projectId: project.id, ...(audience.preview ? { isDeleted: false } : publishedVersionWhere) }, select: { id: true, publicId: true } })
    if (!version) return value
    path = audience.preview ? `/preview/project/${project.id}/v/${version.id}` : `${path}/v/${version.publicId}`
    if (noteSelector) {
      const note = await prisma.noteInfo.findFirst({ where: { ...noteSelector, isDeleted: false, status: 1, category: { projectVersionId: version.id, isDeleted: false, status: 1 } }, select: { id: true, publicId: true } })
      if (!note) return value
      path += `/docs/${audience.preview ? note.id : note.publicId}`
    } else if (match[3]) path += `/${match[3]}`
  } else if (audience.preview && project.id === audience.projectId && audience.versionId) {
    path = `/preview/project/${project.id}/v/${audience.versionId}/${match[3] || 'home'}`
  } else if (match[3]) path += `/${match[3]}`
  return path + url.search + url.hash
}
