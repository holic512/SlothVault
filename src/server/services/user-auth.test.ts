import { beforeEach, describe, expect, it, vi } from 'vitest'

const mocks = vi.hoisted(() => ({
  hashPassword: vi.fn(),
  verifyPassword: vi.fn(),
  issueSession: vi.fn(),
  execute: vi.fn(),
  prisma: {
    user: {
      create: vi.fn(),
      findFirst: vi.fn(),
      findUnique: vi.fn(),
      update: vi.fn(),
      updateMany: vi.fn(),
      findUniqueOrThrow: vi.fn(),
    },
  },
}))

vi.mock('@/server/services/file-references', () => ({ indexFileWrite: (_tx: unknown, _type: unknown, write: Promise<unknown>) => write, syncFileReferences: vi.fn() }))

vi.mock('@/server/auth/password', () => ({
  hashPassword: mocks.hashPassword,
  verifyPassword: mocks.verifyPassword,
}))
vi.mock('@/server/auth/session', () => ({ issueSession: mocks.issueSession }))
vi.mock('@/server/database/unit-of-work', () => ({
  unitOfWork: { execute: mocks.execute },
}))
vi.mock('@/server/prisma', () => ({ prisma: mocks.prisma }))

import { loginUser, registerUser, updateUserAvatar } from '@/server/services/user-auth'

const createdAt = new Date('2026-07-30T00:00:00.000Z')
const updatedAt = new Date('2026-07-30T00:00:00.000Z')

function userRecord(overrides: Record<string, unknown> = {}) {
  return {
    id: 7,
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
    lastLoginAt: null,
    createdAt,
    updatedAt,
    ...overrides,
  }
}

describe('conventional user authentication', () => {
  beforeEach(() => {
    vi.clearAllMocks()
    mocks.execute.mockImplementation((operation) => operation(mocks.prisma))
  })

  it('normalizes credentials and always registers a regular Web2 user', async () => {
    mocks.hashPassword.mockResolvedValue('argon2-hash')
    mocks.prisma.user.create.mockResolvedValue(userRecord())

    const result = await registerUser({
      username: '  WRITER ',
      email: ' Writer@Example.COM ',
      displayName: ' Writer ',
      password: 'safe-password',
    })

    expect(mocks.prisma.user.create).toHaveBeenCalledWith({
      data: {
        username: 'writer',
        email: 'writer@example.com',
        password: 'argon2-hash',
        displayName: 'Writer',
        role: 'USER',
        status: 1,
      },
    })
    expect(result.user).toMatchObject({
      id: '7',
      username: 'writer',
      role: 'USER',
      pointsBalance: 0,
      walletAddress: null,
    })
  })

  it('logs in by username or email and issues the ordinary database session', async () => {
    mocks.prisma.user.findFirst.mockResolvedValue(userRecord())
    mocks.verifyPassword.mockResolvedValue(true)
    mocks.prisma.user.updateMany.mockResolvedValue({ count: 1 })
    mocks.prisma.user.findUniqueOrThrow.mockResolvedValue(userRecord({ lastLoginAt: new Date() }))
    mocks.issueSession.mockResolvedValue({
      token: 'session-token',
      expiresAt: new Date('2026-08-29T00:00:00.000Z'),
      sessionId: 'session-id',
    })

    const result = await loginUser({
      identifier: ' WRITER@EXAMPLE.COM ',
      password: 'safe-password',
      remember: true,
      ip: '127.0.0.1',
      userAgent: 'vitest',
    })

    expect(mocks.prisma.user.findFirst).toHaveBeenCalledWith({
      where: {
        OR: [
          { username: 'writer@example.com' },
          { email: 'writer@example.com' },
        ],
      },
    })
    expect(mocks.issueSession).toHaveBeenCalledWith({
      userId: 7,
      persistent: true,
      ip: '127.0.0.1',
      userAgent: 'vitest',
    }, mocks.prisma)
    expect(result.user.role).toBe('USER')
  })

  it('refuses to issue a session if credentials changed after password verification', async () => {
    mocks.prisma.user.findFirst.mockResolvedValue(userRecord())
    mocks.verifyPassword.mockResolvedValue(true)
    mocks.prisma.user.updateMany.mockResolvedValue({ count: 0 })
    await expect(loginUser({ identifier: 'writer', password: 'safe-password', remember: false, ip: null, userAgent: null })).rejects.toMatchObject({ status: 401 })
    expect(mocks.issueSession).not.toHaveBeenCalled()
  })

  it('updates the avatar only through the dedicated managed-avatar operation', async () => {
    const avatar = '/uploads/user-avatar/5d6d4d83-04dc-45bb-b8bf-409b181d1a2c.webp'
    mocks.prisma.user.update.mockResolvedValue(userRecord({ avatar }))

    await expect(updateUserAvatar(7, avatar)).resolves.toMatchObject({ avatar })
    expect(mocks.prisma.user.update).toHaveBeenCalledWith({
      where: { id: 7 },
      data: { avatar, updatedAt: expect.any(Date) },
    })
  })
})
