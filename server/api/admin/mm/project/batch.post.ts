import {prisma} from '~~/server/utils/prisma'
import {ok, fail} from '~~/server/utils/response'
import {readSession} from '~~/server/utils/session'
import {readBody, setResponseStatus} from 'h3'

function toBool(value: unknown) {
    if (typeof value === 'boolean') return value
    if (typeof value !== 'string') return null
    if (value === '1' || value.toLowerCase() === 'true') return true
    if (value === '0' || value.toLowerCase() === 'false') return false
    return null
}

function toInt(value: unknown) {
    const n = typeof value === 'string' ? Number(value) : typeof value === 'number' ? value : NaN
    return Number.isFinite(n) ? Math.trunc(n) : null
}

function parseIds(ids: unknown): bigint[] | null {
    if (!Array.isArray(ids) || ids.length === 0) return null
    const parsed: bigint[] = []
    for (const id of ids) {
        if (typeof id === 'number') {
            if (!Number.isFinite(id)) return null
            parsed.push(BigInt(Math.trunc(id)))
            continue
        }
        if (typeof id === 'string') {
            try {
                parsed.push(BigInt(id))
            } catch {
                return null
            }
            continue
        }
        return null
    }
    return parsed
}

export default defineEventHandler(async (event) => {
    const session = await readSession(event)
    if (!session) {
        setResponseStatus(event, 401)
        return fail('Unauthorized', 401)
    }

    const body = await readBody<{
        action?: 'delete' | 'restore' | 'setStatus' | 'setRequireAuth'
        ids?: unknown
        status?: number
        requireAuth?: boolean
    }>(event)

    const action = body?.action
    const ids = parseIds(body?.ids)
    if (!action || !ids) {
        setResponseStatus(event, 400)
        return fail('Missing action or ids', 400)
    }

    try {
        if (action === 'delete') {
            const result = await prisma.project.updateMany({
                where: {id: {in: ids}},
                data: {isDeleted: true, status: 0, updatedAt: new Date()},
            })
            return ok({count: result.count})
        }

        if (action === 'restore') {
            const result = await prisma.project.updateMany({
                where: {id: {in: ids}},
                data: {isDeleted: false, updatedAt: new Date()},
            })
            return ok({count: result.count})
        }

        if (action === 'setStatus') {
            const status = toInt(body?.status)
            if (status === null) {
                setResponseStatus(event, 400)
                return fail('Missing status', 400)
            }
            const result = await prisma.project.updateMany({
                where: {id: {in: ids}, isDeleted: false},
                data: {status, updatedAt: new Date()},
            })
            return ok({count: result.count})
        }

        if (action === 'setRequireAuth') {
            const requireAuth = typeof body?.requireAuth === 'boolean' ? body.requireAuth : toBool(body?.requireAuth)
            if (requireAuth === null) {
                setResponseStatus(event, 400)
                return fail('Missing requireAuth', 400)
            }
            const result = await prisma.project.updateMany({
                where: {id: {in: ids}, isDeleted: false},
                data: {requireAuth, updatedAt: new Date()},
            })
            return ok({count: result.count})
        }

        setResponseStatus(event, 400)
        return fail('Invalid action', 400)
    } catch (err) {
        setResponseStatus(event, 500)
        return fail('Internal Server Error', 500)
    }
})

