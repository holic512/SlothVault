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

    const query = getQuery(event)
    const noteInfoId = query.noteInfoId
    const includeDeleted = toBool(query.includeDeleted)

    if (!noteInfoId) {
        setResponseStatus(event, 400)
        return fail('Missing noteInfoId', 400)
    }

    let noteInfoIdBigInt: bigint
    try {
        noteInfoIdBigInt = BigInt(String(noteInfoId))
    } catch {
        setResponseStatus(event, 400)
        return fail('Invalid noteInfoId', 400)
    }

    const where: any = {
        noteInfoId: noteInfoIdBigInt,
    }

    if (!includeDeleted) {
        where.isDeleted = false
    }

    try {
        const list = await prisma.noteContent.findMany({
            where,
            orderBy: [
                {isPrimary: 'desc'},
                {createdAt: 'desc'},
            ],
        })

        return ok({
            list: list.map(contentToDto),
        })
    } catch (err) {
        console.error('NoteContent list error:', err)
        setResponseStatus(event, 500)
        return fail('Internal Server Error', 500)
    }
})
