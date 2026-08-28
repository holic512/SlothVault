import { createHash } from 'node:crypto'
import { PassThrough } from 'node:stream'

import archiver from 'archiver'
import { describe, expect, it } from 'vitest'

import {
  KNOWLEDGE_PACKAGE_FORMAT,
  parseKnowledgePackage,
} from '@/server/services/knowledge-package'

function digest(value: Buffer) {
  return createHash('sha256').update(value).digest('hex')
}

async function createZip(entries: Array<{ name: string; bytes: Buffer }>) {
  const archive = archiver('zip')
  const output = new PassThrough()
  const chunks: Buffer[] = []
  output.on('data', (chunk: Buffer) => chunks.push(chunk))
  const completed = new Promise<void>((resolve, reject) => {
    output.on('end', resolve)
    output.on('error', reject)
    archive.on('error', reject)
  })
  archive.pipe(output)
  for (const entry of entries) archive.append(entry.bytes, { name: entry.name })
  await archive.finalize()
  await completed
  return Buffer.concat(chunks)
}

function knowledgeBase() {
  return {
    project: { name: 'Demo project', description: '' },
    knowledgeBase: { title: 'Demo knowledge base', summary: '' },
    categories: [{
      id: 'overview',
      title: '项目概览',
      order: 0,
      articles: [{
        id: 'project-overview',
        title: '项目整体介绍',
        slug: 'project-overview',
        summary: '',
        articleType: 'overview',
        tags: ['overview'],
        order: 0,
        sourceReferences: [{ path: 'src/main.ts', symbol: 'bootstrap' }],
        content: '# 项目整体介绍\n\n来自真实源码。',
      }],
    }],
  }
}

async function createPackage(options: { mirror?: string; kind?: 'project' | 'article' } = {}) {
  const data = knowledgeBase()
  const knowledgeBytes = Buffer.from(JSON.stringify(data), 'utf8')
  const articleBytes = Buffer.from(options.mirror ?? data.categories[0].articles[0].content, 'utf8')
  const manifest = {
    format: KNOWLEDGE_PACKAGE_FORMAT,
    schemaVersion: 1,
    kind: options.kind ?? 'project',
    createdAt: '2026-08-28T00:00:00.000Z',
    payloads: [
      { path: 'knowledge-base.json', sha256: digest(knowledgeBytes), bytes: knowledgeBytes.length },
      { path: 'articles/project-overview.md', sha256: digest(articleBytes), bytes: articleBytes.length },
    ],
  }
  return createZip([
    { name: 'manifest.json', bytes: Buffer.from(JSON.stringify(manifest), 'utf8') },
    { name: 'knowledge-base.json', bytes: knowledgeBytes },
    { name: 'articles/project-overview.md', bytes: articleBytes },
  ])
}

describe('knowledge package contract', () => {
  it('accepts a complete project package with verified Markdown mirrors', async () => {
    const parsed = await parseKnowledgePackage(await createPackage())

    expect(parsed.manifest.kind).toBe('project')
    expect(parsed.articleCount).toBe(1)
    expect(parsed.knowledgeBase.categories[0].articles[0].sourceReferences[0].path).toBe('src/main.ts')
  })

  it('rejects an article Markdown mirror that no longer matches structured content', async () => {
    await expect(parseKnowledgePackage(await createPackage({ mirror: '# 被篡改' })))
      .rejects.toThrow('Markdown mirror differs')
  })

  it('rejects a single-article package that contains a full project tree', async () => {
    const data = knowledgeBase()
    data.categories[0].articles.push({
      ...data.categories[0].articles[0],
      id: 'second-article',
      slug: 'second-article',
      title: '第二篇文章',
      order: 1,
    })
    const knowledgeBytes = Buffer.from(JSON.stringify(data), 'utf8')
    const firstArticle = Buffer.from(data.categories[0].articles[0].content, 'utf8')
    const secondArticle = Buffer.from(data.categories[0].articles[1].content, 'utf8')
    const manifest = {
      format: KNOWLEDGE_PACKAGE_FORMAT,
      schemaVersion: 1,
      kind: 'article',
      createdAt: '2026-08-28T00:00:00.000Z',
      payloads: [
        { path: 'knowledge-base.json', sha256: digest(knowledgeBytes), bytes: knowledgeBytes.length },
        { path: 'articles/project-overview.md', sha256: digest(firstArticle), bytes: firstArticle.length },
        { path: 'articles/second-article.md', sha256: digest(secondArticle), bytes: secondArticle.length },
      ],
    }
    const archive = await createZip([
      { name: 'manifest.json', bytes: Buffer.from(JSON.stringify(manifest), 'utf8') },
      { name: 'knowledge-base.json', bytes: knowledgeBytes },
      { name: 'articles/project-overview.md', bytes: firstArticle },
      { name: 'articles/second-article.md', bytes: secondArticle },
    ])

    await expect(parseKnowledgePackage(archive)).rejects.toThrow('exactly one category and one article')
  })
})
