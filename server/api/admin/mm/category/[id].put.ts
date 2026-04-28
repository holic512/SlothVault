import {prisma} from '~~/server/utils/prisma'
import {ok, fail} from '~~/server/utils/response'
import {readSession} from '~~/server/utils/session'
import {getRouterParam, readBody, setResponseStatus} from 'h3'

function toInt(value: unknown) {
    const n = typeof value === 'string' ? Number(value) : typeof value === 'number' ? value : NaN
    return Number.isFinite(n) ? Math.trunc(n) : null
}

function categoryToDto(cat: any) {
    return {
        id: cat.id.toString(),
        projectVersionId: cat.projectVersionId.toString(),
        categoryName: cat.categoryName,
        weight: cat.weight,
        status: cat.status,
        createdAt: cat.createdAt,
        updatedAt: cat.updatedAt,
        isDeleted: cat.isDeleted,
        projectVersion: cat.projectVersion ? {
            id: cat.projectVersion.id.toString(),
            version: cat.projectVersion.version,
            projectId: cat.projectVersion.projectId.toString(),
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
        projectVersionId?: string | number
        categoryName?: string
        weight?: number
        status?: number
    }>(event)

    const data: any = {updatedAt: new Date()}

    // 处理 projectVersionId 更新
    if (body?.projectVersionId !== undefined) {
        try {
            const newProjectVersionId = BigInt(String(body.projectVersionId))
            // 检查新项目版本是否存在
            const projectVersion = await prisma.projectVersion.findUnique({
                where: {id: newProjectVersionId, isDeleted: false},
            })
            if (!projectVersion) {
                setResponseStatus(event, 404)
                return fail('ProjectVersion not found', 404)
            }
            data.projectVersionId = newProjectVersionId
        } catch {
            setResponseStatus(event, 400)
            return fail('Invalid projectVersionId', 400)
        }
    }

    if (typeof body?.categoryName === 'string') {
        const name = body.categoryName.trim()
        if (!name) {
            setResponseStatus(event, 400)
            return fail('Invalid categoryName', 400)
        }
        data.categoryName = name
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
        const cat = await prisma.category.update({
            where: {id},
            data,
            include: {projectVersion: true},
        })
        return ok(categoryToDto(cat))
    } catch (err: any) {
        if (err?.code === 'P2025') {
            setResponseStatus(event, 404)
            return fail('Not Found', 404)
        }
        setResponseStatus(event, 500)
        return fail('Internal Server Error', 500)
    }
})
