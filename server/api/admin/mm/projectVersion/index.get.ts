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

    const query = getQuery(event)
    const page = Math.max(1, toInt(query.page, 1))
    const pageSize = Math.min(100, Math.max(1, toInt(query.pageSize, 10)))

    const keyword = typeof query.keyword === 'string' ? query.keyword.trim() : ''
    const includeDeleted = toBool(query.includeDeleted)
    const onlyDeleted = toBool(query.onlyDeleted)
    const includeProject = toBool(query.includeProject)

    const status = query.status !== undefined ? toInt(query.status, Number.NaN) : undefined
    const projectId = query.projectId !== undefined ? query.projectId : undefined

    const orderByField = typeof query.orderBy === 'string' ? query.orderBy : 'weight'
    const order = typeof query.order === 'string' && query.order.toLowerCase() === 'asc' ? 'asc' : 'desc'

    const where: any = {}

    if (onlyDeleted) {
        where.isDeleted = true
    } else if (!includeDeleted) {
        where.isDeleted = false
    }

    if (keyword) {
        where.OR = [
            {version: {contains: keyword, mode: 'insensitive'}},
            {description: {contains: keyword, mode: 'insensitive'}},
        ]
    }

    if (Number.isFinite(status)) {
        where.status = status
    }

    if (projectId !== undefined) {
        try {
            where.projectId = BigInt(String(projectId))
        } catch {
            setResponseStatus(event, 400)
            return fail('Invalid projectId', 400)
        }
    }

    const allowedOrderBy = new Set(['id', 'version', 'weight', 'status', 'createdAt', 'updatedAt'])
    const safeOrderBy = allowedOrderBy.has(orderByField) ? orderByField : 'weight'

    const skip = (page - 1) * pageSize

    try {
        const [total, list] = await Promise.all([
            prisma.projectVersion.count({where}),
            prisma.projectVersion.findMany({
                where,
                skip,
                take: pageSize,
                orderBy: {[safeOrderBy]: order},
                include: includeProject ? {project: true} : undefined,
            }),
        ])

        return ok({
            list: list.map(projectVersionToDto),
            page,
            pageSize,
            total,
        })
    } catch (err) {
        setResponseStatus(event, 500)
        return fail('Internal Server Error', 500)
    }
})
