import { beforeEach, describe, expect, it, vi } from 'vitest'

const mocks = vi.hoisted(() => ({
  hashPassword: vi.fn(),
  verifyPassword: vi.fn(),
  prisma: {
    mcpApiKey: {
      create: vi.fn(),
      deleteMany: vi.fn(),
      findFirst: vi.fn(),
      findMany: vi.fn(),
      findUnique: vi.fn(),
      updateMany: vi.fn(),
    },
  },
}))

vi.mock('@/server/auth/password', () => ({
  hashPassword: mocks.hashPassword,
  verifyPassword: mocks.verifyPassword,
}))
vi.mock('@/server/prisma', () => ({ prisma: mocks.prisma }))

import {
  MCP_API_KEY_STATUS,
  authenticateMcpApiKey,
  createMcpApiKey,
  deleteMcpApiKey,
  listMcpApiKeys,
  parseMcpApiKey,
  setMcpApiKeyStatus,
} from '@/server/services/mcp-api-keys'

const createdAt = new Date('2026-09-14T00:00:00.000Z')

function apiKeyRecord(overrides: Record<string, unknown> = {}) {
  return {
    id: 4,
    userId: 7,
    publicId: 'a'.repeat(24),
    secretHash: 'argon2-key-hash',
    name: 'Codex workspace',
    status: MCP_API_KEY_STATUS.ACTIVE,
    expiresAt: null,
    lastUsedAt: null,
    createdAt,
    updatedAt: createdAt,
    ...overrides,
  }
}

describe('MCP API key service', () => {
  beforeEach(() => {
    vi.clearAllMocks()
  })

  it('generates a one-time key while persisting only its Argon2id secret hash', async () => {
    mocks.hashPassword.mockResolvedValue('argon2-key-hash')
    mocks.prisma.mcpApiKey.create.mockImplementation(async ({ data }) => apiKeyRecord({
      ...data,
      createdAt,
      updatedAt: createdAt,
      lastUsedAt: null,
    }))

    const result = await createMcpApiKey({ userId: 7, name: '  Codex workspace  ' })
    const parsed = parseMcpApiKey(result.key)

    expect(parsed).toEqual({ publicId: expect.any(String), secret: expect.any(String) })
    expect(parsed?.publicId).toHaveLength(24)
    expect(parsed?.secret).toHaveLength(43)
    expect(mocks.hashPassword).toHaveBeenCalledWith(parsed?.secret)
    expect(mocks.prisma.mcpApiKey.create).toHaveBeenCalledWith({
      data: expect.objectContaining({
        userId: 7,
        publicId: parsed?.publicId,
        secretHash: 'argon2-key-hash',
        name: 'Codex workspace',
        status: MCP_API_KEY_STATUS.ACTIVE,
        expiresAt: null,
      }),
    })
    expect(result.apiKey).toMatchObject({
      id: '4',
      name: 'Codex workspace',
      status: MCP_API_KEY_STATUS.ACTIVE,
      keyHint: expect.stringContaining('svmcp_'),
    })
    expect(result.apiKey).not.toHaveProperty('secretHash')
  })

  it('lists only safe key metadata for its owner', async () => {
    mocks.prisma.mcpApiKey.findMany.mockResolvedValue([apiKeyRecord()])

    await expect(listMcpApiKeys(7)).resolves.toEqual([expect.objectContaining({
      id: '4',
      name: 'Codex workspace',
      lastUsedAt: null,
    })])
    expect(mocks.prisma.mcpApiKey.findMany).toHaveBeenCalledWith({
      where: { userId: 7 },
      orderBy: [{ createdAt: 'desc' }, { id: 'desc' }],
    })
  })

  it('changes status and deletes only a key owned by the current administrator', async () => {
    mocks.prisma.mcpApiKey.updateMany.mockResolvedValue({ count: 1 })
    mocks.prisma.mcpApiKey.findFirst.mockResolvedValue(apiKeyRecord({ status: MCP_API_KEY_STATUS.DISABLED }))
    mocks.prisma.mcpApiKey.deleteMany.mockResolvedValue({ count: 1 })

    await expect(setMcpApiKeyStatus({
      userId: 7,
      apiKeyId: 4,
      status: MCP_API_KEY_STATUS.DISABLED,
    })).resolves.toMatchObject({ id: '4', status: MCP_API_KEY_STATUS.DISABLED })
    expect(mocks.prisma.mcpApiKey.updateMany).toHaveBeenCalledWith({
      where: { id: 4, userId: 7 },
      data: { status: MCP_API_KEY_STATUS.DISABLED, updatedAt: expect.any(Date) },
    })

    await expect(deleteMcpApiKey({ userId: 7, apiKeyId: 4 })).resolves.toBeUndefined()
    expect(mocks.prisma.mcpApiKey.deleteMany).toHaveBeenCalledWith({
      where: { id: 4, userId: 7 },
    })
  })

  it('accepts only an active, unexpired key belonging to an active administrator', async () => {
    const rawKey = `svmcp_${'a'.repeat(24)}.${'b'.repeat(43)}`
    mocks.prisma.mcpApiKey.findUnique.mockResolvedValue(apiKeyRecord({
      user: { id: 7, username: 'admin', role: 'ADMIN', status: 1 },
    }))
    mocks.verifyPassword.mockResolvedValue(true)
    mocks.prisma.mcpApiKey.updateMany.mockResolvedValue({ count: 1 })

    await expect(authenticateMcpApiKey(rawKey)).resolves.toEqual({
      authentication: 'mcp-api-key',
      apiKeyId: 4,
      userId: 7,
      username: 'admin',
    })
    expect(mocks.verifyPassword).toHaveBeenCalledWith('argon2-key-hash', 'b'.repeat(43))
    expect(mocks.prisma.mcpApiKey.updateMany).toHaveBeenCalledWith({
      where: expect.objectContaining({
        id: 4,
        status: MCP_API_KEY_STATUS.ACTIVE,
        user: { status: 1, role: 'ADMIN' },
      }),
      data: { lastUsedAt: expect.any(Date), updatedAt: expect.any(Date) },
    })
  })

  it('rejects malformed, expired, non-administrator, and disabled credentials without updating last use', async () => {
    await expect(authenticateMcpApiKey('not-an-mcp-key')).resolves.toBeNull()

    mocks.prisma.mcpApiKey.findUnique.mockResolvedValue(apiKeyRecord({
      expiresAt: new Date('2026-09-13T00:00:00.000Z'),
      user: { id: 7, username: 'admin', role: 'ADMIN', status: 1 },
    }))
    await expect(authenticateMcpApiKey(`svmcp_${'a'.repeat(24)}.${'b'.repeat(43)}`)).resolves.toBeNull()

    mocks.prisma.mcpApiKey.findUnique.mockResolvedValue(apiKeyRecord({
      user: { id: 7, username: 'writer', role: 'USER', status: 1 },
    }))
    await expect(authenticateMcpApiKey(`svmcp_${'a'.repeat(24)}.${'b'.repeat(43)}`)).resolves.toBeNull()
    expect(mocks.verifyPassword).not.toHaveBeenCalled()
    expect(mocks.prisma.mcpApiKey.updateMany).not.toHaveBeenCalled()
  })
})
