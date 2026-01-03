import {prisma} from '~~/server/utils/prisma'
import {ok, fail} from '~~/server/utils/response'
import {readSession} from '~~/server/utils/session'
import {readBody, setResponseStatus} from 'h3'

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
        action?: 'delete' | 'restore' | 'setStatus' | 'moveToProject'
        ids?: unknown
        status?: number
        projectId?: string | number
    }>(event)

    const action = body?.action
    const ids = parseIds(body?.ids)
    if (!action || !ids) {
        setResponseStatus(event, 400)
        return fail('Missing action or ids', 400)
    }

    try {
        if (action === 'delete') {
            const result = await prisma.projectVersion.updateMany({
                where: {id: {in: ids}},
                data: {isDeleted: true, status: 0, updatedAt: new Date()},
            })
            return ok({count: result.count})
        }

        if (action === 'restore') {
            const result = await prisma.projectVersion.updateMany({
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
            const result = await prisma.projectVersion.updateMany({
                where: {id: {in: ids}, isDeleted: false},
                data: {status, updatedAt: new Date()},
            })
            return ok({count: result.count})
        }

        if (action === 'moveToProject') {
            if (body?.projectId === undefined) {
                setResponseStatus(event, 400)
                return fail('Missing projectId', 400)
            }
            let projectId: bigint
            try {
                projectId = BigInt(String(body.projectId))
            } catch {
                setResponseStatus(event, 400)
                return fail('Invalid projectId', 400)
            }
            // 检查目标项目是否存在
            const project = await prisma.project.findUnique({
                where: {id: projectId, isDeleted: false},
            })
            if (!project) {
                setResponseStatus(event, 404)
                return fail('Project not found', 404)
            }
            const result = await prisma.projectVersion.updateMany({
                where: {id: {in: ids}, isDeleted: false},
                data: {projectId, updatedAt: new Date()},
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
