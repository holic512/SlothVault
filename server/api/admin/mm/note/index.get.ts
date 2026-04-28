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

function noteToDto(note: any) {
    return {
        id: note.id.toString(),
        categoryId: note.categoryId.toString(),
        noteTitle: note.noteTitle,
        weight: note.weight,
        status: note.status,
        createdAt: note.createdAt,
        updatedAt: note.updatedAt,
        isDeleted: note.isDeleted,
        category: note.category ? {
            id: note.category.id.toString(),
            categoryName: note.category.categoryName,
            projectVersionId: note.category.projectVersionId.toString(),
            projectVersion: note.category.projectVersion ? {
                id: note.category.projectVersion.id.toString(),
                version: note.category.projectVersion.version,
                projectId: note.category.projectVersion.projectId.toString(),
                project: note.category.projectVersion.project ? {
                    id: note.category.projectVersion.project.id.toString(),
                    projectName: note.category.projectVersion.project.projectName,
                } : null,
            } : null,
        } : null,
        contentCount: note._count?.contents ?? 0,
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

    const status = query.status !== undefined ? toInt(query.status, Number.NaN) : undefined
    const categoryId = query.categoryId !== undefined ? query.categoryId : undefined
    const projectVersionId = query.projectVersionId !== undefined ? query.projectVersionId : undefined
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
        where.noteTitle = {contains: keyword, mode: 'insensitive'}
    }

    if (Number.isFinite(status)) {
        where.status = status
    }

    // 按分类ID过滤
    if (categoryId !== undefined) {
        try {
            where.categoryId = BigInt(String(categoryId))
        } catch {
            setResponseStatus(event, 400)
            return fail('Invalid categoryId', 400)
        }
    }

    // 按项目版本ID过滤
    if (projectVersionId !== undefined) {
        try {
            where.category = {
                ...where.category,
                projectVersionId: BigInt(String(projectVersionId)),
            }
        } catch {
            setResponseStatus(event, 400)
            return fail('Invalid projectVersionId', 400)
        }
    }

    // 按项目ID过滤
    if (projectId !== undefined) {
        try {
            where.category = {
                ...where.category,
                projectVersion: {
                    projectId: BigInt(String(projectId)),
                },
            }
        } catch {
            setResponseStatus(event, 400)
            return fail('Invalid projectId', 400)
        }
    }

    const allowedOrderBy = new Set(['id', 'noteTitle', 'weight', 'status', 'createdAt', 'updatedAt'])
    const safeOrderBy = allowedOrderBy.has(orderByField) ? orderByField : 'weight'

    const skip = (page - 1) * pageSize

    try {
        const [total, list] = await Promise.all([
            prisma.noteInfo.count({where}),
            prisma.noteInfo.findMany({
                where,
                skip,
                take: pageSize,
                orderBy: {[safeOrderBy]: order},
                include: {
                    category: {
                        include: {
                            projectVersion: {
                                include: {
                                    project: true,
                                },
                            },
                        },
                    },
                    _count: {
                        select: {contents: true},
                    },
                },
            }),
        ])

        return ok({
            list: list.map(noteToDto),
            page,
            pageSize,
            total,
        })
    } catch (err) {
        console.error('Note list error:', err)
        setResponseStatus(event, 500)
        return fail('Internal Server Error', 500)
    }
})
