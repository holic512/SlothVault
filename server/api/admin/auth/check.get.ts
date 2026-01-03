import {prisma} from '~~/server/utils/prisma'
import {ok, fail} from '~~/server/utils/response'
import {setResponseStatus} from 'h3'

export default defineEventHandler(async (event) => {
    try {
        const adminCount = await prisma.user.count()
        return ok({exists: adminCount > 0})
    } catch (err) {
        setResponseStatus(event, 500)
        return fail('Internal Server Error', 500)
    }
})
