import {prisma} from '~~/server/utils/prisma'
import {ok, fail} from '~~/server/utils/response'
import {readSession} from '~~/server/utils/session'
import {readBody, setResponseStatus} from 'h3'

function toInt(value: unknown, fallback: number) {
    const n = typeof value === 'string' ? Number(value) : typeof value === 'number' ? value : NaN
    return Number.isFinite(n) ? Math.trunc(n) : fallback
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

    const body = await readBody<{
        categoryId?: string | number
        noteTitle?: string
        weight?: number
        status?: number
    }>(event)

    // 验证 categoryId
    if (body?.categoryId === undefined) {
        setResponseStatus(event, 400)
        return fail('Missing categoryId', 400)
    }

    let categoryId: bigint
    try {
        categoryId = BigInt(String(body.categoryId))
    } catch {
        setResponseStatus(event, 400)
        return fail('Invalid categoryId', 400)
    }

    // 验证 noteTitle
    const noteTitle = typeof body?.noteTitle === 'string' ? body.noteTitle.trim() : ''
    if (!noteTitle) {
        setResponseStatus(event, 400)
        return fail('Missing noteTitle', 400)
    }

    const weight = toInt(body?.weight, 0)
    const status = toInt(body?.status, 1)

    try {
        // 检查分类是否存在
        const category = await prisma.category.findUnique({
            where: {id: categoryId, isDeleted: false},
        })
        if (!category) {
            setResponseStatus(event, 404)
            return fail('Category not found', 404)
        }

        const note = await prisma.noteInfo.create({
            data: {categoryId, noteTitle, weight, status},
            include: {category: true},
        })
        setResponseStatus(event, 201)
        return ok(noteToDto(note), 'created')
    } catch (err) {
        console.error('Note create error:', err)
        setResponseStatus(event, 500)
        return fail('Internal Server Error', 500)
    }
})
