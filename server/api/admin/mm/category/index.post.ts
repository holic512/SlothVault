import {prisma} from '~~/server/utils/prisma'
import {ok, fail} from '~~/server/utils/response'
import {readSession} from '~~/server/utils/session'
import {readBody, setResponseStatus} from 'h3'

function toInt(value: unknown, fallback: number) {
    const n = typeof value === 'string' ? Number(value) : typeof value === 'number' ? value : NaN
    return Number.isFinite(n) ? Math.trunc(n) : fallback
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

    const body = await readBody<{
        projectVersionId?: string | number
        categoryName?: string
        weight?: number
        status?: number
    }>(event)

    // 验证 projectVersionId
    if (body?.projectVersionId === undefined) {
        setResponseStatus(event, 400)
        return fail('Missing projectVersionId', 400)
    }

    let projectVersionId: bigint
    try {
        projectVersionId = BigInt(String(body.projectVersionId))
    } catch {
        setResponseStatus(event, 400)
        return fail('Invalid projectVersionId', 400)
    }

    // 验证 categoryName
    const categoryName = typeof body?.categoryName === 'string' ? body.categoryName.trim() : ''
    if (!categoryName) {
        setResponseStatus(event, 400)
        return fail('Missing categoryName', 400)
    }

    const weight = toInt(body?.weight, 0)
    const status = toInt(body?.status, 1)

    try {
        // 检查项目版本是否存在
        const projectVersion = await prisma.projectVersion.findUnique({
            where: {id: projectVersionId, isDeleted: false},
        })
        if (!projectVersion) {
            setResponseStatus(event, 404)
            return fail('ProjectVersion not found', 404)
        }

        const cat = await prisma.category.create({
            data: {projectVersionId, categoryName, weight, status},
            include: {projectVersion: true},
        })
        setResponseStatus(event, 201)
        return ok(categoryToDto(cat), 'created')
    } catch (err) {
        setResponseStatus(event, 500)
        return fail('Internal Server Error', 500)
    }
})
