import { WebStandardStreamableHTTPServerTransport } from '@modelcontextprotocol/sdk/server/webStandardStreamableHttp.js'
import { Client } from '@modelcontextprotocol/sdk/client/index.js'
import { StreamableHTTPClientTransport } from '@modelcontextprotocol/sdk/client/streamableHttp.js'
import { NextRequest } from 'next/server'
import { beforeEach, describe, expect, it, vi } from 'vitest'

const mocks = vi.hoisted(() => ({
  health: vi.fn(), findMcpKey: vi.fn(), touchMcpKey: vi.fn(), verifyPassword: vi.fn(),
  createAdminProject: vi.fn(), getAdminProject: vi.fn(), listAdminProjects: vi.fn(),
  updateAdminProjectMetadataFromMcp: vi.fn(), createAdminProjectVersion: vi.fn(),
  updateAdminProjectVersion: vi.fn(), publishProjectVersion: vi.fn(), setProjectVersionVisibility: vi.fn(),
  publishAdminArticle: vi.fn(), withdrawAdminArticle: vi.fn(),
  getAdminProjectVersion: vi.fn(), listAdminProjectVersions: vi.fn(),
  createAdminCategory: vi.fn(), listAdminCategories: vi.fn(), updateAdminCategory: vi.fn(),
  createAdminNote: vi.fn(), getAdminNote: vi.fn(), listAdminNotes: vi.fn(), updateAdminNote: vi.fn(),
  listAdminNoteTags: vi.fn(), addAdminNoteTag: vi.fn(), removeAdminNoteTag: vi.fn(), renameAdminNoteTag: vi.fn(),
  createAdminNoteContent: vi.fn(), getAdminNoteContent: vi.fn(),
  listAdminNoteContentVersions: vi.fn(), updateAdminNoteContent: vi.fn(),
  checkDraftProjectVersion: vi.fn(), cloneProjectVersion: vi.fn(),
  getProjectVersionIntegrity: vi.fn(), getProjectVersionManifest: vi.fn(),
  createAdminArticle: vi.fn(), getAdminArticle: vi.fn(),
  listAdminArticles: vi.fn(), updateAdminArticle: vi.fn(),
  createProjectHome: vi.fn(), createProjectMenu: vi.fn(), createSystemHomepage: vi.fn(),
  getProjectHome: vi.fn(), getProjectMenu: vi.fn(), getSystemHomepage: vi.fn(),
  listProjectHomes: vi.fn(), listProjectMenus: vi.fn(), updateProjectHome: vi.fn(),
  updateProjectMenu: vi.fn(), updateSystemHomepage: vi.fn(),
  getAdminFile: vi.fn(), listAdminFiles: vi.fn(), uploadAdminFileBuffer: vi.fn(),
  readManagedFile: vi.fn(), managedFileContentType: vi.fn(),
  getAdminDashboard: vi.fn(), listAdminSettings: vi.fn(),
  getManagedUser: vi.fn(), listGiftCardBatches: vi.fn(),
  listUserPointTransactions: vi.fn(), listUsers: vi.fn(),
  getManagedUserMembership: vi.fn(), listMembershipLevels: vi.fn(),
  createWorkflow: vi.fn(), getWorkflow: vi.fn(), listWorkflows: vi.fn(), executeWorkflowCommand: vi.fn(), listSimpleTemplates: vi.fn(),
  createAdminContract: vi.fn(), getAdminContract: vi.fn(), listAdminContracts: vi.fn(),
  readAuthorizedContractAttachment: vi.fn(),
  getAdminReleaseEvidence: vi.fn(), listReleaseEvidence: vi.fn(),
  getSystemUpdateInfo: vi.fn(),
}))

vi.mock('@/server/database/runtime-health', () => ({ readRuntimeInstallationPublicStatus: mocks.health }))
vi.mock('@/server/prisma', () => ({ prisma: { mcpApiKey: { findUnique: mocks.findMcpKey, updateMany: mocks.touchMcpKey } } }))
vi.mock('@/server/auth/password', () => ({ verifyPassword: mocks.verifyPassword }))

vi.mock('@/server/services/admin-catalog', () => ({
  createAdminProject: mocks.createAdminProject,
  getAdminProject: mocks.getAdminProject,
  listAdminProjects: mocks.listAdminProjects,
  updateAdminProjectMetadataFromMcp: mocks.updateAdminProjectMetadataFromMcp,
  createAdminProjectVersion: mocks.createAdminProjectVersion,
  updateAdminProjectVersion: mocks.updateAdminProjectVersion,
  getAdminProjectVersion: mocks.getAdminProjectVersion,
  listAdminProjectVersions: mocks.listAdminProjectVersions,
  createAdminCategory: mocks.createAdminCategory,
  listAdminCategories: mocks.listAdminCategories,
  updateAdminCategory: mocks.updateAdminCategory,
  parseJsonDecimalId(value: unknown, label: string) {
    if (typeof value !== 'string' || !/^\d+$/.test(value)) throw new Error(`Invalid ${label}`)
    return Number(value)
  },
}))

vi.mock('@/server/services/admin-notes', () => ({
  createAdminNote: mocks.createAdminNote,
  getAdminNote: mocks.getAdminNote,
  listAdminNotes: mocks.listAdminNotes,
  updateAdminNote: mocks.updateAdminNote,
  createAdminNoteContent: mocks.createAdminNoteContent,
  getAdminNoteContent: mocks.getAdminNoteContent,
  listAdminNoteContentVersions: mocks.listAdminNoteContentVersions,
  updateAdminNoteContent: mocks.updateAdminNoteContent,
}))

vi.mock('@/server/services/admin-note-tags', () => ({
  listAdminNoteTags: mocks.listAdminNoteTags,
  addAdminNoteTag: mocks.addAdminNoteTag,
  removeAdminNoteTag: mocks.removeAdminNoteTag,
  renameAdminNoteTag: mocks.renameAdminNoteTag,
}))

vi.mock('@/server/services/project-version-release', () => ({
  checkDraftProjectVersion: mocks.checkDraftProjectVersion,
  cloneProjectVersion: mocks.cloneProjectVersion,
  publishProjectVersion: mocks.publishProjectVersion,
  setProjectVersionVisibility: mocks.setProjectVersionVisibility,
  getProjectVersionIntegrity: mocks.getProjectVersionIntegrity,
  getProjectVersionManifest: mocks.getProjectVersionManifest,
}))

