import { handleLegacyApiRequest } from '@/server/compat/adapter'
import type { NextRequest } from 'next/server'
import handler0 from '../../../../../../server/api/admin/mm/config/index.put'
import handler1 from '../../../../../../server/api/admin/mm/config/index.get'

export const runtime = 'nodejs'

export async function PUT(request: NextRequest, context: { params: Promise<Record<string, string | string[]>> }) {
  return handleLegacyApiRequest(handler0, request, await context.params)
}
export async function GET(request: NextRequest, context: { params: Promise<Record<string, string | string[]>> }) {
  return handleLegacyApiRequest(handler1, request, await context.params)
}
