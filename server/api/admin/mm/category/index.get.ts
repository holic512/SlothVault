import {prisma} from '~~/server/utils/prisma'
import {ok, fail} from '~~/server/utils/response'
import {readSession} from '~~/server/utils/session'
import {getQuery, setResponseStatus} from 'h3'

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

    const query = getQuery(event)
    const page = Math.max(1, toInt(query.page, 1))
    const pageSize = Math.min(100, Math.max(1, toInt(query.pageSize, 10)))

    const keyword = typeof query.keyword === 'string' ? query.keyword.trim() : ''
    const includeDeleted = toBool(query.includeDeleted)
    const onlyDeleted = toBool(query.onlyDeleted)
    const includeProjectVersion = toBool(query.includeProjectVersion)

    const status = query.status !== undefined ? toInt(query.status, Number.NaN) : undefined
    const projectVersionId = query.projectVersionId !== undefined ? query.projectVersionId : undefined

    const orderByField = typeof query.orderBy === 'string' ? query.orderBy : 'weight'
    const order = typeof query.order === 'string' && query.order.toLowerCase() === 'asc' ? 'asc' : 'desc'

    const where: any = {}

    if (onlyDeleted) {
        where.isDeleted = true
    } else if (!includeDeleted) {
        where.isDeleted = false
    }

    if (keyword) {
        where.categoryName = {contains: keyword, mode: 'insensitive'}
    }

    if (Number.isFinite(status)) {
        where.status = status
    }

    if (projectVersionId !== undefined) {
        try {
            where.projectVersionId = BigInt(String(projectVersionId))
        } catch {
            setResponseStatus(event, 400)
            return fail('Invalid projectVersionId', 400)
        }
    }

    const allowedOrderBy = new Set(['id', 'categoryName', 'weight', 'status', 'createdAt', 'updatedAt'])
    const safeOrderBy = allowedOrderBy.has(orderByField) ? orderByField : 'weight'

    const skip = (page - 1) * pageSize

    try {
        const [total, list] = await Promise.all([
            prisma.category.count({where}),
            prisma.category.findMany({
                where,
                skip,
                take: pageSize,
                orderBy: {[safeOrderBy]: order},
                include: includeProjectVersion ? {projectVersion: true} : undefined,
            }),
        ])

        return ok({
            list: list.map(categoryToDto),
            page,
            pageSize,
            total,
        })
    } catch (err) {
        setResponseStatus(event, 500)
        return fail('Internal Server Error', 500)
    }
})