vi.mock('@/server/services/admin-articles', () => ({
  createAdminArticle: mocks.createAdminArticle,
  publishAdminArticle: mocks.publishAdminArticle,
  withdrawAdminArticle: mocks.withdrawAdminArticle,
  getAdminArticle: mocks.getAdminArticle,
  listAdminArticles: mocks.listAdminArticles,
  updateAdminArticle: mocks.updateAdminArticle,
}))

vi.mock('@/server/services/admin-content', () => ({
  createProjectHome: mocks.createProjectHome,
  createProjectMenu: mocks.createProjectMenu,
  createSystemHomepage: mocks.createSystemHomepage,
  getProjectHome: mocks.getProjectHome,
  getProjectMenu: mocks.getProjectMenu,
  getSystemHomepage: mocks.getSystemHomepage,
  listProjectHomes: mocks.listProjectHomes,
  listProjectMenus: mocks.listProjectMenus,
  updateProjectHome: mocks.updateProjectHome,
  updateProjectMenu: mocks.updateProjectMenu,
  updateSystemHomepage: mocks.updateSystemHomepage,
}))

vi.mock('@/server/services/admin-files', () => ({
  AVATAR_FILE_MAX_BYTES: 2 * 1024 * 1024,
  GENERAL_FILE_MAX_BYTES: 10 * 1024 * 1024,
  getAdminFile: mocks.getAdminFile,
  listAdminFiles: mocks.listAdminFiles,
  uploadAdminFileBuffer: mocks.uploadAdminFileBuffer,
  readManagedFile: mocks.readManagedFile,
  managedFileContentType: mocks.managedFileContentType,
}))

vi.mock('@/server/services/admin-dashboard', () => ({
  getAdminDashboard: mocks.getAdminDashboard,
}))

vi.mock('@/server/services/admin-settings', () => ({
  listAdminSettings: mocks.listAdminSettings,
}))

vi.mock('@/server/services/points', () => ({
  getManagedUser: mocks.getManagedUser,
  listGiftCardBatches: mocks.listGiftCardBatches,
  listUserPointTransactions: mocks.listUserPointTransactions,
  listUsers: mocks.listUsers,
}))

vi.mock('@/server/services/membership', () => ({
  getManagedUserMembership: mocks.getManagedUserMembership,
  listMembershipLevels: mocks.listMembershipLevels,
}))

vi.mock('@/server/commissions/workflow', () => ({ createWorkflow: mocks.createWorkflow, getWorkflow: mocks.getWorkflow, listWorkflows: mocks.listWorkflows, executeWorkflowCommand: mocks.executeWorkflowCommand }))
vi.mock('@/server/commissions/simple-templates', () => ({ listSimpleTemplates: mocks.listSimpleTemplates }))

vi.mock('@/server/services/contracts', () => ({
  createAdminContract: mocks.createAdminContract,
  getAdminContract: mocks.getAdminContract,
  listAdminContracts: mocks.listAdminContracts,
  readAuthorizedContractAttachment: mocks.readAuthorizedContractAttachment,
}))

vi.mock('@/server/services/release-evidence', () => ({
  getAdminReleaseEvidence: mocks.getAdminReleaseEvidence,
  listReleaseEvidence: mocks.listReleaseEvidence,
}))

vi.mock('@/server/services/system-update', () => ({
  getSystemUpdateInfo: mocks.getSystemUpdateInfo,
}))

import { createAdminMcpServer } from '@/server/mcp/server'
import { HttpError } from '@/server/http/errors'
import { POST, GET, DELETE } from '@/app/mcp/route'
import { ADMIN_MCP_INSTRUCTIONS } from '@/server/mcp/server'

const principal = {
  authentication: 'mcp-api-key' as const,
  apiKeyId: 4,
  userId: 7,
  username: 'admin',
}
const timestamp = new Date('2026-09-14T00:00:00.000Z')

function project(overrides: Record<string, unknown> = {}) {
  return {
    id: '9', projectName: 'Documentation', avatar: null, weight: 2, status: 1,
    readAccess: { mode: 'PUBLIC', membershipLevelIds: [], membershipLevels: [] },
    downloadAccess: { mode: 'FOLLOW_READ', membershipLevelIds: [], membershipLevels: [] },
    requireAuth: false, createdAt: timestamp, updatedAt: timestamp, isDeleted: false,
    ...overrides,
  }
}

function note(overrides: Record<string, unknown> = {}) {
  return {
    id: '31', categoryId: '21', authorId: '7', noteTitle: 'Getting Started', tags: [],
    weight: 0, status: 1, createdAt: timestamp, updatedAt: timestamp, isDeleted: false,
    category: { id: '21', categoryName: 'Guide', projectVersionId: '11' },
    ...overrides,
  }
}

function mcpRequest(message: Record<string, unknown>) {
  return new Request('http://localhost/mcp', {
    method: 'POST',
    headers: {
      accept: 'application/json, text/event-stream',
      'content-type': 'application/json',
      'mcp-protocol-version': '2025-11-25',
    },
    body: JSON.stringify(message),
  })
}

async function handle(message: Record<string, unknown>) {
  const server = createAdminMcpServer(principal)
  const transport = new WebStandardStreamableHTTPServerTransport({
    sessionIdGenerator: undefined,
    enableJsonResponse: true,
  })
  await server.connect(transport)
  try {
    return await transport.handleRequest(mcpRequest(message))
  } finally {
    await transport.close()
    await server.close()
  }
}

type McpJsonResponse = {
  result: {
    serverInfo: { name: string; version: string }
    tools: Array<{ name: string; inputSchema?: unknown; outputSchema?: unknown }>
    prompts: Array<{ name: string }>
    resourceTemplates: Array<{ name: string; uriTemplate: string }>
    structuredContent: {
      list: Array<Record<string, unknown>>
      grants: Array<Record<string, unknown>>
    }
    isError?: boolean
    content: Array<{ text: string }>
    contents: Array<{
      uri: string
      mimeType?: string
      blob?: string
      _meta?: Record<string, unknown>
    }>
    messages: Array<{ content: { text: string } }>
  }
}

async function resultOf(message: Record<string, unknown>) {
  const response = await handle(message)
  return response.json() as Promise<McpJsonResponse>
}

