import {prisma} from '~~/server/utils/prisma'
import {ok, fail} from '~~/server/utils/response'
import {readSession} from '~~/server/utils/session'
import {readBody, setResponseStatus} from 'h3'

function toInt(value: unknown, fallback: number) {
    const n = typeof value === 'string' ? Number(value) : typeof value === 'number' ? value : NaN
    return Number.isFinite(n) ? Math.trunc(n) : fallback
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

    const body = await readBody<{
        noteInfoId?: string | number
        content?: string
        versionNote?: string
        isPrimary?: boolean
        status?: number
    }>(event)

    // 验证 noteInfoId
    if (body?.noteInfoId === undefined) {
        setResponseStatus(event, 400)
        return fail('Missing noteInfoId', 400)
    }

    let noteInfoId: bigint
    try {
        noteInfoId = BigInt(String(body.noteInfoId))
    } catch {
        setResponseStatus(event, 400)
        return fail('Invalid noteInfoId', 400)
    }

    const content = typeof body?.content === 'string' ? body.content : ''
    const versionNote = typeof body?.versionNote === 'string' ? body.versionNote.trim() : null
    const isPrimary = body?.isPrimary === true
    const status = toInt(body?.status, 1)

    try {
        // 检查笔记信息是否存在
        const noteInfo = await prisma.noteInfo.findUnique({
            where: {id: noteInfoId, isDeleted: false},
        })
        if (!noteInfo) {
            setResponseStatus(event, 404)
            return fail('NoteInfo not found', 404)
        }

        // 如果设为主版本，先取消其他主版本
        if (isPrimary) {
            await prisma.noteContent.updateMany({
                where: {noteInfoId, isPrimary: true},
                data: {isPrimary: false, updatedAt: new Date()},
            })
        }

        // 检查是否是第一个版本，如果是则自动设为主版本
        const existingCount = await prisma.noteContent.count({
            where: {noteInfoId, isDeleted: false},
        })
        const shouldBePrimary = isPrimary || existingCount === 0

        const item = await prisma.noteContent.create({
            data: {
                noteInfoId,
                content,
                versionNote,
                isPrimary: shouldBePrimary,
                status,
            },
        })

        setResponseStatus(event, 201)
        return ok(contentToDto(item), 'created')
    } catch (err) {
        console.error('NoteContent create error:', err)
        setResponseStatus(event, 500)
        return fail('Internal Server Error', 500)
    }
})
