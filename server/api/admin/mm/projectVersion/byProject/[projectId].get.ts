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

function projectToDto(project: any) {
    return {
        id: project.id.toString(),
        projectName: project.projectName,
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

    const projectIdRaw = getRouterParam(event, 'projectId')
    if (!projectIdRaw) {
        setResponseStatus(event, 400)
        return fail('Missing projectId', 400)
    }

    let projectId: bigint
    try {
        projectId = BigInt(projectIdRaw)
    } catch {
        setResponseStatus(event, 400)
        return fail('Invalid projectId', 400)
    }

    const query = getQuery(event)
    const page = Math.max(1, toInt(query.page, 1))
    const pageSize = Math.min(100, Math.max(1, toInt(query.pageSize, 10)))
    const includeDeleted = toBool(query.includeDeleted)
    const onlyDeleted = toBool(query.onlyDeleted)
    const includeProjectInfo = toBool(query.includeProjectInfo)

    const orderByField = typeof query.orderBy === 'string' ? query.orderBy : 'weight'
    const order = typeof query.order === 'string' && query.order.toLowerCase() === 'asc' ? 'asc' : 'desc'

    const where: any = {projectId}

    if (onlyDeleted) {
        where.isDeleted = true
    } else if (!includeDeleted) {
        where.isDeleted = false
    }

    const allowedOrderBy = new Set(['id', 'version', 'weight', 'status', 'createdAt', 'updatedAt'])
    const safeOrderBy = allowedOrderBy.has(orderByField) ? orderByField : 'weight'

    const skip = (page - 1) * pageSize

    try {
        // 检查项目是否存在
        const project = await prisma.project.findUnique({
            where: {id: projectId},
        })
        if (!project) {
            setResponseStatus(event, 404)
            return fail('Project not found', 404)
        }

        const [total, list] = await Promise.all([
            prisma.projectVersion.count({where}),
            prisma.projectVersion.findMany({
                where,
                skip,
                take: pageSize,
                orderBy: {[safeOrderBy]: order},
            }),
        ])

        const result: any = {
            list: list.map(projectVersionToDto),
            page,
            pageSize,
            total,
        }

        if (includeProjectInfo) {
            result.project = projectToDto(project)
        }

        return ok(result)
    } catch (err) {
        setResponseStatus(event, 500)
        return fail('Internal Server Error', 500)
    }
})
