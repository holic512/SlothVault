/**
 * @file route.ts
 * @project SlothVault
 * @module Plugin UI Discovery
 * @description Returns only enabled, authorized and browser-safe contribution descriptors.
 * @logic Resolve the shared session and filter each contribution without exposing server configuration.
 * @dependencies plugin access, shared session, HTTP handler
 * @index_tags plugins,ui,registry,permissions
 * @author holic512
 */
import { readSession } from '@/server/auth/session'
import { defineRoute } from '@/server/http/handler'
import { apiOk } from '@/server/http/response'
import { pluginContributions } from '@/server/plugins/access'
export const GET = defineRoute(async request => { const session = await readSession(request); return apiOk(await pluginContributions(request.nextUrl.searchParams.get('surface') ?? 'public', session ? { userId: session.userId, role: session.User.role } : null)) }, { cacheControl: 'private, no-store' })
