import { WebStandardStreamableHTTPServerTransport } from '@modelcontextprotocol/sdk/server/webStandardStreamableHttp.js'
import { describe, expect, it, vi } from 'vitest'

const mocks = vi.hoisted(() => ({
  createAdminProject: vi.fn(), getAdminProject: vi.fn(), listAdminProjects: vi.fn(),
  updateAdminProjectMetadataFromMcp: vi.fn(), createAdminProjectVersion: vi.fn(),
  getAdminProjectVersion: vi.fn(), listAdminProjectVersions: vi.fn(),
  createAdminCategory: vi.fn(), listAdminCategories: vi.fn(), updateAdminCategory: vi.fn(),
  createAdminNote: vi.fn(), getAdminNote: vi.fn(), listAdminNotes: vi.fn(), updateAdminNote: vi.fn(),
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
  getAdminContract: vi.fn(), listAdminContracts: vi.fn(),
  readAuthorizedContractAttachment: vi.fn(),
  getAdminReleaseEvidence: vi.fn(), listReleaseEvidence: vi.fn(),
  getSystemUpdateInfo: vi.fn(),
}))

vi.mock('@/server/services/admin-catalog', () => ({
  createAdminProject: mocks.createAdminProject,
  getAdminProject: mocks.getAdminProject,
  listAdminProjects: mocks.listAdminProjects,
  updateAdminProjectMetadataFromMcp: mocks.updateAdminProjectMetadataFromMcp,
  createAdminProjectVersion: mocks.createAdminProjectVersion,
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

vi.mock('@/server/services/project-version-release', () => ({
  checkDraftProjectVersion: mocks.checkDraftProjectVersion,
  cloneProjectVersion: mocks.cloneProjectVersion,
  getProjectVersionIntegrity: mocks.getProjectVersionIntegrity,
  getProjectVersionManifest: mocks.getProjectVersionManifest,
}))

vi.mock('@/server/services/admin-articles', () => ({
  createAdminArticle: mocks.createAdminArticle,
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

vi.mock('@/server/services/contracts', () => ({
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
    requireAuth: false, createdAt: timestamp, updatedAt: timestamp, isDeleted: false,
    ...overrides,
  }
}

function note(overrides: Record<string, unknown> = {}) {
  return {
    id: '31', categoryId: '21', authorId: '7', noteTitle: 'Getting Started',
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
    structuredContent: { list: Array<Record<string, unknown>> }
    isError?: boolean
    content: Array<{ text: string }>
    contents: Array<{ uri: string; name?: string; mimeType?: string; blob?: string }>
    messages: Array<{ content: { text: string } }>
  }
}

async function resultOf(message: Record<string, unknown>) {
  const response = await handle(message)
  return response.json() as Promise<McpJsonResponse>
}

describe('administrator MCP server', () => {
  it('publishes the 3.0 identity and the complete safe daily-management tool registry', async () => {
    const initialize = await resultOf({
      jsonrpc: '2.0', id: 1, method: 'initialize',
      params: {
        protocolVersion: '2025-11-25', capabilities: {},
        clientInfo: { name: 'vitest', version: '1.0.0' },
      },
    })
    expect(initialize).toMatchObject({
      result: { serverInfo: { name: 'slothvault-admin-mcp', version: '3.0.0' } },
    })

    const listed = await resultOf({ jsonrpc: '2.0', id: 2, method: 'tools/list', params: {} })
    const names = listed.result.tools.map((tool: { name: string }) => tool.name)
    expect(names).toEqual([
      'content.project.list', 'content.project.get', 'content.project.create', 'content.project.update',
      'content.project.version.list', 'content.project.version.get', 'content.project.version.create_draft',
      'content.project.version.clone', 'content.project.version.check_draft',
      'content.project.version.integrity', 'content.project.version.manifest',
      'content.category.list', 'content.category.create', 'content.category.update',
      'content.note.list', 'content.note.get', 'content.note.create', 'content.note.update',
      'content.note.content.list_versions', 'content.note.content.get',
      'content.note.content.create_draft', 'content.note.content.update_draft',
      'content.note.content.set_primary',
      'content.article.list', 'content.article.get', 'content.article.create', 'content.article.update',
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
    ])
    expect(names).not.toContain('admin_project_list')
    expect(names.some((name: string) =>
      /(?:^|\.)(?:publish|withdraw|delete|restore|password|adjust|issue|submit|reconcile|reset|backup)(?:\.|$)/.test(name),
    )).toBe(false)
    expect(listed.result.tools.every((tool: { inputSchema?: unknown }) => tool.inputSchema)).toBe(true)
    expect(listed.result.tools.every((tool: { outputSchema?: unknown }) => tool.outputSchema)).toBe(true)
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
      name: 'guide.md',
      mimeType: 'text/markdown; charset=utf-8',
      blob: Buffer.from('# Guide').toString('base64'),
    })])
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
      page: 2, pageSize: 5, skip: 5, keyword: 'Docs', includeDeleted: false,
      onlyDeleted: false, status: undefined, orderByField: 'updatedAt', order: 'desc',
    })
    expect(called.result).toMatchObject({
      structuredContent: {
        list: [{ id: '9', projectName: 'Documentation', createdAt: timestamp.toISOString() }],
      },
    })
  })

  it('binds note authorship to the principal and rejects unknown fields', async () => {
    mocks.createAdminNote.mockResolvedValue(note())
    const called = await resultOf({
      jsonrpc: '2.0', id: 4, method: 'tools/call',
      params: { name: 'content.note.create', arguments: { categoryId: '21', noteTitle: 'Getting Started' } },
    })
    expect(called.result.isError).not.toBe(true)
    expect(mocks.createAdminNote).toHaveBeenCalledWith({
      categoryId: '21', authorId: 7, noteTitle: 'Getting Started', weight: 0, status: 1,
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

  it('registers three workflows whose instructions respect the tool boundary', async () => {
    const listed = await resultOf({ jsonrpc: '2.0', id: 9, method: 'prompts/list', params: {} })
    expect(listed.result.prompts.map((prompt: { name: string }) => prompt.name)).toEqual([
      'workflow.create_project_draft',
      'workflow.organize_notes',
      'workflow.pre_publish_check',
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
    expect(text).not.toMatch(/admin_project_list|\.publish|\.delete|\.restore/)
  })
})
