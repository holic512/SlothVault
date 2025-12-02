import {prisma} from '~~/server/utils/prisma'
import {ok, fail} from '~~/server/utils/response'
import {verifyPassword} from '~~/server/utils/password'
import {createSession} from '~~/server/utils/session'
import {setResponseStatus, readBody} from 'h3'

export default defineEventHandler(async (event) => {
    const body = await readBody<{ username: string; password: string; remember?: boolean }>(event)
    if (!body?.username || !body?.password) {
        setResponseStatus(event, 400)
        return fail('Missing username or password', 400)
    }
    const user = await prisma.user.findFirst({
        where: {OR: [{username: body.username}, {email: body.username}]}
    })
    if (!user) {
        setResponseStatus(event, 401)
        return fail('Invalid credentials', 401)
    }
    const valid = await verifyPassword(user.password, body.password)
    if (!valid) {
        setResponseStatus(event, 401)
        return fail('Invalid credentials', 401)
    }
    const ttl = (body.remember ? 30 : 7) * 24 * 60 * 60 * 1000
    await createSession(event, user.id, ttl)
    return ok({id: user.id, username: user.username})
})