describe('administrator MCP server', () => {
  it('keeps bodies out of list schemas and both wire outputs, and measures list/detail payloads', async () => {
    const article = { id: '12', title: 'Article', summary: null, cover: null, content: '正文示例'.repeat(5_000), status: 1,
      allowedMembershipLevelIds: [], allowedMembershipLevels: [], requiredMembershipLevelId: null,
      requiredMembershipLevel: null, publishedAt: timestamp, createdAt: timestamp, updatedAt: timestamp, isDeleted: false }
    const oldList = { list: Array.from({ length: 20 }, (_, index) => ({ ...article, id: String(index + 1) })), page: 1, pageSize: 20, total: 20 }
    // Feed a full legacy DTO to prove that both SDK outputs honor the new list contract.
    mocks.listAdminArticles.mockResolvedValue(oldList)
    const listed = await resultOf({ jsonrpc: '2.0', id: 81, method: 'tools/call', params: { name: 'content.article.list', arguments: {} } })
    expect(listed.result.isError).not.toBe(true)
    expect(listed.result.structuredContent.list).toHaveLength(20)
    for (const item of listed.result.structuredContent.list) expect(item).not.toHaveProperty('content')
    expect(JSON.parse(listed.result.content[0].text)).toEqual(listed.result.structuredContent)
    expect(JSON.stringify(listed)).not.toContain(article.content)
    mocks.getAdminArticle.mockResolvedValue(article)
    const detail = await resultOf({ jsonrpc: '2.0', id: 82, method: 'tools/call', params: { name: 'content.article.get', arguments: { articleId: '12' } } })
    expect(detail.result.structuredContent).toMatchObject(JSON.parse(JSON.stringify(article)))
    expect(JSON.parse(detail.result.content[0].text)).toEqual(detail.result.structuredContent)
    const discovered = await resultOf({ jsonrpc: '2.0', id: 83, method: 'tools/list', params: {} })
    const listTool = discovered.result.tools.find(tool => tool.name === 'content.article.list')!
    expect(JSON.stringify(listTool.outputSchema)).not.toContain('"content"')
    const legacy = { jsonrpc: '2.0', id: 81, result: { content: [{ type: 'text', text: JSON.stringify(oldList) }], structuredContent: oldList } }
    const bytes = (value: unknown) => Buffer.byteLength(JSON.stringify(value))
    const before = bytes(legacy), after = bytes(listed), detailBytes = bytes(detail)
    expect(after / before).toBeLessThan(0.1)
    expect((after + detailBytes) / before).toBeLessThan(0.15)
    process.stdout.write('[article-payload-benchmark] ' + JSON.stringify({ articles: 20, charactersPerBody: article.content.length,
      oldListBytes: before, newListBytes: after, newListPlusOneDetailBytes: after + detailBytes,
      listReductionPercent: Number(((1 - after / before) * 100).toFixed(2)), oldLocateAndReadCalls: 1, newLocateAndReadCalls: 2 }) + '\n')
  })

  it('publishes the 5.0 identity and the complete safe daily-management tool registry', async () => {
    const initialize = await resultOf({
      jsonrpc: '2.0', id: 1, method: 'initialize',
      params: {
        protocolVersion: '2025-11-25', capabilities: {},
        clientInfo: { name: 'vitest', version: '1.0.0' },
      },
    })
    expect(initialize).toMatchObject({
      result: { serverInfo: { name: 'slothvault-admin-mcp', version: '5.0.0' } },
    })

    const listed = await resultOf({ jsonrpc: '2.0', id: 2, method: 'tools/list', params: {} })
    const names = listed.result.tools.map((tool: { name: string }) => tool.name)
    expect(names).toEqual([
      'content.project.list', 'content.project.get', 'content.project.create', 'content.project.update',
      'content.project.version.list', 'content.project.version.get', 'content.project.version.create_draft',
      'content.project.version.clone', 'content.project.version.check_draft',
      'content.project.version.integrity', 'content.project.version.manifest',
      'content.project.version.update', 'content.project.version.publish', 'content.project.version.set_visibility',
      'content.category.list', 'content.category.create', 'content.category.update',
      'content.note.list', 'content.note.get', 'content.note.create', 'content.note.update',
      'content.note.tag.list', 'content.note.tag.add', 'content.note.tag.rename', 'content.note.tag.remove',
      'content.note.content.list_versions', 'content.note.content.get',
      'content.note.content.create_draft', 'content.note.content.update_draft',
      'content.note.content.set_primary', 'content.note.content.update_metadata',
      'content.article.list', 'content.article.get', 'content.article.create', 'content.article.update', 'content.article.publish', 'content.article.withdraw',
      'content.project.home.list', 'content.project.home.get', 'content.project.home.create',
      'content.project.home.update', 'content.project.menu.list', 'content.project.menu.get',
      'content.project.menu.create', 'content.project.menu.update',
      'content.homepage.get', 'content.homepage.create', 'content.homepage.update',
      'content.file.list', 'content.file.get', 'content.file.upload',
      'admin.dashboard.get', 'admin.user.list', 'admin.user.get',
      'admin.membership.level.list', 'admin.user.membership.get',
      'admin.points.transaction.list', 'admin.gift_card.batch.list',
      'admin.contract.list', 'admin.contract.get', 'admin.contract.attachment.get',
      'admin.evidence.list', 'admin.evidence.get', 'admin.settings.get', 'admin.system.update.get',
      'admin.commission.list', 'admin.commission.get', 'admin.commission.create', 'admin.commission.update', 'admin.commission.document.draft.create', 'admin.contract-template.list',
    ])
    expect(names).not.toContain('admin_project_list')
    expect(names.some((name: string) =>
      /(?:^|\.)(?:delete|restore|password|adjust|issue|submit|reconcile|reset|backup)(?:\.|$)/.test(name),
    )).toBe(false)
    expect(listed.result.tools.every((tool: { inputSchema?: unknown }) => tool.inputSchema)).toBe(true)
    expect(listed.result.tools.every((tool: { outputSchema?: unknown }) => tool.outputSchema)).toBe(true)
  })

  it('creates only a template draft with the authenticated administrator and refuses raw issuance', async () => {
    const record = { id: '9', publicId: 'SV-test', title: 'Development', subject: 'customer', stage: 'ACCEPTED', progress: 0, revision: 2, paused: false, paymentPercent: 0, updatedAt: timestamp, bindingStatus: 'CLAIMED', nextAction: '准备合同', archived: false, requirements: '需求', totalFen: null, confirmationMode: 'ONLINE', maintenanceDays: 15, maintenanceStartedAt: null, maintenanceEndsAt: null, maintenanceClosedAt: null, maintenanceCloseReason: '', allowedActions: ['agreement.save'], events: [], agreements: [], files: [], issues: [] }
    mocks.executeWorkflowCommand.mockResolvedValue(record)
    const args = { commissionId: '9', templateVersionId: '1', title: '合同草稿', kind: 'AGREEMENT', revision: 1, commandId: '0c4e9e9e-4ac6-4dc6-9600-696c8898d777', values: { 委托方: '测试客户' }, totalFen: '10000' }
    const called = await resultOf({ jsonrpc: '2.0', id: 71, method: 'tools/call', params: { name: 'admin.commission.document.draft.create', arguments: args } })
    expect(called.result.isError).not.toBe(true)
    expect(mocks.executeWorkflowCommand).toHaveBeenCalledWith(9, { userId: 7, isAdmin: true }, { action: 'agreement.save', templateVersionId: 1, title: args.title, kind: 'AGREEMENT', revision: 1, commandId: args.commandId, values: args.values, totalFen: '10000', maintenanceDays: 15, confirmationMode: 'ONLINE', fileKeys: [] })
    const invalid = await resultOf({ jsonrpc: '2.0', id: 72, method: 'tools/call', params: { name: 'admin.commission.document.draft.create', arguments: { ...args, issuerUserId: '99' } } })
    expect(invalid.result.isError).toBe(true)
    expect(mocks.executeWorkflowCommand).toHaveBeenCalledTimes(1)
    const retired = await resultOf({ jsonrpc: '2.0', id: 73, method: 'tools/call', params: { name: 'admin.contract.issue', arguments: {} } })
    expect(retired.result.isError).toBe(true)
    const removed = await resultOf({ jsonrpc: '2.0', id: 74, method: 'tools/call', params: { name: 'admin.commission.progress.update', arguments: {} } })
    expect(removed.result.isError).toBe(true)
    expect(mocks.executeWorkflowCommand).toHaveBeenCalledTimes(1)
  })

  it('delegates administrator publication and returns the refreshed version', async () => {
    const version = { id: '11', projectId: '9', version: 'v1', description: null, weight: 0, status: 1,
      releaseId: 'release', releaseHash: 'a'.repeat(64), manifestVersion: 2, publishedAt: timestamp,
      createdAt: timestamp, updatedAt: timestamp, isDeleted: false, isEmpty: false }
    mocks.publishProjectVersion.mockResolvedValue(version)
    mocks.getAdminProjectVersion.mockResolvedValue(version)
    const called = await resultOf({ jsonrpc: '2.0', id: 60, method: 'tools/call', params: {
      name: 'content.project.version.publish', arguments: { projectVersionId: '11' },
    } })
    expect(mocks.publishProjectVersion).toHaveBeenCalledWith(11)
    expect(called.result.structuredContent).toMatchObject({ id: '11', manifestVersion: 2, isEmpty: false })
    await resultOf({ jsonrpc: '2.0', id: 61, method: 'tools/call', params: {
      name: 'content.project.version.set_visibility', arguments: { projectVersionId: '11', status: 0 },
    } })
    expect(mocks.setProjectVersionVisibility).toHaveBeenCalledWith(11, 0)
  })

  it('supports article publication and withdrawal through registered tools', async () => {
    const article = { id: '12', title: 'Article', summary: null, cover: null, content: '# Body', status: 1,
      allowedMembershipLevelIds: [], allowedMembershipLevels: [], requiredMembershipLevelId: null, requiredMembershipLevel: null, publishedAt: timestamp,
      createdAt: timestamp, updatedAt: timestamp, isDeleted: false }
    mocks.publishAdminArticle.mockResolvedValue(article)
    mocks.withdrawAdminArticle.mockResolvedValue({ ...article, status: 0 })
    for (const [action, status] of [['publish', 1], ['withdraw', 0]] as const) {
      const called = await resultOf({ jsonrpc: '2.0', id: 62, method: 'tools/call', params: {
        name: `content.article.${action}`, arguments: { articleId: '12' },
      } })
      expect(called.result.structuredContent).toMatchObject({ id: '12', status })
    }
    expect(mocks.publishAdminArticle).toHaveBeenCalledWith(12)
    expect(mocks.withdrawAdminArticle).toHaveBeenCalledWith(12)
  })

  it('publishes protected managed-file and contract-attachment resource templates', async () => {
    const listed = await resultOf({ jsonrpc: '2.0', id: 21, method: 'resources/templates/list', params: {} })
    expect(listed.result.resourceTemplates).toEqual([
      expect.objectContaining({ name: 'managed-file', uriTemplate: 'slothvault://managed-file/{id}' }),
      expect.objectContaining({ name: 'contract-attachment', uriTemplate: 'slothvault://contract-attachment/{contractId}' }),
    ])

    mocks.readManagedFile.mockResolvedValue({
      file: { originalName: 'guide.md', businessType: 'Markdown', status: 1 },
      buffer: Buffer.from('# Guide'),
    })
    mocks.managedFileContentType.mockReturnValue('text/markdown; charset=utf-8')
    const read = await resultOf({
      jsonrpc: '2.0', id: 22, method: 'resources/read',
      params: { uri: 'slothvault://managed-file/44' },
    })
    expect(read.result.contents).toEqual([expect.objectContaining({
      uri: 'slothvault://managed-file/44',
      mimeType: 'text/markdown; charset=utf-8',
      blob: Buffer.from('# Guide').toString('base64'),
      _meta: { 'slothvault/file-name': 'guide.md' },
    })])
  })

  it.each(['ArticleImage', 'ArticleAttachment', 'NoteImage', 'NoteAttachment'])('discovers and accepts the explicit %s upload category', async (businessType) => {
    const file = { id: '44', originalName: businessType.endsWith('Image') ? 'image.png' : 'source.zip', fileName: 'fixture', filePath: 'uploads/fixture/file', fileSize: '4', businessType, status: 1, createTime: timestamp }
    mocks.uploadAdminFileBuffer.mockResolvedValue(file)
    const called = await resultOf({ jsonrpc: '2.0', id: 23, method: 'tools/call', params: {
      name: 'content.file.upload', arguments: { originalName: file.originalName, businessType, contentBase64: Buffer.from('test').toString('base64') },
    } })
    expect(called.result.isError).not.toBe(true)
    expect(called.result.structuredContent).toMatchObject({ businessType, resourceUri: 'slothvault://managed-file/44', filePath: file.filePath })
    expect(mocks.uploadAdminFileBuffer).toHaveBeenLastCalledWith({ originalName: file.originalName, businessType, buffer: Buffer.from('test') })
  })

  it('exposes actionable unavailable-file paths through MCP body-write errors', async () => {
    mocks.updateAdminNoteContent.mockRejectedValueOnce(new HttpError('Upload referenced files before saving content', 409, 409, { reason: 'MANAGED_FILE_UNAVAILABLE', filePaths: ['uploads/note-attachment/missing.zip'] }))
    const called = await resultOf({ jsonrpc: '2.0', id: 24, method: 'tools/call', params: {
      name: 'content.note.content.update_draft', arguments: { noteContentId: '41', content: '[source](/uploads/note-attachment/missing.zip)' },
    } })
    expect(called.result.isError).toBe(true)
    expect(JSON.parse(called.result.content[0].text)).toMatchObject({ error: { status: 409, data: { reason: 'MANAGED_FILE_UNAVAILABLE', filePaths: ['uploads/note-attachment/missing.zip'] } } })
  })

  it('rejects invalid Base64 before delegating a file upload', async () => {
    mocks.uploadAdminFileBuffer.mockClear()
    const rejected = await resultOf({
      jsonrpc: '2.0', id: 23, method: 'tools/call',
      params: {
        name: 'content.file.upload',
        arguments: { originalName: 'guide.md', businessType: 'Markdown', contentBase64: 'not-base64' },
      },
    })
    expect(rejected.result.isError).toBe(true)
    expect(rejected.result).not.toHaveProperty('structuredContent')
    expect(mocks.uploadAdminFileBuffer).not.toHaveBeenCalled()
  })

  it('delegates project listing and returns validated structured content', async () => {
    mocks.listAdminProjects.mockResolvedValue({
      list: [project({ latestVersion: 'v1', latestVersionId: '11', categoryCount: 2 })],
      page: 2, pageSize: 5, total: 1,
    })
    const called = await resultOf({
      jsonrpc: '2.0', id: 3, method: 'tools/call',
      params: { name: 'content.project.list', arguments: { page: 2, pageSize: 5, keyword: ' Docs ' } },
    })

    expect(mocks.listAdminProjects).toHaveBeenCalledWith({
      page: 2, pageSize: 5, skip: 5, keyword: 'Docs',
      status: undefined, orderByField: 'updatedAt', order: 'desc',
    })
    expect(called.result).toMatchObject({
      structuredContent: {
        list: [{ id: '9', projectName: 'Documentation', createdAt: timestamp.toISOString() }],
      },
    })
  })

  it('returns administrator user reads with string role values', async () => {
    const user = {
      id: '8',
      username: 'alice',
      email: 'alice@example.com',
      displayName: 'Alice',
      role: 'USER',
      status: 1,
      pointsBalance: 80,
      walletAddress: null,
      createdAt: timestamp,
      currentMembership: null,
      activeMemberships: [],
    }
    mocks.listUsers.mockResolvedValue({ list: [user], total: 1 })
    mocks.getManagedUser.mockResolvedValue(user)

    const listed = await resultOf({
      jsonrpc: '2.0', id: 31, method: 'tools/call',
      params: {
        name: 'admin.user.list',
        arguments: { page: 1, pageSize: 20, keyword: 'alice' },
      },
    })
    const detail = await resultOf({
      jsonrpc: '2.0', id: 32, method: 'tools/call',
      params: { name: 'admin.user.get', arguments: { userId: '8' } },
    })

    expect(listed.result.isError).not.toBe(true)
    expect(listed.result.structuredContent.list[0]).toMatchObject({ id: '8', role: 'USER' })
    expect(detail.result.isError).not.toBe(true)
    expect(detail.result.structuredContent).toMatchObject({ id: '8', role: 'USER' })
  })

  it('exposes narrow single-note tag tools and forwards normalized inputs', async () => {
    for (const [name, args, mock, expected] of [
      ['list', { noteId: '31' }, mocks.listAdminNoteTags, [31]],
      ['add', { noteId: '31', tag: ' API ' }, mocks.addAdminNoteTag, [31, 'API']],
      ['rename', { noteId: '31', tag: ' API ', newTag: ' 接口 ' }, mocks.renameAdminNoteTag, [31, 'API', '接口']],
      ['remove', { noteId: '31', tag: ' API ' }, mocks.removeAdminNoteTag, [31, 'API']],
    ] as const) {
      mock.mockResolvedValue({ noteId: '31', tags: ['keep', '接口'] })
      const called = await resultOf({ jsonrpc: '2.0', id: 50, method: 'tools/call', params: { name: `content.note.tag.${name}`, arguments: args } })
      expect(called.result.isError).not.toBe(true)
      expect(called.result.structuredContent).toEqual({ noteId: '31', tags: ['keep', '接口'] })
      expect(called.result.structuredContent).not.toHaveProperty('content')
      expect(mock).toHaveBeenCalledWith(...expected)
    }
  })
  it('rejects invalid single-tag inputs and preserves frozen-version errors', async () => {
    mocks.addAdminNoteTag.mockClear()
    for (const tag of ['', '  ', null, 42, 'x'.repeat(31)]) {
      const rejected = await resultOf({ jsonrpc: '2.0', id: 51, method: 'tools/call', params: { name: 'content.note.tag.add', arguments: { noteId: '31', tag } } })
      expect(rejected.result.isError).toBe(true)
    }
    expect(mocks.addAdminNoteTag).not.toHaveBeenCalled()
    mocks.addAdminNoteTag.mockRejectedValueOnce(new HttpError('Published project version is frozen', 409, 409, { reason: 'VERSION_FROZEN', projectVersionId: '11' }))
    const frozen = await resultOf({ jsonrpc: '2.0', id: 52, method: 'tools/call', params: { name: 'content.note.tag.add', arguments: { noteId: '31', tag: 'API' } } })
    expect(frozen.result.isError).toBe(true)
    expect(JSON.parse(frozen.result.content[0].text).error).toMatchObject({ status: 409, data: { reason: 'VERSION_FROZEN' } })
  })
  it('accepts normalized note tags and tag-only updates while rejecting invalid tag input', async () => {
    mocks.createAdminNote.mockResolvedValue(note({ tags: ['API', 'api'] }))
    const created = await resultOf({ jsonrpc: '2.0', id: 40, method: 'tools/call', params: {
      name: 'content.note.create', arguments: { categoryId: '21', noteTitle: 'Tagged', tags: [' API ', '', 'API', 'api'] },
    } })
    expect(created.result.isError).not.toBe(true)
    expect(created.result.structuredContent).toMatchObject({ tags: ['API', 'api'] })
    expect(mocks.createAdminNote).toHaveBeenCalledWith(expect.objectContaining({ tags: ['API', 'api'] }))
    mocks.updateAdminNote.mockResolvedValue(note({ tags: [] }))
    const updated = await resultOf({ jsonrpc: '2.0', id: 41, method: 'tools/call', params: {
      name: 'content.note.update', arguments: { noteId: '31', tags: [] },
    } })
    expect(updated.result.isError).not.toBe(true)
    expect(mocks.updateAdminNote).toHaveBeenCalledWith(31, expect.objectContaining({ tags: [] }))
    mocks.updateAdminNote.mockClear()
    for (const tags of [null, 'tag', [1], ['x'.repeat(31)], Array.from({ length: 11 }, (_, i) => String(i))]) {
      const rejected = await resultOf({ jsonrpc: '2.0', id: 42, method: 'tools/call', params: {
        name: 'content.note.update', arguments: { noteId: '31', tags },
      } })
      expect(rejected.result.isError).toBe(true)
    }
    expect(mocks.updateAdminNote).not.toHaveBeenCalled()
  })
  it('binds note authorship to the principal and rejects unknown fields', async () => {
    mocks.createAdminNote.mockResolvedValue(note())
    const called = await resultOf({
      jsonrpc: '2.0', id: 4, method: 'tools/call',
      params: { name: 'content.note.create', arguments: { categoryId: '21', noteTitle: 'Getting Started' } },
    })
    expect(called.result.isError).not.toBe(true)
    expect(mocks.createAdminNote).toHaveBeenCalledWith({
      categoryId: '21', authorId: 7, noteTitle: 'Getting Started', tags: undefined, weight: 0, status: 1,
    })

    mocks.createAdminNote.mockClear()
    const rejected = await resultOf({
      jsonrpc: '2.0', id: 5, method: 'tools/call',
      params: {
        name: 'content.note.create',
        arguments: { categoryId: '21', noteTitle: 'Forged', authorId: '99' },
      },
    })
    expect(rejected.result.isError).toBe(true)
    expect(mocks.createAdminNote).not.toHaveBeenCalled()
  })

  it('rejects invalid IDs and oversized content before service delegation', async () => {
    const invalidId = await resultOf({
      jsonrpc: '2.0', id: 51, method: 'tools/call',
      params: { name: 'content.project.get', arguments: { projectId: '0' } },
    })
    expect(invalidId.result.isError).toBe(true)
    expect(mocks.getAdminProject).not.toHaveBeenCalled()

    const oversized = await resultOf({
      jsonrpc: '2.0', id: 52, method: 'tools/call',
      params: {
        name: 'content.note.content.create_draft',
        arguments: { noteId: '31', content: 'x'.repeat(500_001) },
      },
    })
    expect(oversized.result.isError).toBe(true)
    expect(mocks.createAdminNoteContent).not.toHaveBeenCalled()
  })

  it('preserves actionable HttpError details without exposing arbitrary error data', async () => {
    mocks.getAdminProject.mockRejectedValue(new HttpError('Not allowed', 409, 409, {
      reason: 'PROJECT_METADATA_LIVE',
      projectId: '9',
      secret: 'must-not-leak',
    }))
    const called = await resultOf({
      jsonrpc: '2.0', id: 53, method: 'tools/call',
      params: { name: 'content.project.get', arguments: { projectId: '9' } },
    })
    expect(called.result.isError).toBe(true)
    const errorText = called.result.content[0].text
    expect(errorText).toContain('PROJECT_METADATA_LIVE')
    expect(errorText).not.toContain('must-not-leak')
  })

  it('uses empty creation or a same-project published source for version drafts', async () => {
    const draft = {
      id: '12', projectId: '9', version: 'v2', description: null, weight: 0, status: 0,
      releaseId: null, releaseHash: null, manifestVersion: null, publishedAt: null,
      createdAt: timestamp, updatedAt: timestamp, isDeleted: false,
    }
    mocks.createAdminProjectVersion.mockResolvedValue(draft)
    await resultOf({
      jsonrpc: '2.0', id: 6, method: 'tools/call',
      params: { name: 'content.project.version.create_draft', arguments: { projectId: '9', version: 'v2' } },
    })
    expect(mocks.createAdminProjectVersion).toHaveBeenCalledWith({
      projectId: '9', version: 'v2', description: null, weight: 0,
    })

    mocks.getAdminProjectVersion.mockResolvedValue({
      ...draft, id: '11', version: 'v1', releaseId: 'release-id', releaseHash: 'hash',
      manifestVersion: 1, publishedAt: timestamp,
    })
    mocks.cloneProjectVersion.mockResolvedValue(draft)
    await resultOf({
      jsonrpc: '2.0', id: 7, method: 'tools/call',
      params: {
        name: 'content.project.version.clone',
        arguments: { projectId: '9', sourceVersionId: '11', version: 'v2' },
      },
    })
    expect(mocks.cloneProjectVersion).toHaveBeenCalledWith(11, { version: 'v2' })

    mocks.getAdminProjectVersion.mockResolvedValue({
      ...draft, id: '13', projectId: '8', version: 'v1', releaseId: 'release-id-2',
      releaseHash: 'hash-2', manifestVersion: 1, publishedAt: timestamp,
    })
    const rejected = await resultOf({
      jsonrpc: '2.0', id: 71, method: 'tools/call',
      params: {
        name: 'content.project.version.clone',
        arguments: { projectId: '9', sourceVersionId: '13', version: 'v2' },
      },
    })
    expect(rejected.result.isError).toBe(true)
    expect(mocks.cloneProjectVersion).toHaveBeenCalledTimes(1)
  })

  it('lists lightweight content versions without returning Markdown', async () => {
    mocks.listAdminNoteContentVersions.mockResolvedValue({
      list: [{
        id: '41', noteInfoId: '31', versionNote: 'draft', isPrimary: true, status: 1,
        createdAt: timestamp, updatedAt: timestamp, isDeleted: false,
      }],
    })
    const called = await resultOf({
      jsonrpc: '2.0', id: 8, method: 'tools/call',
      params: { name: 'content.note.content.list_versions', arguments: { noteId: '31' } },
    })
    expect(called.result.structuredContent.list[0]).not.toHaveProperty('content')
    expect(mocks.listAdminNoteContentVersions).toHaveBeenCalledWith(31)
  })

  it('returns administrator membership grants with a nullable points cost', async () => {
    mocks.getManagedUserMembership.mockResolvedValue({
      currentMembership: {
        id: '2', name: 'VIP', rank: 2, expiresAt: null, source: 'ADMIN_GRANT',
      },
      activeMemberships: [{ id: '2', name: 'VIP', rank: 2, expiresAt: null, source: 'ADMIN_GRANT' }],
      grants: [{
        id: '51',
        membershipLevel: {
          id: '2', name: 'VIP', rank: 2, pricePoints: 30, validityDays: 30, status: 1,
          createdAt: timestamp, updatedAt: timestamp,
        },
        source: 'ADMIN_GRANT',
        pointsCost: null,
        grantedByUserId: '7',
        grantedAt: timestamp,
        expiresAt: null,
        revokedAt: null,
        revokedByUserId: null,
        active: true,
      }],
    })

    const called = await resultOf({
      jsonrpc: '2.0', id: 81, method: 'tools/call',
      params: { name: 'admin.user.membership.get', arguments: { userId: '8' } },
    })

    expect(called.result.isError).not.toBe(true)
    expect(called.result.structuredContent.grants[0]).toMatchObject({
      source: 'ADMIN_GRANT',
      pointsCost: null,
      grantedByUserId: '7',
    })
    expect(mocks.getManagedUserMembership).toHaveBeenCalledWith(8)
  })

  it('registers four workflows whose instructions respect the tool boundary', async () => {
    const listed = await resultOf({ jsonrpc: '2.0', id: 9, method: 'prompts/list', params: {} })
    expect(listed.result.prompts.map((prompt: { name: string }) => prompt.name)).toEqual([
      'workflow.create_project_draft',
      'workflow.organize_notes',
      'workflow.pre_publish_check',
      'workflow.publish_version',
    ])

    const prompt = await resultOf({
      jsonrpc: '2.0', id: 10, method: 'prompts/get',
      params: {
        name: 'workflow.pre_publish_check',
        arguments: { projectVersionId: '12' },
      },
    })
    const text = prompt.result.messages[0].content.text
    expect(text).toContain('content.project.version.check_draft')
    expect(text).not.toMatch(/admin_project_list|\.delete|\.restore/)
  })
})

