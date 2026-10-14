import { mkdirSync, readFileSync, readdirSync, rmSync, writeFileSync } from 'node:fs'
import { performance } from 'node:perf_hooks'
import Database from 'better-sqlite3'
import { PrismaBetterSqlite3 } from '@prisma/adapter-better-sqlite3'
import { PrismaClient as SQLiteClient } from '@generated/prisma-sqlite/client'
import type { AppPrismaClient } from '@/server/database/client'
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest'
import { Client } from '@modelcontextprotocol/sdk/client/index.js'
import { McpServer } from '@modelcontextprotocol/sdk/server/mcp.js'
import { InMemoryTransport } from '@modelcontextprotocol/sdk/inMemory.js'
const fixture = vi.hoisted(() => ({ root: `/tmp/sv-documentation-${process.pid}-${Date.now()}`, client: null as unknown as AppPrismaClient, queries: [] as string[] }))
vi.mock('@/server/prisma', () => ({ get prisma() { return fixture.client } }))
vi.mock('@/server/database/client', () => ({ getDatabaseClient: () => fixture.client, configuredDatabaseProvider: () => 'sqlite', databaseSnapshotIsolationLevel: () => 'Serializable' }))
vi.mock('@/server/services/public-project-cache', () => ({ invalidatePublicProjectCache: vi.fn() }))
import { applyDocumentationDraft, getDocumentationOutline, getManyNoteContents } from './project-documentation'
import { checkDraftProjectVersion, cloneProjectVersion, publishProjectVersion } from './project-version-release'
import { emptyDocumentationState, readDocumentationState } from '@/lib/project-documentation'
import { registerMcpToolDefinitions } from '@/server/mcp/registry'
import { projectDocumentationToolDefinitions } from '@/server/mcp/tools/project-documentation'
import { noteToolDefinitions } from '@/server/mcp/tools/notes'
import { noteContentToolDefinitions } from '@/server/mcp/tools/note-content'
import { exportDatabaseBackup } from './admin-backup/database-export'
import { parseDatabaseImportPayload } from './admin-backup/database-validation'
import { importDatabaseBackup } from './admin-backup/database-import'
import { DATABASE_BACKUP_VERSION } from './admin-backup/constants'
let versionId: number, categoryId: number, projectId: number
let notes: Array<{ id: number; contentId: number }>
const base = { repositoryIdentity: 'github.com/example/repo', version: '1.0.0', commit: 'a'.repeat(40), packageVersions: { 'package.json': '1.0.0' } }
beforeEach(async () => {
  mkdirSync(fixture.root, { recursive: true }); const path = `${fixture.root}/fixture.sqlite`
  const db = new Database(path); db.pragma('foreign_keys = ON')
  for (const name of readdirSync('prisma/providers/sqlite/migrations').filter(name => /^\d/.test(name)).sort()) db.exec(readFileSync(`prisma/providers/sqlite/migrations/${name}/migration.sql`, 'utf8'))
  db.close()
  const client = new SQLiteClient({ adapter: new PrismaBetterSqlite3({ url: `file:${path}` }), log: [{ emit: 'event', level: 'query' }] })
  client.$on('query', event => { fixture.queries.push(event.query) })
  fixture.client = client as unknown as AppPrismaClient
  await fixture.client.user.create({ data: { id: 1, username: 'fixture-admin', password: 'fixture-hash', role: 'ADMIN', status: 1, pointsBalance: 0 } })
  const project = await fixture.client.project.create({ data: { projectName: 'Fixture', weight: 0, status: 1 } }); projectId = project.id
  const version = await fixture.client.projectVersion.create({ data: { projectId, version: '1.0.0', weight: 0, status: 0 } }); versionId = version.id
  const category = await fixture.client.category.create({ data: { projectVersionId: versionId, categoryName: 'Guide', weight: 0, status: 1 } }); categoryId = category.id
  notes = []; const state = emptyDocumentationState(); state.sourceBaseline = base; state.categories = [{ key: 'guide', categoryId: String(categoryId) }]
  for (let i = 1; i <= 40; i++) {
    const note = await fixture.client.noteInfo.create({ data: { categoryId, authorId: 1, noteTitle: `Note ${i}`, weight: 0, status: 1, tagsJson: '["API"]' } })
    const content = await fixture.client.noteContent.create({ data: { noteInfoId: note.id, content: `# Note ${i}\n\n` + 'Useful instructions. '.repeat(100), status: 1, isPrimary: true } })
    notes.push({ id: note.id, contentId: content.id }); state.documents.push({ key: `note-${i}`, noteId: String(note.id), kind: i === 40 ? 'changelog' : 'reference', sourcePaths: ['src/**'], lastContentRevision: 0 })
  }
  await fixture.client.noteContent.update({ where: { id: notes[39].contentId }, data: { content: '# 更新日志\n\n## 1.0.0\n\n首次记录。' } })
  await fixture.client.projectVersion.update({ where: { id: versionId }, data: { documentationStateJson: JSON.stringify(state) } })
  fixture.queries = []
})
afterEach(async () => { await fixture.client?.$disconnect(); rmSync(fixture.root, { recursive: true, force: true }) })
const apply = (expectedRevision: number, changes: unknown[], extra = {}) => applyDocumentationDraft({ projectVersionId: String(versionId), expectedRevision, changes, ...extra }, 1)

