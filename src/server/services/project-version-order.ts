/**
 * @file project-version-order.ts
 * @project SlothVault
 * @module Version Ordering
 * @description Shares deterministic publication-first ordering across admin and public readers.
 * @logic Put released versions before drafts; break publication ties by ID and sort drafts by creation time.
 * @dependencies Prisma order input types
 * @index_tags versions,ordering,publication
 * @author holic512
 */
import type { Prisma } from '@generated/prisma-postgresql/client'

export const publishedVersionOrder: Prisma.ProjectVersionOrderByWithRelationInput[] = [
  { publishedAt: 'desc' }, { id: 'desc' },
]

export function projectVersionOrder(field: string = 'publishedAt', order: 'asc' | 'desc' = 'desc'): Prisma.ProjectVersionOrderByWithRelationInput[] {
  return [{ [field]: order }, { id: 'desc' }]
}
