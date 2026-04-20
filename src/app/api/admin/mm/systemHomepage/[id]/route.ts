import { handleLegacyApiRequest } from '@/server/compat/adapter'
import type { NextRequest } from 'next/server'
import handler0 from '../../../../../../../server/api/admin/mm/systemHomepage/[id].put'

export const runtime = 'nodejs'

export async function PUT(request: NextRequest, context: { params: Promise<Record<string, string | string[]>> }) {
  return handleLegacyApiRequest(handler0, request, await context.params)
}
