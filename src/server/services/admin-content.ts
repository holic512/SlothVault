/**
 * @file admin-content.ts
 * @project SlothVault
 * @module Admin Content Services
 * @description Provides DTO mapping and validation shared by homepage, project menu, and system configuration APIs.
 * @logic Serialize decimal identifiers, enforce two-level same-project menus, validate navigation URLs, and describe masked runtime settings.
 * @dependencies Prisma content models, server/http/errors
 * @index_tags admin,homepage,project-menu,configuration,dto,validation
 * @author holic512
 */
import 'server-only'

import type { Prisma } from '@generated/prisma/client'

import { HttpError } from '@/server/http/errors'

type ProjectHomeLike = {
  id: bigint
  projectId: bigint
  content: string
  status: number
  createdAt: Date
  updatedAt: Date
  isDeleted: boolean
}

type SystemHomepageLike = {
  id: bigint
  content: string
  status: number
  createdAt: Date
  updatedAt: Date
  isDeleted: boolean
}

type ProjectMenuLike = {
  id: bigint
  projectId: bigint
  parentId: bigint | null
  label: string
  url: string | null
  isExternal: boolean
  weight: number
  status: number
  createdAt: Date
  updatedAt: Date
  isDeleted: boolean
  children?: ProjectMenuLike[]
}

export function projectHomeDto(home: ProjectHomeLike) {
  return {
    id: home.id.toString(),
    projectId: home.projectId.toString(),
    content: home.content,
    status: home.status,
    createdAt: home.createdAt,
    updatedAt: home.updatedAt,
    isDeleted: home.isDeleted,
  }
}

export function systemHomepageDto(homepage: SystemHomepageLike) {
  return {
    id: homepage.id.toString(),
    content: homepage.content,
    status: homepage.status,
    createdAt: homepage.createdAt,
    updatedAt: homepage.updatedAt,
    isDeleted: homepage.isDeleted,
  }
}

export function projectMenuDto(menu: ProjectMenuLike): ReturnType<typeof projectMenuDtoBase> & {
  children: ReturnType<typeof projectMenuDto>[]
} {
  return {
    ...projectMenuDtoBase(menu),
    children: (menu.children || []).map(projectMenuDto),
  }
}

export function projectMenuDtoBase(menu: ProjectMenuLike) {
  return {
    id: menu.id.toString(),
    projectId: menu.projectId.toString(),
    parentId: menu.parentId?.toString() || null,
    label: menu.label,
    url: menu.url,
    isExternal: menu.isExternal,
    weight: menu.weight,
    status: menu.status,
    createdAt: menu.createdAt,
    updatedAt: menu.updatedAt,
    isDeleted: menu.isDeleted,
  }
}

export async function requireActiveProject(tx: Prisma.TransactionClient, projectId: bigint) {
  const project = await tx.project.findFirst({
    where: { id: projectId, isDeleted: false },
    select: { id: true },
  })
  if (!project) throw new HttpError('Project not found', 404, 404)
}

export async function validateMenuParent(
  tx: Prisma.TransactionClient,
  options: { projectId: bigint; parentId: bigint; currentId?: bigint },
) {
  if (options.currentId === options.parentId) {
    throw new HttpError('Cannot set self as parent', 400, 400)
  }
  const parent = await tx.projectMenu.findFirst({
    where: {
      id: options.parentId,
      projectId: options.projectId,
      parentId: null,
      isDeleted: false,
    },
    select: { id: true },
  })
  if (!parent) throw new HttpError('Parent menu not found in this project', 400, 400)
}

export function normalizeMenuUrl(rawUrl: unknown, isExternal: boolean) {
  if (rawUrl === undefined) return undefined
  if (rawUrl === null) return null
  if (typeof rawUrl !== 'string') throw new HttpError('Invalid url', 400, 400)
  const url = rawUrl.trim()
  if (!url) return null
  if (url.length > 2048) throw new HttpError('URL is too long', 400, 400)

  if (isExternal) {
    let parsed: URL
    try {
      parsed = new URL(url)
    } catch {
      throw new HttpError('External URL must be an absolute HTTP(S) URL', 400, 400)
    }
    if (parsed.protocol !== 'http:' && parsed.protocol !== 'https:') {
      throw new HttpError('External URL must use HTTP(S)', 400, 400)
    }
    return parsed.toString()
  }

  if (!url.startsWith('/') || url.startsWith('//')) {
    throw new HttpError('Internal URL must start with a single slash', 400, 400)
  }
  return url
}

export const ADMIN_CONFIG_DEFINITIONS = [
  {
    key: 'SOLANA_RPC_URL',
    group: 'solana',
    sensitive: false,
    description: 'Solana mainnet RPC URL',
    defaultValue: '',
  },
  {
    key: 'SOLANA_DEVNET_RPC_URL',
    group: 'solana',
    sensitive: false,
    description: 'Solana devnet RPC URL',
    defaultValue: '',
  },
  {
    key: 'FILEBASE_ACCESS_KEY',
    group: 'filebase',
    sensitive: true,
    description: 'Filebase IPFS access key',
    defaultValue: '',
  },
  {
    key: 'FILEBASE_SECRET_KEY',
    group: 'filebase',
    sensitive: true,
    description: 'Filebase IPFS secret key',
    defaultValue: '',
  },
  {
    key: 'FILEBASE_BUCKET',
    group: 'filebase',
    sensitive: false,
    description: 'Filebase bucket name',
    defaultValue: '',
  },
  {
    key: 'FILEBASE_ENDPOINT',
    group: 'filebase',
    sensitive: false,
    description: 'Filebase S3 endpoint',
    defaultValue: 'https://s3.filebase.com',
  },
] as const

export type AdminConfigKey = (typeof ADMIN_CONFIG_DEFINITIONS)[number]['key']

export function configDefinition(key: string) {
  return ADMIN_CONFIG_DEFINITIONS.find((item) => item.key === key)
}

export function validateConfigValue(key: AdminConfigKey, value: string) {
  if (value.length > 500) throw new HttpError(`${key} exceeds 500 characters`, 400, 400)
  if (key.endsWith('_URL') && value) {
    let parsed: URL
    try {
      parsed = new URL(value)
    } catch {
      throw new HttpError(`${key} must be a valid URL`, 400, 400)
    }
    if (parsed.protocol !== 'http:' && parsed.protocol !== 'https:') {
      throw new HttpError(`${key} must use HTTP(S)`, 400, 400)
    }
  }
  return value
}
