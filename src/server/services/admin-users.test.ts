import { beforeEach, describe, expect, it, vi } from 'vitest'

const mocks = vi.hoisted(() => ({
  hashPassword: vi.fn(),
  execute: vi.fn(),
  prisma: {
    user: { create: vi.fn() },
  },
  transaction: {
    user: { findUnique: vi.fn(), update: vi.fn() },
    session: { updateMany: vi.fn() },
  },
}))

vi.mock('@/server/auth/password', () => ({ hashPassword: mocks.hashPassword }))
vi.mock('@/server/database/unit-of-work', () => ({
  unitOfWork: { execute: mocks.execute },
}))
vi.mock('@/server/prisma', () => ({ prisma: mocks.prisma }))

import {
  createManagedUser,
  disableManagedUser,
  resetManagedUserPassword,
  updateManagedUser,
} from '@/server/services/admin-users'

const createdAt = new Date('2026-08-17T00:00:00.000Z')

function userRecord(overrides: Record<string, unknown> = {}) {
  return {
    id: 8,
    username: 'writer',
    email: 'writer@example.com',
    password: 'argon2-hash',
    passwordConfigured: true,
    displayName: 'Writer',
    avatar: null,
    bio: null,
    role: 'USER',
    status: 1,
    pointsBalance: 0,
    walletAddress: null,
    createdAt,
    updatedAt: createdAt,
    ...overrides,
  }
}

describe('administrator user management', () => {
  beforeEach(() => {
    vi.clearAllMocks()
    mocks.execute.mockImplementation((operation) => operation(mocks.transaction))
  })

  it('creates a regular active account without administrator role input', async () => {
    mocks.hashPassword.mockResolvedValue('new-argon2-hash')
    mocks.prisma.user.create.mockResolvedValue(userRecord())

    await expect(createManagedUser({
      username: ' Writer ',
      email: ' WRITER@example.com ',
      displayName: ' Writer ',
      password: 'safe-password',
    })).resolves.toMatchObject({ username: 'writer', role: 'USER', status: 1 })

    expect(mocks.prisma.user.create).toHaveBeenCalledWith({
      data: {
        username: 'writer',
        email: 'writer@example.com',
        displayName: 'Writer',
        password: 'new-argon2-hash',
        passwordConfigured: true,
        role: 'USER',
        status: 1,
      },
    })
  })

  it('updates supported profile and access fields', async () => {
    mocks.transaction.user.findUnique.mockResolvedValue(userRecord())
    mocks.transaction.user.update.mockResolvedValue(userRecord({
      email: 'revised@example.com',
      displayName: 'Revised Writer',
    }))

    await expect(updateManagedUser({
      actorUserId: 1,
      userId: 8,
      values: { email: ' ReViSeD@example.com ', displayName: ' Revised Writer ' },
    })).resolves.toMatchObject({
      email: 'revised@example.com',
      displayName: 'Revised Writer',
    })
  })

  it('disables a regular account and revokes all of its sessions instead of hard-deleting it', async () => {
    mocks.transaction.user.findUnique.mockResolvedValue(userRecord())
    mocks.transaction.user.update.mockResolvedValue(userRecord({ status: 0 }))

    await expect(disableManagedUser({ actorUserId: 1, userId: 8 })).resolves.toEqual({
      id: '8',
      status: 0,
    })
    expect(mocks.transaction.user.update).toHaveBeenCalledWith({
      where: { id: 8 },
      data: { status: 0, updatedAt: expect.any(Date) },
    })
    expect(mocks.transaction.session.updateMany).toHaveBeenCalledWith({
      where: { userId: 8, revokedAt: null },
      data: { revokedAt: expect.any(Date) },
    })
  })

  it('protects administrator accounts from disable requests', async () => {
    mocks.transaction.user.findUnique.mockResolvedValue(userRecord({ id: 9, role: 'ADMIN' }))

    await expect(disableManagedUser({ actorUserId: 1, userId: 9 })).rejects.toThrow(
      'Cannot disable an administrator account',
    )
    expect(mocks.transaction.user.update).not.toHaveBeenCalled()
  })

  it('resets a password and revokes every existing session', async () => {
    mocks.hashPassword.mockResolvedValue('reset-argon2-hash')
    mocks.transaction.user.findUnique.mockResolvedValue(userRecord())
    mocks.transaction.user.update.mockResolvedValue(userRecord({ passwordConfigured: true }))

    await expect(resetManagedUserPassword({ userId: 8, password: 'new-safe-password' })).resolves
      .toMatchObject({ id: '8', passwordConfigured: true })
    expect(mocks.transaction.user.update).toHaveBeenCalledWith({
      where: { id: 8 },
      data: {
        password: 'reset-argon2-hash',
        passwordConfigured: true,
        updatedAt: expect.any(Date),
      },
    })
    expect(mocks.transaction.session.updateMany).toHaveBeenCalledWith({
      where: { userId: 8, revokedAt: null },
      data: { revokedAt: expect.any(Date) },
    })
  })
})
