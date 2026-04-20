import {prisma} from '~~/server/utils/prisma'
import { parseSolToLamports, lamportsToSolDisplay } from '~~/server/utils/projectPurchase'
import {ok, fail} from '~~/server/utils/response'
import {readSession} from '~~/server/utils/session'
import { defineEventHandler, getRouterParam, readBody, setResponseStatus } from 'h3'

function toInt(value: unknown) {
    const n = typeof value === 'string' ? Number(value) : typeof value === 'number' ? value : NaN
    return Number.isFinite(n) ? Math.trunc(n) : null
}

function projectToDto(project: any) {
    return {
        id: project.id.toString(),
        projectName: project.projectName,
        avatar: project.avatar,
        weight: project.weight,
        status: project.status,
        requireAuth: project.requireAuth,
        accessPriceLamports: project.accessPriceLamports?.toString() ?? null,
        accessPriceSol: lamportsToSolDisplay(project.accessPriceLamports),
        purchaseEnabled: project.requireAuth && Boolean(project.accessPriceLamports && project.accessPriceLamports > 0),
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
        projectName?: string
        avatar?: string | null
        weight?: number
        status?: number
        requireAuth?: boolean
        accessPriceSol?: string | number | null
    }>(event)

    const data: any = {updatedAt: new Date()}

    if (typeof body?.projectName === 'string') {
        const name = body.projectName.trim()
        if (!name) {
            setResponseStatus(event, 400)
            return fail('Invalid projectName', 400)
        }
        data.projectName = name
    }

    // 支持头像更新（可以设置为 null 清除头像）
    if (body?.avatar !== undefined) {
        data.avatar = body.avatar
    }

    const weight = toInt(body?.weight)
    if (weight !== null) data.weight = weight

    const status = toInt(body?.status)
    if (status !== null) data.status = status

    if (typeof body?.requireAuth === 'boolean') {
        data.requireAuth = body.requireAuth
    }

    if (body?.accessPriceSol !== undefined) {
        const accessPriceLamports = data.requireAuth === false
            ? null
            : parseSolToLamports(body.accessPriceSol)

        if (body.accessPriceSol !== null && body.accessPriceSol !== '' && accessPriceLamports === null && data.requireAuth !== false) {
            setResponseStatus(event, 400)
            return fail('Invalid accessPriceSol', 400)
        }

        data.accessPriceLamports = accessPriceLamports
    } else if (data.requireAuth === false) {
        data.accessPriceLamports = null
    }

    if (Object.keys(data).length === 1) {
        setResponseStatus(event, 400)
        return fail('No fields to update', 400)
    }

    try {
        const project = await prisma.project.update({
            where: {id},
            data,
        })
        return ok(projectToDto(project))
    } catch (err: any) {
        if (err?.code === 'P2025') {
            setResponseStatus(event, 404)
            return fail('Not Found', 404)
        }
        setResponseStatus(event, 500)
        return fail('Internal Server Error', 500)
    }
})
