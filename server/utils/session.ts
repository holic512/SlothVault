import {setCookie, getCookie, deleteCookie} from 'h3'
import {prisma} from '~~/server/utils/prisma'
import {randomBytes, createHash} from 'node:crypto'

const COOKIE_NAME = 'sv_session'
const DEFAULT_TTL_MS = 7 * 24 * 60 * 60 * 1000

function sha256(input: string) {
    return createHash('sha256').update(input).digest('hex')
}

export async function createSession(event: any, userId: number, ttlMs: number = DEFAULT_TTL_MS) {
    const token = randomBytes(32).toString('hex')
    const tokenHash = sha256(token)
    const expiresAt = new Date(Date.now() + ttlMs)
    const session = await prisma.session.create({
        data: {userId, tokenHash, expiresAt}
    })
    setCookie(event, COOKIE_NAME, token, {
        httpOnly: true,
        sameSite: 'lax',
        secure: process.env.NODE_ENV === 'production',
        path: '/',
        maxAge: Math.floor(ttlMs / 1000)
    })
    return {id: session.id, expiresAt}
}

export async function readSession(event: any) {
    const token = getCookie(event, COOKIE_NAME)
    if (!token) return null
    const tokenHash = sha256(token)
    const session = await prisma.session.findUnique({
        where: {tokenHash},
        include: {User: true}
    })
    if (!session) return null
    if (session.revokedAt) return null
    if (session.expiresAt.getTime() <= Date.now()) return null
    return session
}

export async function destroySession(event: any) {
    const token = getCookie(event, COOKIE_NAME)
    if (!token) return
    const tokenHash = sha256(token)
    await prisma.session.updateMany({
        where: {tokenHash, revokedAt: null},
        data: {revokedAt: new Date()}
    })
    deleteCookie(event, COOKIE_NAME, {path: '/'})
}