describe('project documentation transactions', () => {
  it('upgrades the prior SQLite schema without recreating existing documents', async () => {
    await fixture.client.$disconnect()
    const db = new Database(`${fixture.root}/fixture.sqlite`)
    try {
      db.exec('ALTER TABLE collections_project_version DROP COLUMN documentation_state_json')
      db.exec(readFileSync('prisma/providers/sqlite/migrations/20261014000000_project_documentation/migration.sql', 'utf8'))
      expect(db.prepare('SELECT documentation_state_json AS value FROM collections_project_version').get()).toEqual({ value: null })
      expect(db.prepare('SELECT COUNT(*) AS count FROM docs_note_info').get()).toEqual({ count: 40 })
    } finally { db.close() }
  })

  it('returns a paged lightweight outline, stable keys and actual draft URLs', async () => {
    const result = await getDocumentationOutline(versionId, 1, 2)
    expect(result.total).toBe(40); expect(result.list).toHaveLength(2); expect(result.documentationState.documents).toHaveLength(2)
    expect(result.list[0]).toMatchObject({ key: 'note-1', primaryContentId: String(notes[0].contentId), contentRevision: 0 })
    expect(result.list[0].url).toBe(`/preview/project/${projectId}/v/${versionId}/docs/${notes[0].id}`)
    expect(JSON.stringify(result)).not.toContain('Useful instructions.')
  })
  it('reads selected bodies in requested order, rejects unknown IDs and enforces UTF-8 budgets', async () => {
    expect((await getManyNoteContents([notes[1].contentId, notes[0].contentId])).list.map(item => item.id)).toEqual([String(notes[1].contentId), String(notes[0].contentId)])
    await expect(getManyNoteContents([999999])).rejects.toMatchObject({ status: 404 })
    await fixture.client.noteContent.update({ where: { id: notes[0].contentId }, data: { content: '汉'.repeat(175000) } })
    await expect(getManyNoteContents([notes[0].contentId])).rejects.toMatchObject({ status: 413 })
  })
  it('updates titles without reading bodies and leaves identical batches unchanged', async () => {
    const change = { type: 'note', key: 'note-1', noteTitle: 'Short title' }
    const saved = await apply(0, [change]); expect(saved.documentRevision).toBe(1)
    expect(fixture.queries.some(query => query.includes('docs_note_content') && query.includes('"content"'))).toBe(false)
    fixture.queries = []; const unchanged = await apply(1, [change]); expect(unchanged.changed).toBe(false)
    expect(fixture.queries.some(query => /^(UPDATE|INSERT|DELETE)\b/i.test(query))).toBe(false)
  })
  it('rejects invalid batches and frozen versions before writes', async () => {
    await expect(apply(0, Array.from({ length: 21 }, (_, i) => ({ type: 'note', key: `x-${i}` })))).rejects.toMatchObject({ status: 400 })
    await expect(apply(0, [{ type: 'note', key: 'note-1', content: '汉'.repeat(175000) }])).rejects.toMatchObject({ status: 413 })
    await fixture.client.projectVersion.update({ where: { id: versionId }, data: { publishedAt: new Date() } })
    await expect(apply(0, [])).rejects.toMatchObject({ data: { reason: 'VERSION_FROZEN' } })
  })
  it('rolls back an earlier body write when a later upload reference is invalid', async () => {
    const original = await fixture.client.noteContent.findUniqueOrThrow({ where: { id: notes[0].contentId } })
    await expect(apply(0, [{ type: 'note', key: 'note-1', content: '# Changed' }, { type: 'note', key: 'note-2', content: '![missing](/uploads/not-uploaded.png)' }])).rejects.toThrow()
    expect((await fixture.client.noteContent.findUniqueOrThrow({ where: { id: notes[0].contentId } })).content).toBe(original.content)
    expect((await getDocumentationOutline(versionId, 1, 1)).documentRevision).toBe(0)
  })
  it('rejects cross-version bindings and concurrent revision reuse', async () => {
    const other = await fixture.client.projectVersion.create({ data: { projectId, version: 'other', weight: 0, status: 0 } })
    const category = await fixture.client.category.create({ data: { projectVersionId: other.id, categoryName: 'Other', weight: 0, status: 1 } })
    await expect(apply(0, [{ type: 'category', key: 'foreign', categoryId: String(category.id) }])).rejects.toMatchObject({ data: { reason: 'CATEGORY_VERSION_MISMATCH' } })
    const results = await Promise.allSettled([apply(0, [{ type: 'note', key: 'note-1', noteTitle: 'One' }]), apply(0, [{ type: 'note', key: 'note-2', noteTitle: 'Two' }])])
    expect(results.filter(result => result.status === 'fulfilled')).toHaveLength(1)
    expect(results.filter(result => result.status === 'rejected')).toHaveLength(1)
  })
  it('keeps confirmed baselines until all planned keys and the changelog pass preflight', async () => {
    const target = { ...base, commit: 'b'.repeat(40) }
    const first = await apply(0, [{ type: 'note', key: 'note-1', content: '# Revised' }], { targetBaseline: target, plannedDocumentKeys: ['note-1', 'note-40'] })
    expect(first.documentationState.sourceBaseline?.commit).toBe(base.commit)
    expect((await checkDraftProjectVersion(versionId)).ready).toBe(false)
    await expect(publishProjectVersion(versionId)).rejects.toMatchObject({ data: { reason: 'RELEASE_VALIDATION_FAILED' } })
    await expect(apply(first.documentRevision, [], { finalize: true })).rejects.toMatchObject({ data: { reason: 'DOCUMENTATION_SYNC_INCOMPLETE' } })
    const second = await apply(first.documentRevision, [{ type: 'note', key: 'note-40', content: '# 更新日志\n\n## 1.0.0\n\n修订教程。' }])
    const final = await apply(second.documentRevision, [], { finalize: true })
    expect(final.documentationState.pending).toBeNull(); expect(final.documentationState.sourceBaseline?.commit).toBe(target.commit)
    expect((await checkDraftProjectVersion(versionId)).ready).toBe(true)
  })
  it('does not confirm a baseline from a different version substring or a code example', async () => {
    const first = await apply(0, [{ type: 'note', key: 'note-40', content: '# 更新日志\n\n## 1.0.01\n\nOther version.\n\n```markdown\n## 1.0.0\n```' }], { targetBaseline: base, plannedDocumentKeys: ['note-40'] })
    await expect(apply(first.documentRevision, [], { finalize: true })).rejects.toMatchObject({ data: { reason: 'DOCUMENTATION_CHANGELOG_REQUIRED' } })
    expect((await getDocumentationOutline(versionId, 1, 1)).documentationState.pending).not.toBeNull()
  })

  it('creates a new draft tree atomically and finalizes only with a valid changelog', async () => {
    const version = await fixture.client.projectVersion.create({ data: { projectId, version: '2.0.0', weight: 0, status: 0 } })
    const target = { ...base, version: '2.0.0' }
    const saved = await applyDocumentationDraft({ projectVersionId: String(version.id), expectedRevision: 0, targetBaseline: target, plannedDocumentKeys: ['start', 'changelog'], changes: [
      { type: 'category', key: 'start', categoryName: '开始' },
      { type: 'note', key: 'start', categoryKey: 'start', noteTitle: '快速开始', content: '# 快速开始\n\n实际操作。' },
      { type: 'note', key: 'changelog', categoryKey: 'start', noteTitle: '更新日志', kind: 'changelog', content: '# 更新日志\n\n## 2.0.0\n\n首次记录。' },
    ], finalize: true }, 1)
    expect(saved.results).toHaveLength(3); expect(saved.documentationState.pending).toBeNull()
    expect(saved.documentationState.documents).toHaveLength(2)
  })
  it('clones a revision-locked draft with histories, primary content, tags and remapped keys', async () => {
    await fixture.client.noteContent.create({ data: { noteInfoId: notes[0].id, content: 'Historical body', status: 1, isPrimary: false } })
    const body = `[Read](/preview/project/${projectId}/v/${versionId}/docs/${notes[1].id})`
    await fixture.client.noteContent.update({ where: { id: notes[0].contentId }, data: { content: body } })
    await expect(cloneProjectVersion(versionId, { version: '2.0.0' })).rejects.toMatchObject({ data: { reason: 'VERSION_NOT_PUBLISHED' } })
    await expect(cloneProjectVersion(versionId, { version: '2.0.0', allowDraftSource: true, expectedSourceRevision: 99 })).rejects.toMatchObject({ data: { reason: 'VERSION_WRITE_CONFLICT' } })
    const cloned = await cloneProjectVersion(versionId, { version: '2.0.0', allowDraftSource: true, expectedSourceRevision: 0 })
    const outline = await getDocumentationOutline(Number(cloned.id), 1, 50)
    expect(outline.total).toBe(40); expect(outline.documentationState.clonedFromVersionId).toBe(String(versionId))
    expect(outline.documentationState.documents[0].noteId).not.toBe(String(notes[0].id))
    const copied = await fixture.client.noteContent.findMany({ where: { noteInfoId: Number(outline.documentationState.documents[0].noteId) } })
    expect(copied).toHaveLength(2); expect(copied.filter(item => item.isPrimary)).toHaveLength(1)
    expect(copied.find(item => item.isPrimary)?.content).toContain(`/v/${cloned.id}/docs/${outline.documentationState.documents[1].noteId}`)
    expect(outline.list[0].tags).toEqual(['API'])
    expect((await fixture.client.noteContent.findUniqueOrThrow({ where: { id: notes[0].contentId } })).content).toBe(body)
  })
  it('copies published versions without altering their content hashes or old source bytes', async () => {
    const published = await publishProjectVersion(versionId)
    const cloned = await cloneProjectVersion(versionId, { version: '2.0.0' })
    expect((await getDocumentationOutline(Number(cloned.id), 1, 50)).total).toBe(40)
    expect((await fixture.client.projectVersion.findUniqueOrThrow({ where: { id: versionId } })).releaseHash).toBe(published.releaseHash)
  })
  it('round-trips current and 2.15 backups and remaps documentation IDs on restore', async () => {
    const backup = await exportDatabaseBackup()
    expect(backup.version).toBe(DATABASE_BACKUP_VERSION)
    const parsed = parseDatabaseImportPayload({ version: backup.version, data: backup.data, mode: 'overwrite' })
    expect(readDocumentationState(parsed.data.projectVersions[0].documentationStateJson).documents).toHaveLength(40)
    const old = { ...structuredClone(backup), version: '2.15.0' }
    for (const row of old.data.projectVersions) delete (row as { documentationStateJson?: string | null }).documentationStateJson
    expect(parseDatabaseImportPayload({ version: old.version, data: old.data, mode: 'overwrite' }).data.projectVersions[0].documentationStateJson).toBeNull()
    await importDatabaseBackup(parsed)
    const restored = await fixture.client.projectVersion.findFirstOrThrow()
    const state = readDocumentationState(restored.documentationStateJson)
    expect(state.documents).toHaveLength(40)
    for (const item of state.documents) expect(await fixture.client.noteInfo.findFirst({ where: { id: Number(item.noteId), category: { projectVersionId: restored.id } } })).not.toBeNull()
  })
  it('measures the actual native MCP 40-title workflow without claiming token savings', async () => {
    const server = new McpServer({ name: 'fixture', version: '1.0.0' })
    registerMcpToolDefinitions(server, [...noteToolDefinitions, ...noteContentToolDefinitions, ...projectDocumentationToolDefinitions], { authentication: 'mcp-api-key', apiKeyId: 1, userId: 1, username: 'fixture-admin' })
    const [clientTransport, serverTransport] = InMemoryTransport.createLinkedPair()
    let bytes = 0
    const send = serverTransport.send.bind(serverTransport)
    serverTransport.send = async message => { if ('result' in message && message.result && typeof message.result === 'object' && 'structuredContent' in message.result) bytes += Buffer.byteLength(JSON.stringify(message), 'utf8'); await send(message) }
    const client = new Client({ name: 'fixture', version: '1.0.0' })
    await server.connect(serverTransport); await client.connect(clientTransport)
    const measure = async (operation: () => Promise<void>, calls: number) => { fixture.queries = []; bytes = 0; const start = performance.now(); await operation(); return { calls, sqlQueries: fixture.queries.length, responseBytes: bytes, elapsedMs: Math.round((performance.now() - start) * 1000) / 1000 } }
    try {
      const old = await measure(async () => { for (let i = 0; i < 40; i++) { const result = await client.callTool({ name: 'content.note.update', arguments: { noteId: String(notes[i].id), noteTitle: `Old ${i + 1}` } }); expect(result.isError).not.toBe(true) } }, 40)
      const revision = (await getDocumentationOutline(versionId, 1, 1)).documentRevision
      const optimized = await measure(async () => { for (let batch = 0; batch < 2; batch++) { const result = await client.callTool({ name: 'content.project.version.apply_draft', arguments: { projectVersionId: String(versionId), expectedRevision: revision + batch, changes: Array.from({ length: 20 }, (_, index) => ({ type: 'note', key: `note-${batch * 20 + index + 1}`, noteTitle: `New ${batch * 20 + index + 1}` })) } }); expect(result.isError).not.toBe(true) } }, 2)
      expect(optimized.calls).toBe(2); expect(optimized.sqlQueries).toBeLessThan(old.sqlQueries)
      const oldRead = await measure(async () => { for (const note of notes) {
        const versions = await client.callTool({ name: 'content.note.content.list_versions', arguments: { noteId: String(note.id) } })
        const primary = (versions.structuredContent as { list: Array<{ id: string; isPrimary: boolean }> }).list.find(item => item.isPrimary)!
        const result = await client.callTool({ name: 'content.note.content.get', arguments: { noteContentId: primary.id } }); expect(result.isError).not.toBe(true)
      } }, 80)
      const optimizedRead = await measure(async () => {
        const result = await client.callTool({ name: 'content.project.version.outline', arguments: { projectVersionId: String(versionId), pageSize: 50 } })
        const outline = result.structuredContent as { list: Array<{ primaryContentId: string }> }
        for (let i = 0; i < 2; i++) { const bodies = await client.callTool({ name: 'content.note.content.get_many', arguments: { noteContentIds: outline.list.slice(i * 20, i * 20 + 20).map(note => note.primaryContentId) } }); expect(bodies.isError).not.toBe(true) }
      }, 3)
      expect(optimizedRead.sqlQueries).toBeLessThan(oldRead.sqlQueries)
      const report = { documents: 40, old, optimized, oldRead, optimizedRead, limits: 'Single isolated SQLite run; full JSON-RPC text + structuredContent, not model tokens or production latency.' }
      console.log('DOCUMENTATION_BENCHMARK ' + JSON.stringify(report))
      if (process.env.SLOTHVAULT_DOCUMENTATION_BENCHMARK_PATH) writeFileSync(process.env.SLOTHVAULT_DOCUMENTATION_BENCHMARK_PATH, JSON.stringify(report, null, 2))
    } finally { await client.close(); await server.close() }
  })
})
