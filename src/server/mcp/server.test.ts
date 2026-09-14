import { WebStandardStreamableHTTPServerTransport } from '@modelcontextprotocol/sdk/server/webStandardStreamableHttp.js'
import { describe, expect, it, vi } from 'vitest'

const mocks = vi.hoisted(() => ({ listAdminProjects: vi.fn() }))

vi.mock('@/server/services/admin-catalog/projects', () => ({
  listAdminProjects: mocks.listAdminProjects,
}))

import { createAdminMcpServer } from '@/server/mcp/server'

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

describe('administrator MCP server', () => {
  it('declares the registered project tool and delegates tool calls to the existing service layer', async () => {
    mocks.listAdminProjects.mockResolvedValue({
      list: [{ id: '9', projectName: 'Documentation' }],
      page: 2,
      pageSize: 5,
      total: 1,
    })
    async function handle(message: Record<string, unknown>) {
      const server = createAdminMcpServer({
        authentication: 'mcp-api-key',
        apiKeyId: 4,
        userId: 7,
        username: 'admin',
      })
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

    const initialize = await handle({
        jsonrpc: '2.0',
        id: 1,
        method: 'initialize',
        params: {
          protocolVersion: '2025-11-25',
          capabilities: {},
          clientInfo: { name: 'vitest', version: '1.0.0' },
        },
      })
    expect(initialize.status).toBe(200)
    await expect(initialize.json()).resolves.toMatchObject({
      jsonrpc: '2.0',
      result: { serverInfo: { name: 'slothvault-admin-mcp', version: '1.0.0' } },
    })

    const listed = await handle({
      jsonrpc: '2.0',
      id: 2,
      method: 'tools/list',
      params: {},
    })
    await expect(listed.json()).resolves.toMatchObject({
      result: {
        tools: [expect.objectContaining({
          name: 'admin_project_list',
          title: '列出管理员项目',
          annotations: expect.objectContaining({ readOnlyHint: true }),
        })],
      },
    })

    const called = await handle({
      jsonrpc: '2.0',
      id: 3,
      method: 'tools/call',
      params: {
        name: 'admin_project_list',
        arguments: { page: 2, pageSize: 5, keyword: ' Docs ' },
      },
    })
    expect(mocks.listAdminProjects).toHaveBeenCalledWith({
      page: 2,
      pageSize: 5,
      skip: 5,
      keyword: 'Docs',
      includeDeleted: false,
      onlyDeleted: false,
      status: undefined,
      orderByField: 'updatedAt',
      order: 'desc',
    })
    await expect(called.json()).resolves.toMatchObject({
      result: {
        structuredContent: { list: [{ id: '9', projectName: 'Documentation' }] },
      },
    })
  })
})
