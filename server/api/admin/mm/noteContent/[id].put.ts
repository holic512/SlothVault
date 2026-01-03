import {prisma} from '~~/server/utils/prisma'
import {ok, fail} from '~~/server/utils/response'
import {readSession} from '~~/server/utils/session'
import {getRouterParam, readBody, setResponseStatus} from 'h3'

function toInt(value: unknown) {
    const n = typeof value === 'string' ? Number(value) : typeof value === 'number' ? value : NaN
    return Number.isFinite(n) ? Math.trunc(n) : null
}

function contentToDto(item: any) {
    return {
        id: item.id.toString(),
        noteInfoId: item.noteInfoId.toString(),
        content: item.content,
        versionNote: item.versionNote,
        isPrimary: item.isPrimary,
        status: item.status,
        createdAt: item.createdAt,
        updatedAt: item.updatedAt,
        isDeleted: item.isDeleted,
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
        content?: string
        versionNote?: string
        isPrimary?: boolean
        status?: number
        isDeleted?: boolean
    }>(event)

    const data: any = {updatedAt: new Date()}

    if (typeof body?.content === 'string') {
        data.content = body.content
    }

    if (body?.versionNote !== undefined) {
        data.versionNote = typeof body.versionNote === 'string' ? body.versionNote.trim() || null : null
    }

    const status = toInt(body?.status)
    if (status !== null) data.status = status

    if (typeof body?.isDeleted === 'boolean') {
        data.isDeleted = body.isDeleted
    }

    // 处理设为主版本
    if (body?.isPrimary === true) {
        // 先获取当前记录的 noteInfoId
        const current = await prisma.noteContent.findUnique({
            where: {id},
            select: {noteInfoId: true},
        })
        if (!current) {
            setResponseStatus(event, 404)
            return fail('Not Found', 404)
        }

        // 取消其他主版本
        await prisma.noteContent.updateMany({
            where: {noteInfoId: current.noteInfoId, isPrimary: true, id: {not: id}},
            data: {isPrimary: false, updatedAt: new Date()},
        })
        data.isPrimary = true
    }

    if (Object.keys(data).length === 1) {
        setResponseStatus(event, 400)
        return fail('No fields to update', 400)
    }

    try {
        const item = await prisma.noteContent.update({
            where: {id},
            data,
        })
        return ok(contentToDto(item))
    } catch (err: any) {
        if (err?.code === 'P2025') {
            setResponseStatus(event, 404)
            return fail('Not Found', 404)
        }
        console.error('NoteContent update error:', err)
        setResponseStatus(event, 500)
        return fail('Internal Server Error', 500)
    }
})
