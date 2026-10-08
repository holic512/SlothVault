/**
 * @file content-access.ts
 * @project SlothVault
 * @module Content Authorization
 * @description Owns current project capability policies and explicit article membership matching.
 * @logic Read authoritative policies and active independent memberships per request, then require authorization before body or byte access.
 * @dependencies Prisma project/article membership relations, membership service, auth roles, HTTP errors
 * @index_tags authorization,project,article,membership,read,download,cache-boundary
 * @author holic512
 */
import 'server-only'
import { z } from 'zod'
import { isAdminRole } from '@/server/auth/roles'
import { HttpError } from '@/server/http/errors'
import { prisma } from '@/server/prisma'
import { getActiveMemberships } from './membership'
import {
  evaluateProjectAccess, type AccessRule, type AccessViewer,
  type DownloadAccessMode, type ProjectAccess, type ReadAccessMode,
} from '@/lib/content-access'

const idsSchema = z.array(z.coerce.number().int().positive().max(2_147_483_647)).max(1000)
const ruleShape = { membershipLevelIds: idsSchema.default([]) }
export const readAccessSchema = z.object({ mode: z.enum(['PUBLIC', 'LOGIN', 'MEMBERSHIPS']), ...ruleShape })
export const downloadAccessSchema = z.object({ mode: z.enum(['FOLLOW_READ', 'LOGIN', 'MEMBERSHIPS', 'DISABLED']), ...ruleShape })
export const allowedMembershipIdsSchema = idsSchema
export const accessMembershipSelect = { id: true, name: true, status: true } as const
export const projectAccessInclude = {
  readMemberships: { include: { membershipLevel: { select: accessMembershipSelect } } },
  downloadMemberships: { include: { membershipLevel: { select: accessMembershipSelect } } },
} as const
type LinkedMembership = { membershipLevelId: number; membershipLevel: { id: number; name: string; status: number } }
export type ProjectPolicyRecord = {
  readAccessMode?: string; downloadAccessMode?: string
  readMemberships?: LinkedMembership[]; downloadMemberships?: LinkedMembership[]
}

function rule<Mode extends ReadAccessMode | DownloadAccessMode>(mode: Mode, records: LinkedMembership[] = []): AccessRule<Mode> {
  return {
    mode, membershipLevelIds: records.map((item) => String(item.membershipLevelId)),
    membershipLevels: records.map(({ membershipLevel }) => ({ ...membershipLevel, id: String(membershipLevel.id) })),
  }
}

export function projectPolicyDto(project: ProjectPolicyRecord) {
  // Unrecognized stored modes fail closed rather than becoming public.
  const readMode = project.readAccessMode ?? 'PUBLIC'
  const downloadMode = project.downloadAccessMode ?? 'FOLLOW_READ'
  return {
    readAccess: rule<ReadAccessMode>(['PUBLIC', 'LOGIN', 'MEMBERSHIPS'].includes(readMode) ? readMode as ReadAccessMode : 'MEMBERSHIPS', project.readMemberships),
    downloadAccess: rule<DownloadAccessMode>(['FOLLOW_READ', 'LOGIN', 'MEMBERSHIPS', 'DISABLED'].includes(downloadMode) ? downloadMode as DownloadAccessMode : 'DISABLED', project.downloadMemberships),
  }
}

export async function validateMembershipIds(ids: number[]) {
  const unique = [...new Set(ids)]
  if (unique.length) {
    const found = await prisma.membershipLevel.findMany({ where: { id: { in: unique } }, select: { id: true } })
    if (found.length !== unique.length) throw new HttpError('Membership type not found', 400, 400)
  }
  return unique
}

export async function parseAccessRule(value: unknown, download = false) {
  const parsed = (download ? downloadAccessSchema : readAccessSchema).parse(value)
  if (parsed.mode === 'MEMBERSHIPS' && !parsed.membershipLevelIds.length) {
    throw new HttpError('Select at least one membership type', 400, 400)
  }
  if (parsed.mode !== 'MEMBERSHIPS' && parsed.membershipLevelIds.length) {
    throw new HttpError('Membership list requires membership access mode', 400, 400)
  }
  return { ...parsed, membershipLevelIds: await validateMembershipIds(parsed.membershipLevelIds) }
}

export async function resolveProjectAccess(projectId: number, viewer: AccessViewer = null): Promise<ProjectAccess> {
  const project = await prisma.project.findFirst({
    where: { id: projectId, status: 1, isDeleted: false }, include: projectAccessInclude,
  })
  if (!project) throw new HttpError('Project not found', 404, 404)
  const administrator = Boolean(viewer && isAdminRole(viewer.role))
  const memberships = viewer && !administrator ? await getActiveMemberships(viewer.userId) : []
  return evaluateProjectAccess(projectPolicyDto(project), Boolean(viewer), memberships.map((item) => item.id), administrator)
}

export function requireProjectCapability(access: ProjectAccess, capability: 'read' | 'download') {
  const allowed = capability === 'read' ? access.canRead : access.canDownload
  if (allowed) return
  const reason = capability === 'read' ? access.readReason : access.downloadReason
  throw new HttpError('Access denied', reason === 'LOGIN_REQUIRED' ? 401 : 403, reason === 'LOGIN_REQUIRED' ? 401 : 403, { reason })
}

export async function resolveArticleAccess(articleId: number, viewer: AccessViewer = null) {
  const article = await prisma.article.findFirst({
    where: { id: articleId, status: 1, isDeleted: false, publishedAt: { not: null } },
    select: { allowedMemberships: { select: { membershipLevelId: true } } },
  })
  if (!article) throw new HttpError('Article not found', 404, 404)
  const allowedIds = article.allowedMemberships.map((item) => String(item.membershipLevelId))
  if (!allowedIds.length || (viewer && isAdminRole(viewer.role))) return true
  if (!viewer) return false
  return (await getActiveMemberships(viewer.userId)).some((item) => allowedIds.includes(item.id))
}
