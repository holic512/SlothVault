import { prisma } from '~~/server/utils/prisma'
import { ok, fail } from '~~/server/utils/response'
import { defineEventHandler, getRouterParam, setResponseStatus } from 'h3'
import { verifyProjectAccess } from '~~/server/utils/cnftAuth'
import { getWalletAddress } from '~~/server/utils/projectAuthMiddleware'
import { getActiveNetwork } from '~~/server/utils/solana'

export default defineEventHandler(async (event) => {
  const idRaw = getRouterParam(event, 'id')

  if (!idRaw) {
    setResponseStatus(event, 400)
    return fail('Missing project id', 400)
  }

  let projectId: bigint
  try {
    projectId = BigInt(idRaw)
  } catch {
    setResponseStatus(event, 400)
    return fail('Invalid project id', 400)
  }

  try {
    const project = await prisma.project.findFirst({
      where: {
        id: projectId,
        isDeleted: false,
        status: 1,
      },
    })

    if (!project) {
      setResponseStatus(event, 404)
      return fail('Project not found', 404)
    }

    // 鉴权检查
    if (project.requireAuth) {
      const walletAddress = getWalletAddress(event)
      const network = await getActiveNetwork()
      const authResult = await verifyProjectAccess(projectId, walletAddress, {
        network,
      })

      if (!authResult.hasAccess) {
        setResponseStatus(event, 403)
        return fail(authResult.reason, 403)
      }
    }

    const home = await prisma.projectHome.findUnique({
      where: { projectId },
    })

    if (!home || home.isDeleted || home.status !== 1) {
      setResponseStatus(event, 404)
      return fail('Home content not found', 404)
    }

    return ok({
      id: home.id.toString(),
      projectId: home.projectId.toString(),
      content: home.content,
      updatedAt: home.updatedAt,
    })
  } catch (err) {
    setResponseStatus(event, 500)
    return fail('Internal Server Error', 500)
  }
})
