/**
 * @file file-classification-upgrade.ts
 * @project SlothVault
 * @module Database File Classification Upgrade
 * @description Converts legacy article and note images to explicit image categories.
 * @logic Update only classification in one transaction; preserve IDs, storage paths, content and release hashes.
 * @dependencies AppPrismaClient, file-business-types
 * @index_tags files,migration,classification
 * @author holic512
 */
import 'server-only'
import type { AppPrismaClient } from './client'
import { normalizeLegacyFileBusinessType } from '@/lib/file-business-types'

export async function upgradeFileClassifications(client: AppPrismaClient) {
  return client.$transaction(async (tx) => {
    const files = await tx.fileManagement.findMany({
      where: { businessType: { in: ['ArticleAttachment', 'NoteAttachment'] } },
      select: { id: true, fileName: true, businessType: true },
    })
    const groups = new Map<string, number[]>()
    for (const file of files) {
      const type = normalizeLegacyFileBusinessType(file.businessType, file.fileName)
      if (type !== file.businessType) {
        const ids = groups.get(type) || []
        ids.push(file.id)
        groups.set(type, ids)
      }
    }
    let updated = 0
    for (const [businessType, ids] of groups) {
      for (let start = 0; start < ids.length; start += 500) {
        const result = await tx.fileManagement.updateMany({ where: { id: { in: ids.slice(start, start + 500) } }, data: { businessType } })
        updated += result.count
      }
    }
    return { updated }
  }, { timeout: 120_000 })
}
