#!/usr/bin/env node
/**
 * @file build-package.mjs
 * @project SlothVault
 * @module Knowledge Package Builder
 * @description Deterministically packages a strictly validated knowledge-base JSON file and article Markdown mirrors into the SlothVault ZIP v1 layout.
 * @logic Reject invalid structure, text limits, source evidence, and payload sizes before deriving mirrors and hashes; validate the staged ZIP before atomically publishing it.
 * @dependencies package contract, Node.js filesystem/path APIs, Archiver 7.0.1
 * @index_tags skill, knowledge-package, zip, builder, sha256, markdown
 * @author holic512
 */
import { randomUUID } from 'node:crypto'
import { createWriteStream } from 'node:fs'
import { mkdir, readFile, rename, stat, unlink } from 'node:fs/promises'
import { basename, dirname, resolve } from 'node:path'

import archiver from 'archiver'

import {
  PACKAGE_FORMAT,
  PACKAGE_SCHEMA_VERSION,
  createPayloadEntries,
  sha256,
  validateKnowledgeBase,
  validateKnowledgePackageArchive,
  validateSourceReferencePaths,
} from './package-contract.mjs'

function usage() {
  throw new Error('Usage: node build-package.mjs --input <knowledge-base.json> --source-root <project-directory> --kind <project|article> --output <package.zip>')
}

function argumentsMap(argv) {
  const values = new Map()
  for (let index = 0; index < argv.length; index += 1) {
    const key = argv[index]
    if (!key.startsWith('--')) usage()
    const value = argv[index + 1]
    if (!value || value.startsWith('--')) usage()
    const name = key.slice(2)
    if (!['input', 'source-root', 'kind', 'output'].includes(name) || values.has(name)) usage()
    values.set(name, value)
    index += 1
  }
  return values
}

const options = argumentsMap(process.argv.slice(2))
const inputPath = options.get('input')
const outputPath = options.get('output')
const sourceRoot = options.get('source-root')
const kind = options.get('kind')
if (!inputPath || !outputPath || !sourceRoot || (kind !== 'project' && kind !== 'article')) usage()

const inputBytes = await readFile(resolve(inputPath))
let knowledgeBase
try {
  const inputText = new TextDecoder('utf-8', { fatal: true }).decode(inputBytes)
  knowledgeBase = JSON.parse(inputText)
} catch {
  throw new Error('Input must be valid UTF-8 JSON.')
}
validateKnowledgeBase(knowledgeBase, { kind })
await validateSourceReferencePaths(knowledgeBase, sourceRoot)

const payloadEntries = createPayloadEntries(knowledgeBase)
const manifest = {
  format: PACKAGE_FORMAT,
  schemaVersion: PACKAGE_SCHEMA_VERSION,
  kind,
  createdAt: new Date().toISOString(),
  payloads: payloadEntries.map((entry) => ({
    path: entry.name,
    sha256: sha256(entry.bytes),
    bytes: entry.bytes.length,
  })),
}
const manifestBytes = Buffer.from(`${JSON.stringify(manifest, null, 2)}\n`, 'utf8')

const absoluteOutputPath = resolve(outputPath)
const outputDirectory = dirname(absoluteOutputPath)
const stagedOutputPath = resolve(outputDirectory, `.${basename(absoluteOutputPath)}.${randomUUID()}.tmp`)

await mkdir(outputDirectory, { recursive: true })
try {
  const output = createWriteStream(stagedOutputPath, { flags: 'wx', mode: 0o600 })
  const archive = archiver('zip', { zlib: { level: 9 } })
  const completed = new Promise((resolvePromise, rejectPromise) => {
    output.once('close', resolvePromise)
    output.once('error', rejectPromise)
    archive.once('error', rejectPromise)
    archive.once('warning', rejectPromise)
  })
  archive.pipe(output)
  archive.append(manifestBytes, { name: 'manifest.json', date: new Date(0) })
  for (const entry of payloadEntries) archive.append(entry.bytes, { name: entry.name, date: new Date(0) })
  await archive.finalize()
  await completed

  const archiveBytes = await readFile(stagedOutputPath)
  await validateKnowledgePackageArchive(archiveBytes, { expectedKind: kind, sourceRoot })
  const outputStats = await stat(stagedOutputPath)
  if (outputStats.size !== archiveBytes.length) throw new Error('Staged ZIP size changed during validation.')
  await rename(stagedOutputPath, absoluteOutputPath)
} finally {
  await unlink(stagedOutputPath).catch((error) => {
    if (error?.code !== 'ENOENT') throw error
  })
}

process.stdout.write(`${absoluteOutputPath}\n`)
