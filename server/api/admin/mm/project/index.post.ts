import {prisma} from '~~/server/utils/prisma'
import {ok, fail} from '~~/server/utils/response'
import {readSession} from '~~/server/utils/session'
import {readBody, setResponseStatus} from 'h3'

function toInt(value: unknown, fallback: number) {
    const n = typeof value === 'string' ? Number(value) : typeof value === 'number' ? value : NaN
    return Number.isFinite(n) ? Math.trunc(n) : fallback
}

function projectToDto(project: any) {
    return {
        id: project.id.toString(),
        projectName: project.projectName,
        avatar: project.avatar,
        weight: project.weight,
        status: project.status,
        requireAuth: project.requireAuth,
        createdAt: project.createdAt,
        updatedAt: project.updatedAt,
        isDeleted: project.isDeleted,
    }
}

export default defineEventHandler(async (event) => {
    const session = await readSession(event)
    if (!session) {
        setResponseStatus(event, 401)
        return fail('Unauthorized', 401)
    }

    const body = await readBody<{
        projectName?: string
        avatar?: string | null
        weight?: number
        status?: number
        requireAuth?: boolean
    }>(event)

    const projectName = typeof body?.projectName === 'string' ? body.projectName.trim() : ''
    if (!projectName) {
        setResponseStatus(event, 400)
        return fail('Missing projectName', 400)
    }

    const avatar = typeof body?.avatar === 'string' ? body.avatar : null
    const weight = toInt(body?.weight, 0)
    const status = toInt(body?.status, 1)
    const requireAuth = typeof body?.requireAuth === 'boolean' ? body.requireAuth : false

    try {
        const project = await prisma.project.create({
            data: {projectName, avatar, weight, status, requireAuth},
        })
        setResponseStatus(event, 201)
        return ok(projectToDto(project), 'created')
    } catch (err) {
        setResponseStatus(event, 500)
        return fail('Internal Server Error', 500)
    }
})