const sdkPlaceholderKey = `svmcp_${'EXAMPLE_ONLY'.padEnd(24, '_')}.${'EXAMPLE_ONLY_NOT_A_SECRET'.padEnd(43, '_')}`
function activeSdkKey() {
  return { id: 4, publicId: 'EXAMPLE_ONLY'.padEnd(24, '_'), secretHash: 'EXAMPLE_HASH_ONLY',
    status: 1, expiresAt: null, user: { id: 7, username: 'admin', role: 'ADMIN', status: 1 } }
}

// In-process SDK protocol harness; this does not launch Codex or Claude Code.
function sdkTestClient(name = 'sdk-protocol-test', key = sdkPlaceholderKey, version = '1.0.0', userAgent = 'SlothVault-SDK-Test') {
  const requests: Request[] = []
  const client = new Client({ name, version })
  const transport = new StreamableHTTPClientTransport(new URL('https://vault.example/mcp'), {
    requestInit: { headers: { Authorization: `Bearer ${key}`, 'User-Agent': userAgent } },
    fetch: async (input, init) => {
      const request = new Request(input, init)
      requests.push(request)
      expect(new URL(request.url).pathname).toBe('/mcp')
      if (request.method === 'GET') return GET()
      if (request.method === 'DELETE') return DELETE()
      return POST(new NextRequest(request))
    },
  })
  return { client, transport, requests }
}

