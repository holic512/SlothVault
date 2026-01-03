import {prisma} from '~~/server/utils/prisma'
import {ok, fail} from '~~/server/utils/response'
import {readSession} from '~~/server/utils/session'
import {getRouterParam, setResponseStatus} from 'h3'

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

    try {
        // 获取当前记录
        const current = await prisma.noteContent.findUnique({
            where: {id},
            select: {noteInfoId: true, isPrimary: true},
        })
        if (!current) {
            setResponseStatus(event, 404)
            return fail('Not Found', 404)
        }

        // 软删除
        await prisma.noteContent.update({
            where: {id},
            data: {isDeleted: true, isPrimary: false, updatedAt: new Date()},
        })

        // 如果删除的是主版本，自动将最新的一个设为主版本
        if (current.isPrimary) {
            const latest = await prisma.noteContent.findFirst({
                where: {noteInfoId: current.noteInfoId, isDeleted: false},
                orderBy: {createdAt: 'desc'},
            })
            if (latest) {
                await prisma.noteContent.update({
                    where: {id: latest.id},
                    data: {isPrimary: true, updatedAt: new Date()},
                })
            }
        }

        return ok(null, 'deleted')
    } catch (err: any) {
        if (err?.code === 'P2025') {
            setResponseStatus(event, 404)
            return fail('Not Found', 404)
        }
        console.error('NoteContent delete error:', err)
        setResponseStatus(event, 500)
        return fail('Internal Server Error', 500)
    }
})
