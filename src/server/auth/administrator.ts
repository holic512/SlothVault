/**
 * @file administrator.ts
 * @project SlothVault
 * @module Administrator Authorization
 * @description Rechecks the active administrator identity for site-wide evidence operations.
 * @logic Authorize the current operator independently of the historical request creator.
 * @dependencies Prisma user reader, HTTP errors
 * @index_tags admin,authorization,evidence,site
 * @author holic512
 */
import 'server-only'
import type { Prisma } from '@generated/prisma-postgresql/client'
import { HttpError } from '@/server/http/errors'

export async function assertActiveAdministrator(
  reader: Pick<Prisma.TransactionClient, 'user'>,
  userId: number,
) {
  const user = await reader.user.findUnique({
    where: { id: userId },
    select: { role: true, status: true },
  })
  if (!user || user.role !== 'ADMIN' || user.status !== 1) {
    throw new HttpError('Unauthorized', 401, 401)
  }
}
