/**
 * @file admin-content.ts
 * @project SlothVault
 * @module Admin Content Services
 * @description Owns project-home, project-menu, and system-homepage persistence, validation, transactions, and stable DTO mapping.
 * @logic Validate content commands, enforce active project and two-level menu invariants, execute atomic mutations, and serialize database records for admin APIs.
 * @dependencies Prisma project content models, server/http/errors, admin-catalog helpers
 * @index_tags admin,homepage,project-menu,system-homepage,transaction,dto,validation
 * @author holic512
 */
import 'server-only'

import type { Prisma } from '@generated/prisma-postgresql/client'

import { HttpError } from '@/server/http/errors'
import { prisma } from '@/server/prisma'
import {
  hasPrismaCode,
  integerValue,
  optionalIntegerValue,
  parseJsonDecimalId,
} from '@/server/services/admin-catalog'

type ProjectHomeLike = {
  id: number
  projectId: number
  content: string
  status: number
  createdAt: Date
  updatedAt: Date
  isDeleted: boolean
}

type SystemHomepageLike = {
  id: number
  content: string
  status: number
  createdAt: Date
  updatedAt: Date
  isDeleted: boolean
}

type ProjectMenuLike = {
  id: number
  projectId: number
  parentId: number | null
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

export type CreateProjectHomeInput = {
  content?: unknown
  status?: unknown
}

export type UpdateProjectHomeInput = {
  content?: unknown
  status?: unknown
  isDeleted?: unknown
}

export type ListProjectMenusInput = {
  projectId: number
  tree: boolean
  includeDeleted: boolean
}

export type CreateProjectMenuInput = {
  parentId?: unknown
  label?: unknown
  url?: unknown
  isExternal?: unknown
  weight?: unknown
  status?: unknown
}

export type UpdateProjectMenuInput = CreateProjectMenuInput & {
  isDeleted?: unknown
}

export type CreateSystemHomepageInput = {
  content?: unknown
  status?: unknown
}

export type UpdateSystemHomepageInput = {
  content?: unknown
  status?: unknown
  isDeleted?: unknown
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

export async function requireActiveProject(tx: Prisma.TransactionClient, projectId: number) {
  const project = await tx.project.findFirst({
    where: { id: projectId, isDeleted: false },
    select: { id: true },
  })
  if (!project) throw new HttpError('Project not found', 404, 404)
}

export async function validateMenuParent(
  tx: Prisma.TransactionClient,
  options: { projectId: number; parentId: number; currentId?: number },
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

export async function getProjectHomeByProjectId(projectId: number) {
  const home = await prisma.projectHome.findUnique({ where: { projectId } })
  if (!home) throw new HttpError('Not Found', 404, 404)
  return projectHomeDto(home)
}

export async function createOrRestoreProjectHome(
  projectId: number,
  input: CreateProjectHomeInput,
) {
  if (typeof input.content !== 'string') throw new HttpError('Missing content', 400, 400)

  const home = await prisma.$transaction(async (tx) => {
    await requireActiveProject(tx, projectId)
    return tx.projectHome.upsert({
      where: { projectId },
      update: {
        content: input.content as string,
        status: integerValue(input.status, 1),
        isDeleted: false,
        updatedAt: new Date(),
      },
      create: {
        projectId,
        content: input.content as string,
        status: integerValue(input.status, 1),
      },
    })
  })
  return projectHomeDto(home)
}

export async function getProjectHome(id: number) {
  const home = await prisma.projectHome.findUnique({ where: { id } })
  if (!home) throw new HttpError('Not Found', 404, 404)
  return projectHomeDto(home)
}

export async function updateProjectHome(id: number, input: UpdateProjectHomeInput) {
  const existing = await prisma.projectHome.findUnique({ where: { id } })
  if (!existing) throw new HttpError('Not Found', 404, 404)
  if (input.isDeleted === false) {
    await prisma.$transaction((tx) => requireActiveProject(tx, existing.projectId))
  }

  const data: Prisma.ProjectHomeUpdateInput = { updatedAt: new Date() }
  if (typeof input.content === 'string') data.content = input.content
  const status = optionalIntegerValue(input.status)
  if (status !== null) data.status = status
  if (typeof input.isDeleted === 'boolean') data.isDeleted = input.isDeleted
  if (Object.keys(data).length === 1) throw new HttpError('No fields to update', 400, 400)

  try {
    const home = await prisma.projectHome.update({ where: { id }, data })
    return projectHomeDto(home)
  } catch (error) {
    if (hasPrismaCode(error, 'P2025')) throw new HttpError('Not Found', 404, 404)
    throw error
  }
}

export async function deleteProjectHome(id: number, hard: boolean) {
  try {
    if (hard) await prisma.projectHome.delete({ where: { id } })
    else {
      await prisma.projectHome.update({
        where: { id },
        data: { isDeleted: true, updatedAt: new Date() },
      })
    }
  } catch (error) {
    if (hasPrismaCode(error, 'P2025')) throw new HttpError('Not Found', 404, 404)
    throw error
  }
}

export async function listProjectMenus(input: ListProjectMenusInput) {
  const project = await prisma.project.findFirst({
    where: { id: input.projectId, isDeleted: false },
  })
  if (!project) throw new HttpError('Project not found', 404, 404)

  const baseWhere = {
    projectId: input.projectId,
    ...(input.includeDeleted ? {} : { isDeleted: false }),
  }
  if (input.tree) {
    const list = await prisma.projectMenu.findMany({
      where: { ...baseWhere, parentId: null },
      include: {
        children: {
          where: input.includeDeleted ? {} : { isDeleted: false },
          orderBy: [{ weight: 'desc' }, { id: 'asc' }],
        },
      },
      orderBy: [{ weight: 'desc' }, { id: 'asc' }],
    })
    return list.map(projectMenuDto)
  }

  const list = await prisma.projectMenu.findMany({
    where: baseWhere,
    orderBy: [{ weight: 'desc' }, { id: 'asc' }],
  })
  return list.map(projectMenuDtoBase)
}

export async function createProjectMenu(projectId: number, input: CreateProjectMenuInput) {
  const label = typeof input.label === 'string' ? input.label.trim() : ''
  if (!label) throw new HttpError('Missing label', 400, 400)
  if (label.length > 64) throw new HttpError('Label is too long', 400, 400)
  const isExternal = input.isExternal === true
  const parentId =
    input.parentId === undefined || input.parentId === null || input.parentId === ''
      ? null
      : parseJsonDecimalId(input.parentId, 'parentId')
  const url = normalizeMenuUrl(input.url, isExternal)

  const menu = await prisma.$transaction(async (tx) => {
    await requireActiveProject(tx, projectId)
    if (parentId) await validateMenuParent(tx, { projectId, parentId })
    return tx.projectMenu.create({
      data: {
        projectId,
        parentId,
        label,
        url,
        isExternal,
        weight: integerValue(input.weight, 0),
        status: integerValue(input.status, 1),
      },
    })
  })
  return projectMenuDtoBase(menu)
}

export async function getProjectMenu(id: number) {
  const menu = await prisma.projectMenu.findUnique({
    where: { id },
    include: {
      children: {
        where: { isDeleted: false },
        orderBy: [{ weight: 'desc' }, { id: 'asc' }],
      },
    },
  })
  if (!menu) throw new HttpError('Not Found', 404, 404)
  return projectMenuDto(menu)
}

export async function updateProjectMenu(id: number, input: UpdateProjectMenuInput) {
  const menu = await prisma.$transaction(async (tx) => {
    const current = await tx.projectMenu.findUnique({ where: { id } })
    if (!current) throw new HttpError('Not Found', 404, 404)
    const resultingExternal =
      typeof input.isExternal === 'boolean' ? input.isExternal : current.isExternal
    const resultingUrl =
      input.url !== undefined
        ? normalizeMenuUrl(input.url, resultingExternal)
        : input.isExternal !== undefined
          ? normalizeMenuUrl(current.url, resultingExternal)
          : undefined
    const data: Prisma.ProjectMenuUpdateInput = { updatedAt: new Date() }

    if (input.parentId !== undefined) {
      if (input.parentId === null || input.parentId === '') data.parent = { disconnect: true }
      else {
        const parentId = parseJsonDecimalId(input.parentId, 'parentId')
        const childCount = await tx.projectMenu.count({ where: { parentId: id } })
        if (childCount > 0) {
          throw new HttpError('A menu with children cannot become a child menu', 400, 400)
        }
        await validateMenuParent(tx, {
          projectId: current.projectId,
          parentId,
          currentId: id,
        })
        data.parent = { connect: { id: parentId } }
      }
    }
    if (typeof input.label === 'string') {
      const label = input.label.trim()
      if (!label) throw new HttpError('Label cannot be empty', 400, 400)
      if (label.length > 64) throw new HttpError('Label is too long', 400, 400)
      data.label = label
    }
    if (resultingUrl !== undefined) data.url = resultingUrl
    if (typeof input.isExternal === 'boolean') data.isExternal = input.isExternal
    if (input.weight !== undefined) data.weight = integerValue(input.weight, current.weight)
    if (input.status !== undefined) data.status = integerValue(input.status, current.status)
    if (typeof input.isDeleted === 'boolean') {
      if (!input.isDeleted && current.parentId) {
        const parent = await tx.projectMenu.findFirst({
          where: { id: current.parentId, projectId: current.projectId, isDeleted: false },
        })
        if (!parent) throw new HttpError('Restore the parent menu first', 400, 400)
      }
      data.isDeleted = input.isDeleted
    }
    if (Object.keys(data).length === 1) throw new HttpError('No fields to update', 400, 400)
    return tx.projectMenu.update({ where: { id }, data })
  })
  return projectMenuDtoBase(menu)
}

export async function deleteProjectMenu(id: number, hard: boolean) {
  await prisma.$transaction(async (tx) => {
    const current = await tx.projectMenu.findUnique({ where: { id } })
    if (!current) throw new HttpError('Not Found', 404, 404)
    if (hard) {
      await tx.projectMenu.deleteMany({ where: { parentId: id } })
      await tx.projectMenu.delete({ where: { id } })
    } else {
      const now = new Date()
      await tx.projectMenu.updateMany({
        where: { parentId: id },
        data: { isDeleted: true, updatedAt: now },
      })
      await tx.projectMenu.update({
        where: { id },
        data: { isDeleted: true, updatedAt: now },
      })
    }
  })
}

export async function getSystemHomepage() {
  const homepage = await prisma.systemHomepage.findFirst({
    where: { isDeleted: false },
    orderBy: { id: 'desc' },
  })
  if (!homepage) throw new HttpError('Not Found', 404, 404)
  return systemHomepageDto(homepage)
}

export async function createSystemHomepage(input: CreateSystemHomepageInput) {
  if (typeof input.content !== 'string') throw new HttpError('Invalid content', 400, 400)
  const homepage = await prisma.systemHomepage.create({
    data: { content: input.content, status: integerValue(input.status, 1) },
  })
  return systemHomepageDto(homepage)
}

export async function updateSystemHomepage(id: number, input: UpdateSystemHomepageInput) {
  const data: Prisma.SystemHomepageUpdateInput = { updatedAt: new Date() }
  if (typeof input.content === 'string') data.content = input.content
  const status = optionalIntegerValue(input.status)
  if (status !== null) data.status = status
  if (typeof input.isDeleted === 'boolean') data.isDeleted = input.isDeleted
  if (Object.keys(data).length === 1) throw new HttpError('No fields to update', 400, 400)

  try {
    const homepage = await prisma.systemHomepage.update({ where: { id }, data })
    return systemHomepageDto(homepage)
  } catch (error) {
    if (hasPrismaCode(error, 'P2025')) throw new HttpError('Not Found', 404, 404)
    throw error
  }
}
