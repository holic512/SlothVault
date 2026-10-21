import { NextRequest } from 'next/server'
import { beforeEach, describe, expect, it, vi } from 'vitest'

const db = vi.hoisted(() => ({
  $transaction: vi.fn(),
  project: { findFirst: vi.fn() },
  projectMenu: { create: vi.fn(), update: vi.fn(), findUnique: vi.fn() },
}))
const invalidate = vi.hoisted(() => vi.fn())
vi.mock('@/server/prisma', () => ({ prisma: db }))
vi.mock('@/server/services/admin-catalog', async () => import('@/server/services/admin-catalog/values'))
vi.mock('@/server/services/admin-trash', () => ({ deleteTrashItem: vi.fn() }))
vi.mock('@/server/services/public-project-cache', () => ({ invalidatePublicProjectCache: invalidate }))
vi.mock('@/server/services/file-references', () => ({
  assertManagedContentFiles: vi.fn(), indexFileWrite: (_tx: unknown, _type: unknown, write: Promise<unknown>) => write,
}))
vi.mock('@/server/auth/session', () => ({ requireAdminSession: vi.fn() }))
vi.mock('@/server/database/runtime-health', () => ({ readRuntimeInstallationPublicStatus: async () => ({ status: 'INSTALLED' }) }))

import { createProjectMenu, projectMenuDto, updateProjectMenu } from './admin-content'
import { POST } from '@/app/api/admin/mm/menu/route'
import { PUT } from '@/app/api/admin/mm/menu/[id]/route'

const timestamp = new Date('2026-10-21T00:00:00Z')
const menu = { id: 2, projectId: 1, parentId: null, label: 'Menu', icon: 'github', url: null,
  isExternal: false, weight: 0, status: 1, createdAt: timestamp, updatedAt: timestamp, isDeleted: false }

beforeEach(() => {
  vi.clearAllMocks()
  db.$transaction.mockImplementation(async operation => operation(db))
  db.project.findFirst.mockResolvedValue({ id: 1 })
  db.projectMenu.findUnique.mockResolvedValue(menu)
  db.projectMenu.create.mockImplementation(async ({ data }) => ({ ...menu, ...data }))
  db.projectMenu.update.mockImplementation(async ({ data }) => ({ ...menu, ...data }))
})

describe('project menu icon persistence', () => {
  it.each([undefined, null, 'github', 'none'])('creates with explicit nullable icon %s', async icon => {
    expect((await createProjectMenu(1, { label: 'Menu', icon })).icon).toBe(icon ?? null)
    expect(db.projectMenu.create).toHaveBeenCalledWith({ data: expect.objectContaining({ icon: icon ?? null }) })
    expect(invalidate).toHaveBeenCalledWith(1)
  })

  it('preserves omitted update icons, accepts icon-only writes, and returns nested icons', async () => {
    expect((await updateProjectMenu(2, { label: 'Renamed' })).icon).toBe('github')
    expect(db.projectMenu.update.mock.calls[0][0].data).not.toHaveProperty('icon')
    expect((await updateProjectMenu(2, { icon: null })).icon).toBeNull()
    expect((await updateProjectMenu(2, { icon: 'none' })).icon).toBe('none')
    expect(invalidate).toHaveBeenCalledWith(1)
    expect(projectMenuDto({ ...menu, children: [{ ...menu, id: 3, parentId: 2, icon: 'none' }] })).toMatchObject({ icon: 'github', children: [{ icon: 'none' }] })
  })

  it.each(['', 'Github', 'unknown', 42, false, {}])('rejects invalid create and update values before writing: %s', async icon => {
    await expect(createProjectMenu(1, { label: 'Menu', icon })).rejects.toMatchObject({ status: 400 })
    await expect(updateProjectMenu(2, { icon })).rejects.toMatchObject({ status: 400 })
    expect(db.projectMenu.create).not.toHaveBeenCalled()
    expect(db.projectMenu.update).not.toHaveBeenCalled()
    expect(invalidate).not.toHaveBeenCalled()
  })

  it('passes icon fields through POST/PUT and rejects invalid HTTP inputs', async () => {
    const request = (path: string, method: string, body: object) => new NextRequest(`http://localhost/api/admin/mm/menu${path}`, {
      method, headers: { 'Content-Type': 'application/json' }, body: JSON.stringify(body),
    })
    const created = await POST(request('', 'POST', { projectId: '1', label: 'Menu', icon: 'none' }), { params: Promise.resolve({}) })
    expect(created.status).toBe(201)
    expect((await created.json()).data.icon).toBe('none')
    const updated = await PUT(request('/2', 'PUT', { icon: null }), { params: Promise.resolve({ id: '2' }) })
    expect(updated.status).toBe(200)
    expect((await updated.json()).data.icon).toBeNull()
    expect((await PUT(request('/2', 'PUT', { icon: 'invalid' }), { params: Promise.resolve({ id: '2' }) })).status).toBe(400)
    expect((await POST(request('', 'POST', { projectId: '1', label: 'Menu', icon: 1 }), { params: Promise.resolve({}) })).status).toBe(400)
  })
})
