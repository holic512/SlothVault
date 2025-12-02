import {prisma} from '~~/server/utils/prisma'
import {ok, fail} from '~~/server/utils/response'
import {hashPassword} from '~~/server/utils/password'
import {setResponseStatus, readBody} from 'h3'

export default defineEventHandler(async (event) => {
    const body = await readBody<{ username: string; password: string }>(event)
    if (!body?.username || !body?.password) {
        setResponseStatus(event, 400)
        return fail('Missing username or password', 400)
    }

    // 有且仅当 数据库用户 为 0 的时候允许 初始化功能
    const count = await prisma.user.count()
    if (count > 0) {
        setResponseStatus(event, 409)
        return fail('Admin already initialized', 409)
    }

    const passwordHash = await hashPassword(body.password)
    const user = await prisma.user.create({
        data: {username: body.username, password: passwordHash}
    })
    setResponseStatus(event, 201)
    return ok({id: user.id, username: user.username}, 'created')
})
