/**
 * @file route.ts
 * @project SlothVault
 * @module Private Commission API
 * @description Provides authenticated commission lifecycle or protected artifact access.
 * @logic Bind the session actor, validate the owned commission, and delegate to transactional domain services.
 * @dependencies commission services, authentication, HTTP adapters
 * @index_tags api,commissions,privacy,lifecycle
 * @author holic512
 */
import { z } from 'zod'
import { requireAdminSession } from '@/server/auth/session'
import { defineRoute } from '@/server/http/handler'
import { readJson, parseBigIntId } from '@/server/http/request'
import { apiOk } from '@/server/http/response'
import { saveTemplateVersion, templateVersionInput } from '@/server/commissions/templates'
const input = templateVersionInput.extend({ versionId: z.number().int().positive().optional() })
export const POST = defineRoute<{ id: string }>(async (request, context) => { await requireAdminSession(request); return apiOk(await saveTemplateVersion({ ...await readJson(request, input, { maxBytes: 700000 }), templateId: parseBigIntId((await context.params).id) })) })
