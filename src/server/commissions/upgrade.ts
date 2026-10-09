/**
 * @file upgrade.ts
 * @project SlothVault
 * @module Commission Workflow Upgrade
 * @description Seeds the current template without deleting legacy contracts or evidence.
 * @logic Preserve all history on startup; test-data cleanup is a separate, explicitly scoped one-shot command.
 * @dependencies Prisma client, simple template seed
 * @index_tags commissions,migration,history,templates
 * @author holic512
 */
import 'server-only'
import type { AppPrismaClient } from '@/server/database/client'
import { seedSimpleTemplate } from './simple-templates'
export async function upgradeCommissionLifecycle(client: AppPrismaClient) {
  await seedSimpleTemplate(client)
}
