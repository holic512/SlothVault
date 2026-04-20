import { handleLegacyApiRequest } from '@/server/compat/adapter'
import type { NextRequest } from 'next/server'
import handler0 from '../../../../../../server/api/project/[id]/verify-access.post'

export const runtime = 'nodejs'

export async function POST(request: NextRequest, context: { params: Promise<Record<string, string | string[]>> }) {
  return handleLegacyApiRequest(handler0, request, await context.params)
}