describe('SDK protocol simulation through the /mcp route', () => {
  beforeEach(() => {
    mocks.health.mockResolvedValue({ status: 'INSTALLED' })
    mocks.findMcpKey.mockResolvedValue(activeSdkKey())
    mocks.touchMcpKey.mockResolvedValue({ count: 1 })
    mocks.verifyPassword.mockResolvedValue(true)
  })

  it('initializes, discovers and reads through the standard protocol', async () => {
    const { client, transport, requests } = sdkTestClient()
    mocks.listAdminProjects.mockResolvedValue({ list: [project({ latestVersion: "v1", latestVersionId: "11", categoryCount: 2 })], page: 1, pageSize: 20, total: 1 })
    try {
      await client.connect(transport)
      expect(client.getServerVersion()).toEqual({ name: 'slothvault-admin-mcp', version: '5.0.0' })
      expect(client.getInstructions()).toBe(ADMIN_MCP_INSTRUCTIONS)
      expect((await client.listTools()).tools).toHaveLength(71)
      expect((await client.listPrompts()).prompts).toHaveLength(4)
      expect((await client.listResourceTemplates()).resourceTemplates).toHaveLength(2)
      expect((await client.listResources()).resources).toEqual([])
      const read = await client.callTool({ name: 'content.project.list', arguments: {} })
      expect(read.isError).not.toBe(true)
      expect(read.structuredContent).toMatchObject({ list: [{ id: '9' }] })
      const negotiated = requests.filter((request) => request.method === 'POST').slice(1)
      expect(negotiated.every((request) => request.headers.get('mcp-protocol-version') === '2025-11-25')).toBe(true)
      const prompt = await client.getPrompt({ name: 'workflow.pre_publish_check', arguments: { projectVersionId: '12' } })
      expect(prompt.messages[0].content).toMatchObject({ type: 'text' })
      mocks.readManagedFile.mockResolvedValue({ file: { originalName: 'guide.md', businessType: 'Markdown', status: 1 }, buffer: Buffer.from('# Guide') })
      mocks.managedFileContentType.mockReturnValue('text/markdown')
      const file = await client.readResource({ uri: 'slothvault://managed-file/44' })
      expect(file.contents[0]).toMatchObject({ blob: Buffer.from('# Guide').toString('base64'), _meta: { 'slothvault/file-name': 'guide.md' } })
      mocks.readAuthorizedContractAttachment.mockResolvedValue({ originalName: 'contract.pdf', buffer: Buffer.from('%PDF-example') })
      const attachment = await client.readResource({ uri: 'slothvault://contract-attachment/12' })
      expect(attachment.contents[0]).toMatchObject({ mimeType: 'application/pdf', blob: Buffer.from('%PDF-example').toString('base64') })
      expect(mocks.readAuthorizedContractAttachment).toHaveBeenCalledWith({ id: 12, userId: 7, isAdmin: true })
    } finally { await client.close() }
  })

  // Self-reported identity is protocol data, not proof of a supported host or authority.
  it.each([
    ['Codex', '0.0.0', 'codex-test-fixture'],
    ['claude-code', '999.0.0', 'claude-test-fixture'],
    ['arbitrary-protocol-fixture', '1.2.3', 'unrecognized-test-agent'],
  ])('uses Key authorization regardless of self-reported identity: %s', async (name, version, userAgent) => {
    mocks.listAdminProjects.mockResolvedValue({ list: [], page: 1, pageSize: 20, total: 0 })
    const { client, transport } = sdkTestClient(name, sdkPlaceholderKey, version, userAgent)
    try {
      await client.connect(transport)
      const result = await client.callTool({ name: 'content.project.list', arguments: {} })
      expect(result.isError).not.toBe(true)
      expect(result.structuredContent).toEqual({ list: [], page: 1, pageSize: 20, total: 0 })
    } finally { await client.close() }

    const invalid = sdkTestClient(name, 'SLOTHVAULT_MCP_KEY_EXAMPLE_INVALID', version, userAgent)
    try {
      await expect(invalid.client.connect(invalid.transport)).rejects.toMatchObject({ code: 401 })
    } finally { await invalid.client.close() }
  })

  it.each([
    ['expired', { expiresAt: new Date('2020-01-01') }],
    ['disabled', { status: 0 }],
    ['non-admin', { user: { id: 7, username: 'example', role: 'USER', status: 1 } }],
    ['disabled account', { user: { id: 7, username: 'example', role: 'ADMIN', status: 0 } }],
  ])('refuses %s credentials at initialize', async (_name, overrides) => {
    mocks.findMcpKey.mockResolvedValue({ ...activeSdkKey(), ...overrides })
    const { client, transport } = sdkTestClient()
    try { await expect(client.connect(transport)).rejects.toMatchObject({ code: 401 }) } finally { await client.close() }
  })

  it('refuses invalid keys', async () => {
    const { client, transport } = sdkTestClient('sdk-protocol-test', 'SLOTHVAULT_MCP_KEY_EXAMPLE_INVALID')
    try { await expect(client.connect(transport)).rejects.toMatchObject({ code: 401 }) } finally { await client.close() }
  })

  it('requires a Bearer Key even when a browser session Cookie is present', async () => {
    const lookups = mocks.findMcpKey.mock.calls.length
    const response = await POST(new NextRequest('https://vault.example/mcp', {
      method: 'POST',
      headers: { Cookie: 'sv_session=EXAMPLE_SESSION_ONLY', 'content-type': 'application/json', accept: 'application/json, text/event-stream' },
      body: JSON.stringify({ jsonrpc: '2.0', id: 1, method: 'initialize', params: {
        protocolVersion: '2025-11-25', capabilities: {}, clientInfo: { name: 'sdk-protocol-test', version: '1.0.0' },
      } }),
    }))
    expect(response.status).toBe(401)
    expect(response.headers.get('cache-control')).toBe('no-store')
    expect(mocks.findMcpKey.mock.calls).toHaveLength(lookups)
  })

  it('revalidates revocation between requests and before Resource reads', async () => {
    const { client, transport } = sdkTestClient()
    try {
      await client.connect(transport)
      mocks.findMcpKey.mockResolvedValue({ ...activeSdkKey(), status: 0 })
      await expect(client.listTools()).rejects.toMatchObject({ code: 401 })
      await expect(client.readResource({ uri: 'slothvault://managed-file/44' })).rejects.toMatchObject({ code: 401 })
    } finally { await client.close() }
  })

  it('keeps Resource domains and size limits enforced', async () => {
    const { client, transport } = sdkTestClient()
    try {
      await client.connect(transport)
      for (const businessType of ['ContractAttachment', 'CommissionAttachment']) {
        mocks.readManagedFile.mockResolvedValue({ file: { originalName: 'private.pdf', businessType, status: 1 }, buffer: Buffer.from('example') })
        await expect(client.readResource({ uri: 'slothvault://managed-file/44' })).rejects.toThrow()
      }
      mocks.readManagedFile.mockResolvedValue({ file: { originalName: 'large.zip', businessType: 'Other', status: 1 }, buffer: Buffer.alloc(10 * 1024 * 1024 + 1) })
      await expect(client.readResource({ uri: 'slothvault://managed-file/44' })).rejects.toThrow()
      mocks.readAuthorizedContractAttachment.mockResolvedValue({ originalName: 'large.pdf', buffer: Buffer.alloc(25 * 1024 * 1024 + 1) })
      await expect(client.readResource({ uri: 'slothvault://contract-attachment/12' })).rejects.toThrow()
      mocks.readAuthorizedContractAttachment.mockRejectedValue(new HttpError('Not found', 404, 404))
      await expect(client.readResource({ uri: 'slothvault://contract-attachment/12' })).rejects.toThrow()
    } finally { await client.close() }
  })

  it('never includes the Bearer credential in success or authentication-failure logs', async () => {
    const info = vi.spyOn(console, 'info').mockImplementation(() => {})
    const error = vi.spyOn(console, 'error').mockImplementation(() => {})
    const { client, transport } = sdkTestClient()
    mocks.listAdminProjects.mockResolvedValue({ list: [], page: 1, pageSize: 20, total: 0 })
    try {
      await client.connect(transport)
      await client.callTool({ name: 'content.project.list', arguments: {} })
      mocks.findMcpKey.mockResolvedValue({ ...activeSdkKey(), status: 0 })
      await expect(client.listTools()).rejects.toMatchObject({ code: 401 })
      const logged = JSON.stringify([info.mock.calls, error.mock.calls])
      expect(logged).not.toContain(sdkPlaceholderKey)
      expect(logged).not.toContain('EXAMPLE_ONLY_NOT_A_SECRET')
    } finally {
      await client.close()
      info.mockRestore()
      error.mockRestore()
    }
  })
})
