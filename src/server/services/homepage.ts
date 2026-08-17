/**
 * @file homepage.ts
 * @project SlothVault
 * @module Homepage
 * @description Owns the initial editable homepage record and supplies enabled content to the public viewer.
 * @logic Seed one empty homepage record during database initialization, then return only meaningful enabled content without mutating from public GET requests.
 * @dependencies Prisma SystemHomepage model, database client contract
 * @index_tags homepage,markdown,initialization,empty-content,public
 * @author holic512
 */
import 'server-only'

import type { AppPrismaClient } from '@/server/database/client'
import { prisma } from '@/server/prisma'

export async function ensureInitialHomepage(
  client: Pick<AppPrismaClient, 'systemHomepage'>,
) {
  const existing = await client.systemHomepage.findFirst({ select: { id: true } })
  if (existing) return false

  await client.systemHomepage.create({
    data: { content: '', status: 1 },
  })
  return true
}

export async function getHomepageContent() {
  try {
    const homepage = await prisma.systemHomepage.findFirst({
      where: { isDeleted: false, status: 1 },
      orderBy: { id: 'desc' },
      select: { content: true },
    })

    return homepage?.content.trim() || null
  } catch (error) {
    console.error('[homepage] Database unavailable; homepage content is unavailable', error)
    return null
  }
}
