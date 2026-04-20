import { prisma } from '~~/server/utils/prisma'
import { ok, fail } from '~~/server/utils/response'
import { defineEventHandler, setResponseStatus } from 'h3'
import { isPurchaseEnabled, lamportsToSolDisplay } from '~~/server/utils/projectPurchase'

interface ProjectDto {
  id: string
  projectName: string
  avatar: string | null
  latestVersion: string | null
  latestVersionDesc: string | null
  categoryCount: number
  requireAuth: boolean
  accessPriceLamports: string | null
  accessPriceSol: string | null
  purchaseEnabled: boolean
  updatedAt: Date
}

function projectToDto(project: any): ProjectDto {
  const latestVersion = project.versions?.[0]
  return {
    id: project.id.toString(),
    projectName: project.projectName,
    avatar: project.avatar,
    latestVersion: latestVersion?.version || null,
    latestVersionDesc: latestVersion?.description || null,
    categoryCount: latestVersion?._count?.categories ?? 0,
    requireAuth: project.requireAuth,
    accessPriceLamports: project.accessPriceLamports?.toString() ?? null,
    accessPriceSol: lamportsToSolDisplay(project.accessPriceLamports),
    purchaseEnabled: project.requireAuth && isPurchaseEnabled(project.accessPriceLamports),
    updatedAt: project.updatedAt,
  }
}

export default defineEventHandler(async (event) => {
  try {
    const list = await prisma.project.findMany({
      where: {
        isDeleted: false,
        status: 1,
      },
      orderBy: { weight: 'desc' },
      include: {
        versions: {
          where: { isDeleted: false, status: 1 },
          orderBy: { weight: 'desc' },
          take: 1,
          include: {
            _count: {
              select: { categories: { where: { isDeleted: false } } },
            },
          },
        },
      },
    })

    return ok(list.map(projectToDto))
  } catch (err) {
    setResponseStatus(event, 500)
    return fail('Internal Server Error', 500)
  }
})
