import {prisma} from '~~/server/utils/prisma'
import {ok, fail} from '~~/server/utils/response'
import {readSession} from '~~/server/utils/session'
import {getRouterParam, readBody, setResponseStatus} from 'h3'

function toInt(value: unknown) {
    const n = typeof value === 'string' ? Number(value) : typeof value === 'number' ? value : NaN
    return Number.isFinite(n) ? Math.trunc(n) : null
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
        categoryId?: string | number
        noteTitle?: string
        weight?: number
        status?: number
        isDeleted?: boolean
    }>(event)

    const data: any = {updatedAt: new Date()}

    // 处理 categoryId 更新
    if (body?.categoryId !== undefined) {
        try {
            const newCategoryId = BigInt(String(body.categoryId))
            // 检查新分类是否存在
            const category = await prisma.category.findUnique({
                where: {id: newCategoryId, isDeleted: false},
            })
            if (!category) {
                setResponseStatus(event, 404)
                return fail('Category not found', 404)
            }
            data.categoryId = newCategoryId
        } catch {
            setResponseStatus(event, 400)
            return fail('Invalid categoryId', 400)
        }
    }

    if (typeof body?.noteTitle === 'string') {
        const title = body.noteTitle.trim()
        if (!title) {
            setResponseStatus(event, 400)
            return fail('Invalid noteTitle', 400)
        }
        data.noteTitle = title
    }

    const weight = toInt(body?.weight)
    if (weight !== null) data.weight = weight

    const status = toInt(body?.status)
    if (status !== null) data.status = status

    if (typeof body?.isDeleted === 'boolean') {
        data.isDeleted = body.isDeleted
    }

    if (Object.keys(data).length === 1) {
        setResponseStatus(event, 400)
        return fail('No fields to update', 400)
    }

    try {
        const note = await prisma.noteInfo.update({
            where: {id},
            data,
            include: {category: true},
        })
        return ok(noteToDto(note))
    } catch (err: any) {
        if (err?.code === 'P2025') {
            setResponseStatus(event, 404)
            return fail('Not Found', 404)
        }
        console.error('Note update error:', err)
        setResponseStatus(event, 500)
        return fail('Internal Server Error', 500)
    }
})
