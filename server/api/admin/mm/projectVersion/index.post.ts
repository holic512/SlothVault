import {prisma} from '~~/server/utils/prisma'
import {ok, fail} from '~~/server/utils/response'
import {readSession} from '~~/server/utils/session'
import {readBody, setResponseStatus} from 'h3'

function toInt(value: unknown, fallback: number) {
    const n = typeof value === 'string' ? Number(value) : typeof value === 'number' ? value : NaN
    return Number.isFinite(n) ? Math.trunc(n) : fallback
}

function projectVersionToDto(pv: any) {
    return {
        id: pv.id.toString(),
        projectId: pv.projectId.toString(),
        version: pv.version,
        description: pv.description,
        weight: pv.weight,
        status: pv.status,
        createdAt: pv.createdAt,
        updatedAt: pv.updatedAt,
        isDeleted: pv.isDeleted,
        project: pv.project ? {
            id: pv.project.id.toString(),
            projectName: pv.project.projectName,
        } : null,
    }
}

export default defineEventHandler(async (event) => {
    const session = await readSession(event)
    if (!session) {
        setResponseStatus(event, 401)
        return fail('Unauthorized', 401)
    }

    const body = await readBody<{
        projectId?: string | number
        version?: string
        description?: string
        weight?: number
        status?: number
    }>(event)

    // 验证 projectId
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

    // 验证 version
    const version = typeof body?.version === 'string' ? body.version.trim() : ''
    if (!version) {
        setResponseStatus(event, 400)
        return fail('Missing version', 400)
    }

    const description = typeof body?.description === 'string' ? body.description.trim() : null
    const weight = toInt(body?.weight, 0)
    const status = toInt(body?.status, 1)

    try {
        // 检查项目是否存在
        const project = await prisma.project.findUnique({
            where: {id: projectId, isDeleted: false},
        })
        if (!project) {
            setResponseStatus(event, 404)
            return fail('Project not found', 404)
        }

        const pv = await prisma.projectVersion.create({
            data: {projectId, version, description, weight, status},
            include: {project: true},
        })
        setResponseStatus(event, 201)
        return ok(projectVersionToDto(pv), 'created')
    } catch (err) {
        setResponseStatus(event, 500)
        return fail('Internal Server Error', 500)
    }
})
