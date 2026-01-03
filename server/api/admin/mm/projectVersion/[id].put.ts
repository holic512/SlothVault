import {prisma} from '~~/server/utils/prisma'
import {ok, fail} from '~~/server/utils/response'
import {readSession} from '~~/server/utils/session'
import {getRouterParam, readBody, setResponseStatus} from 'h3'

function toInt(value: unknown) {
    const n = typeof value === 'string' ? Number(value) : typeof value === 'number' ? value : NaN
    return Number.isFinite(n) ? Math.trunc(n) : null
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

    const idRaw = getRouterParam(event, 'id')
    if (!idRaw) {
        setResponseStatus(event, 400)
        return fail('Missing id', 400)
    }

    let id: bigint
    try {
        id = BigInt(idRaw)
    } catch {
        setResponseStatus(event, 400)
        return fail('Invalid id', 400)
    }

    const body = await readBody<{
        projectId?: string | number
        version?: string
        description?: string
        weight?: number
        status?: number
    }>(event)

    const data: any = {updatedAt: new Date()}

    // 处理 projectId 更新
    if (body?.projectId !== undefined) {
        try {
            const newProjectId = BigInt(String(body.projectId))
            // 检查新项目是否存在
            const project = await prisma.project.findUnique({
                where: {id: newProjectId, isDeleted: false},
            })
            if (!project) {
                setResponseStatus(event, 404)
                return fail('Project not found', 404)
            }
            data.projectId = newProjectId
        } catch {
            setResponseStatus(event, 400)
            return fail('Invalid projectId', 400)
        }
    }

    if (typeof body?.version === 'string') {
        const ver = body.version.trim()
        if (!ver) {
            setResponseStatus(event, 400)
            return fail('Invalid version', 400)
        }
        data.version = ver
    }

    if (typeof body?.description === 'string') {
        data.description = body.description.trim() || null
    }

    const weight = toInt(body?.weight)
    if (weight !== null) data.weight = weight

    const status = toInt(body?.status)
    if (status !== null) data.status = status

    if (Object.keys(data).length === 1) {
        setResponseStatus(event, 400)
        return fail('No fields to update', 400)
    }

    try {
        const pv = await prisma.projectVersion.update({
            where: {id},
            data,
            include: {project: true},
        })
        return ok(projectVersionToDto(pv))
    } catch (err: any) {
        if (err?.code === 'P2025') {
            setResponseStatus(event, 404)
            return fail('Not Found', 404)
        }
        setResponseStatus(event, 500)
        return fail('Internal Server Error', 500)
    }
})
