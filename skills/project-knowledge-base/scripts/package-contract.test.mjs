import assert from 'node:assert/strict'
import { execFile as execFileCallback } from 'node:child_process'
import { mkdtemp, mkdir, readFile, rm, writeFile } from 'node:fs/promises'
import { tmpdir } from 'node:os'
import { dirname, join, resolve } from 'node:path'
import { PassThrough } from 'node:stream'
import { promisify } from 'node:util'
import { fileURLToPath } from 'node:url'
import test from 'node:test'

import archiver from 'archiver'
import unzipper from 'unzipper'

import {
  MAX_ARTICLE_CHARACTERS,
  validateKnowledgeBase,
  validateKnowledgePackageArchive,
  validateSourceReferencePaths,
} from './package-contract.mjs'

const execFile = promisify(execFileCallback)
const scriptDirectory = dirname(fileURLToPath(import.meta.url))
const buildScript = resolve(scriptDirectory, 'build-package.mjs')
const validateScript = resolve(scriptDirectory, 'validate-package.mjs')

function knowledgeBase(overrides = {}) {
  const sourceReference = overrides.sourceReference ?? { path: 'src/main.ts', symbol: 'bootstrap' }
  return {
    project: { name: 'Demo', description: '' },
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
        sourceReferences: overrides.sourceReferences ?? [sourceReference],
        content: overrides.content ?? '# 项目整体介绍\n\n来自真实源码。',
      }],
    }],
  }
}

async function createFixture(t) {
  const root = await mkdtemp(join(tmpdir(), 'slothvault-knowledge-skill-'))
  const sourceRoot = join(root, 'source')
  await mkdir(join(sourceRoot, 'src'), { recursive: true })
  await writeFile(join(sourceRoot, 'src/main.ts'), 'export function bootstrap() {}\n')
  t.after(() => rm(root, { recursive: true, force: true }))
  return {
    root,
    sourceRoot,
    inputPath: join(root, 'knowledge-base.json'),
    packagePath: join(root, 'knowledge-package.zip'),
  }
}

async function createZip(entries) {
  const archive = archiver('zip')
  const output = new PassThrough()
  const chunks = []
  output.on('data', (chunk) => chunks.push(chunk))
  const completed = new Promise((resolvePromise, rejectPromise) => {
    output.on('end', resolvePromise)
    output.on('error', rejectPromise)
    archive.on('error', rejectPromise)
  })
  archive.pipe(output)
  for (const entry of entries) archive.append(entry.bytes, { name: entry.name })
  await archive.finalize()
  await completed
  return Buffer.concat(chunks)
}

test('builds and validates a source-grounded project ZIP with the required source root', async (t) => {
  const fixture = await createFixture(t)
  await writeFile(fixture.inputPath, `${JSON.stringify(knowledgeBase(), null, 2)}\n`)

  await execFile(process.execPath, [
    buildScript,
    '--input', fixture.inputPath,
    '--source-root', fixture.sourceRoot,
    '--kind', 'project',
    '--output', fixture.packagePath,
  ])
  const validation = await execFile(process.execPath, [
    validateScript,
    fixture.packagePath,
    '--source-root', fixture.sourceRoot,
  ])

  assert.match(validation.stdout, /Valid knowledge package/)
})

test('rejects missing source references, whitespace-only content, unknown fields, and oversized articles', () => {
  assert.throws(
    () => validateKnowledgeBase(knowledgeBase({ sourceReferences: [] }), { kind: 'project' }),
    /sourceReferences must contain 1 to 500 items/,
  )
  assert.throws(
    () => validateKnowledgeBase(knowledgeBase({ content: ' \n\t ' }), { kind: 'project' }),
    /content cannot be blank/,
  )
  assert.throws(
    () => validateKnowledgeBase({ ...knowledgeBase(), extra: true }, { kind: 'project' }),
    /must contain exactly/,
  )
  assert.throws(
    () => validateKnowledgeBase(knowledgeBase({ sourceReference: { path: '../outside.ts' } }), { kind: 'project' }),
    /parent-directory segments/,
  )
  assert.throws(
    () => validateKnowledgeBase(knowledgeBase({ content: 'a'.repeat(MAX_ARTICLE_CHARACTERS + 1) }), { kind: 'project' }),
    /content must contain 1 to 500000 characters/,
  )
})

test('rejects a source reference that is not a real file inside the chosen source root', async (t) => {
  const fixture = await createFixture(t)
  const data = knowledgeBase({ sourceReference: { path: 'src/missing.ts' } })
  validateKnowledgeBase(data, { kind: 'project' })

  await assert.rejects(
    validateSourceReferencePaths(data, fixture.sourceRoot),
    /does not resolve to a readable file/,
  )
})

test('rejects undocumented files even when the original package payloads are intact', async (t) => {
  const fixture = await createFixture(t)
  await writeFile(fixture.inputPath, `${JSON.stringify(knowledgeBase(), null, 2)}\n`)
  await execFile(process.execPath, [
    buildScript,
    '--input', fixture.inputPath,
    '--source-root', fixture.sourceRoot,
    '--kind', 'project',
    '--output', fixture.packagePath,
  ])

  const directory = await unzipper.Open.buffer(await readFile(fixture.packagePath))
  const entries = await Promise.all(directory.files
    .filter((entry) => entry.type === 'File')
    .map(async (entry) => ({ name: entry.path, bytes: await entry.buffer() })))
  entries.push({ name: 'unexpected.txt', bytes: Buffer.from('not part of the contract') })

  await assert.rejects(
    validateKnowledgePackageArchive(await createZip(entries), { sourceRoot: fixture.sourceRoot }),
    /undocumented files or directories/,
  )
})
