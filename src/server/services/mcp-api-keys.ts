/**
 * @file mcp-api-keys.ts
 * @project SlothVault
 * @module MCP API Key Service
 * @description Creates, lists, enables, disables, deletes, and authenticates revocable administrator MCP API keys.
 * @logic Store only Argon2id hashes of generated key secrets, scope management operations to the owning administrator, and recheck key and account state before accepting every external MCP request.
 * @dependencies node:crypto, auth/password, auth/roles, Prisma McpApiKey/User models, HTTP errors
 * @index_tags mcp,api-key,authentication,administrator,argon2,revocation
 * @author holic512
 */
import 'server-only'

import { randomBytes } from 'node:crypto'

import { verifyPassword, hashPassword } from '@/server/auth/password'
import { isAdminRole, USER_STATUS } from '@/server/auth/roles'
import { HttpError } from '@/server/http/errors'
import { prisma } from '@/server/prisma'

export const MCP_API_KEY_STATUS = {
  DISABLED: 0,
  ACTIVE: 1,
} as const

export const MCP_API_KEY_PREFIX = 'svmcp_'

const PUBLIC_ID_LENGTH = 24
const SECRET_LENGTH = 43
const mcpApiKeyPattern = new RegExp(
  `^${MCP_API_KEY_PREFIX}([A-Za-z0-9_-]{${PUBLIC_ID_LENGTH}})\\.([A-Za-z0-9_-]{${SECRET_LENGTH}})$`,
)

type McpApiKeyRecord = {
  id: number
  publicId: string
  name: string
  status: number
  expiresAt: Date | null
  lastUsedAt: Date | null
  createdAt: Date
  updatedAt: Date
}

export type McpPrincipal = {
  authentication: 'mcp-api-key'
  apiKeyId: number
  userId: number
  username: string
}

export type CreatedMcpApiKey = {
  apiKey: ReturnType<typeof mcpApiKeyDto>
  key: string
}

export function mcpApiKeyDto(record: McpApiKeyRecord) {
  return {
    id: record.id.toString(),
    name: record.name,
    status: record.status,
    keyHint: `${MCP_API_KEY_PREFIX}${record.publicId.slice(0, 8)}…`,
    expiresAt: record.expiresAt,
    lastUsedAt: record.lastUsedAt,
    createdAt: record.createdAt,
    updatedAt: record.updatedAt,
  }
}

export function parseMcpApiKey(value: string) {
  const match = mcpApiKeyPattern.exec(value)
  if (!match) return null
  return { publicId: match[1], secret: match[2] }
}

function generatedMcpApiKey() {
  const publicId = randomBytes(18).toString('base64url')
  const secret = randomBytes(32).toString('base64url')
  return {
    publicId,
    secret,
    key: `${MCP_API_KEY_PREFIX}${publicId}.${secret}`,
  }
}

function normalizedKeyName(value: string) {
  const name = value.trim()
  if (!name || name.length > 80) throw new HttpError('Invalid MCP key name', 400, 400)
  return name
}

function validatedExpiry(value: Date | null | undefined) {
  if (!value) return null
  if (!Number.isFinite(value.getTime()) || value.getTime() <= Date.now()) {
    throw new HttpError('MCP key expiry must be in the future', 400, 400)
  }
  return value
}

function isMcpApiKeyActive(record: { status: number; expiresAt: Date | null }, now: Date) {
  return record.status === MCP_API_KEY_STATUS.ACTIVE &&
    (!record.expiresAt || record.expiresAt.getTime() > now.getTime())
}

export async function listMcpApiKeys(userId: number) {
  const keys = await prisma.mcpApiKey.findMany({
    where: { userId },
    orderBy: [{ createdAt: 'desc' }, { id: 'desc' }],
  })
  return keys.map(mcpApiKeyDto)
}

export async function createMcpApiKey(input: {
  userId: number
  name: string
  expiresAt?: Date | null
}): Promise<CreatedMcpApiKey> {
  const generated = generatedMcpApiKey()
  const secretHash = await hashPassword(generated.secret)
  const key = await prisma.mcpApiKey.create({
    data: {
      userId: input.userId,
      publicId: generated.publicId,
      secretHash,
      name: normalizedKeyName(input.name),
      status: MCP_API_KEY_STATUS.ACTIVE,
      expiresAt: validatedExpiry(input.expiresAt),
    },
  })
  return { apiKey: mcpApiKeyDto(key), key: generated.key }
}

export async function setMcpApiKeyStatus(input: {
  userId: number
  apiKeyId: number
  status: (typeof MCP_API_KEY_STATUS)[keyof typeof MCP_API_KEY_STATUS]
}) {
  const updated = await prisma.mcpApiKey.updateMany({
    where: { id: input.apiKeyId, userId: input.userId },
    data: { status: input.status, updatedAt: new Date() },
  })
  if (updated.count !== 1) throw new HttpError('MCP key not found', 404, 404)

  const key = await prisma.mcpApiKey.findFirst({
    where: { id: input.apiKeyId, userId: input.userId },
  })
  if (!key) throw new HttpError('MCP key not found', 404, 404)
  return mcpApiKeyDto(key)
}

export async function deleteMcpApiKey(input: { userId: number; apiKeyId: number }) {
  const deleted = await prisma.mcpApiKey.deleteMany({
    where: { id: input.apiKeyId, userId: input.userId },
  })
  if (deleted.count !== 1) throw new HttpError('MCP key not found', 404, 404)
}

export async function authenticateMcpApiKey(value: string): Promise<McpPrincipal | null> {
  const parsed = parseMcpApiKey(value)
  if (!parsed) return null

  const key = await prisma.mcpApiKey.findUnique({
    where: { publicId: parsed.publicId },
    include: { user: true },
  })
  const now = new Date()
  if (
    !key ||
    !isMcpApiKeyActive(key, now) ||
    key.user.status !== USER_STATUS.ACTIVE ||
    !isAdminRole(key.user.role)
  ) {
    return null
  }

  try {
    if (!await verifyPassword(key.secretHash, parsed.secret)) return null
  } catch {
    return null
  }

  const touched = await prisma.mcpApiKey.updateMany({
    where: {
      id: key.id,
      status: MCP_API_KEY_STATUS.ACTIVE,
      OR: [{ expiresAt: null }, { expiresAt: { gt: now } }],
      user: { status: USER_STATUS.ACTIVE, role: 'ADMIN' },
    },
    data: { lastUsedAt: now, updatedAt: now },
  })
  if (touched.count !== 1) return null

  return {
    authentication: 'mcp-api-key',
    apiKeyId: key.id,
    userId: key.user.id,
    username: key.user.username,
  }
}
