import {prisma} from '~~/server/utils/prisma'
import {ok, fail} from '~~/server/utils/response'
import {readSession} from '~~/server/utils/session'
import {getRouterParam, setResponseStatus} from 'h3'

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
        const pv = await prisma.projectVersion.update({
            where: {id},
            data: {isDeleted: true, status: 0, updatedAt: new Date()},
        })
        return ok(projectVersionToDto(pv))
    } catch (err: any) {
        if (err?.code === 'P2025') {
            setResponseStatus(event, 404)
            return fail('Not Found', 404)
        }
        setResponseStatus(event, 500)
        return fail('Internal Server Error', 500)
    }
})
