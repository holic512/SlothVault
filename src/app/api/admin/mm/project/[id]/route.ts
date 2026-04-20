import { handleLegacyApiRequest } from '@/server/compat/adapter'
import type { NextRequest } from 'next/server'
import handler0 from '../../../../../../../server/api/admin/mm/project/[id].put'
import handler1 from '../../../../../../../server/api/admin/mm/project/[id].get'
import handler2 from '../../../../../../../server/api/admin/mm/project/[id].delete'

export const runtime = 'nodejs'

export async function PUT(request: NextRequest, context: { params: Promise<Record<string, string | string[]>> }) {
  return handleLegacyApiRequest(handler0, request, await context.params)
}
export async function GET(request: NextRequest, context: { params: Promise<Record<string, string | string[]>> }) {
  return handleLegacyApiRequest(handler1, request, await context.params)
}
export async function DELETE(request: NextRequest, context: { params: Promise<Record<string, string | string[]>> }) {
  return handleLegacyApiRequest(handler2, request, await context.params)
}
