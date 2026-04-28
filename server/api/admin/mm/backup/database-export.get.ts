import { prisma } from '~~/server/utils/prisma'
import { ok, fail } from '~~/server/utils/response'
import { readSession } from '~~/server/utils/session'
import { setResponseStatus } from 'h3'

export default defineEventHandler(async (event) => {
  const session = await readSession(event)
  if (!session) {
    setResponseStatus(event, 401)
    return fail('Unauthorized', 401)
  }

  try {
    // 导出所有需要备份的数据（排除 auth schema）
    const [
      projects,
      projectVersions,
      categories,
      projectMenus,
      projectHomes,
      noteInfos,
      noteContents,
      fileManagements,
      systemConfigs,
      systemHomepages,
      merkleTrees,
      compressedNfts,
    ] = await Promise.all([
      prisma.project.findMany({
        where: { isDeleted: false },
      }),
      prisma.projectVersion.findMany({
        where: { isDeleted: false },
      }),
      prisma.category.findMany({
        where: { isDeleted: false },
      }),
      prisma.projectMenu.findMany({
        where: { isDeleted: false },
      }),
      prisma.projectHome.findMany({
        where: { isDeleted: false },
      }),
      prisma.noteInfo.findMany({
        where: { isDeleted: false },
      }),
      prisma.noteContent.findMany({
        where: { isDeleted: false },
      }),
      prisma.fileManagement.findMany({
        where: { status: 1 },
      }),
      prisma.systemConfig.findMany(),
      prisma.systemHomepage.findMany({
        where: { isDeleted: false },
      }),
      prisma.merkleTree.findMany({
        where: { isDeleted: false },
      }),
      prisma.compressedNft.findMany(),
    ])

    const backup = {
      version: '1.0.0',
      exportedAt: new Date().toISOString(),
      data: {
        projects: projects.map(p => ({
          ...p,
          id: p.id.toString(),
        })),
        projectVersions: projectVersions.map(pv => ({
          ...pv,
          id: pv.id.toString(),
          projectId: pv.projectId.toString(),
        })),
        categories: categories.map(c => ({
          ...c,
          id: c.id.toString(),
          projectVersionId: c.projectVersionId.toString(),
        })),
        projectMenus: projectMenus.map(pm => ({
          ...pm,
          id: pm.id.toString(),
          projectId: pm.projectId.toString(),
          parentId: pm.parentId?.toString() || null,
        })),
        projectHomes: projectHomes.map(ph => ({
          ...ph,
          id: ph.id.toString(),
          projectId: ph.projectId.toString(),
        })),
        noteInfos: noteInfos.map(ni => ({
          ...ni,
          id: ni.id.toString(),
          categoryId: ni.categoryId.toString(),
        })),
        noteContents: noteContents.map(nc => ({
          ...nc,
          id: nc.id.toString(),
          noteInfoId: nc.noteInfoId.toString(),
        })),
        fileManagements: fileManagements.map(fm => ({
          ...fm,
          id: fm.id.toString(),
          fileSize: fm.fileSize.toString(),
        })),
        systemConfigs: systemConfigs.map(sc => ({
          ...sc,
          id: sc.id.toString(),
        })),
        systemHomepages: systemHomepages.map(sh => ({
          ...sh,
          id: sh.id.toString(),
        })),
        merkleTrees: merkleTrees.map(mt => ({
          ...mt,
          id: mt.id.toString(),
          maxCapacity: mt.maxCapacity.toString(),
          creationCost: mt.creationCost.toString(),
        })),
        compressedNfts: compressedNfts.map(cn => ({
          ...cn,
          id: cn.id.toString(),
          merkleTreeId: cn.merkleTreeId.toString(),
          projectId: cn.projectId.toString(),
          originalImageId: cn.originalImageId?.toString() || null,
        })),
      },
    }

    return ok(backup)
  } catch (err) {
    console.error('Database export error:', err)
    setResponseStatus(event, 500)
    return fail('Database export failed', 500)
  }
})
