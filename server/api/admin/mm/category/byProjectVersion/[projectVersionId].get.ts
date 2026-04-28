import {prisma} from '~~/server/utils/prisma'
import {ok, fail} from '~~/server/utils/response'
import {readSession} from '~~/server/utils/session'
import {getRouterParam, getQuery, setResponseStatus} from 'h3'

function toInt(value: unknown, fallback: number) {
    const n = typeof value === 'string' ? Number(value) : typeof value === 'number' ? value : NaN
    return Number.isFinite(n) ? Math.trunc(n) : fallback
}

function toBool(value: unknown) {
    if (typeof value === 'boolean') return value
    if (typeof value !== 'string') return false
    return value === '1' || value.toLowerCase() === 'true'
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
    }
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
    }
}

export default defineEventHandler(async (event) => {
    const session = await readSession(event)
    if (!session) {
        setResponseStatus(event, 401)
        return fail('Unauthorized', 401)
    }

    const projectVersionIdRaw = getRouterParam(event, 'projectVersionId')
    if (!projectVersionIdRaw) {
        setResponseStatus(event, 400)
        return fail('Missing projectVersionId', 400)
    }

    let projectVersionId: bigint
    try {
        projectVersionId = BigInt(projectVersionIdRaw)
    } catch {
        setResponseStatus(event, 400)
        return fail('Invalid projectVersionId', 400)
    }

    const query = getQuery(event)
    const page = Math.max(1, toInt(query.page, 1))
    const pageSize = Math.min(100, Math.max(1, toInt(query.pageSize, 10)))
    const includeDeleted = toBool(query.includeDeleted)
    const onlyDeleted = toBool(query.onlyDeleted)
    const includeProjectVersionInfo = toBool(query.includeProjectVersionInfo)

    const orderByField = typeof query.orderBy === 'string' ? query.orderBy : 'weight'
    const order = typeof query.order === 'string' && query.order.toLowerCase() === 'asc' ? 'asc' : 'desc'

    const where: any = {projectVersionId}

    if (onlyDeleted) {
        where.isDeleted = true
    } else if (!includeDeleted) {
        where.isDeleted = false
    }

    const allowedOrderBy = new Set(['id', 'categoryName', 'weight', 'status', 'createdAt', 'updatedAt'])
    const safeOrderBy = allowedOrderBy.has(orderByField) ? orderByField : 'weight'

    const skip = (page - 1) * pageSize

    try {
        // 检查项目版本是否存在
        const projectVersion = await prisma.projectVersion.findUnique({
            where: {id: projectVersionId},
        })
        if (!projectVersion) {
            setResponseStatus(event, 404)
            return fail('ProjectVersion not found', 404)
        }

        const [total, list] = await Promise.all([
            prisma.category.count({where}),
            prisma.category.findMany({
                where,
                skip,
                take: pageSize,
                orderBy: {[safeOrderBy]: order},
            }),
        ])

        const result: any = {
            list: list.map(categoryToDto),
            page,
            pageSize,
            total,
        }

        if (includeProjectVersionInfo) {
            result.projectVersion = projectVersionToDto(projectVersion)
        }

        return ok(result)
    } catch (err) {
        setResponseStatus(event, 500)
        return fail('Internal Server Error', 500)
    }
})
