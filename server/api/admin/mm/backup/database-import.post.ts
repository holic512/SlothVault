import { prisma } from '~~/server/utils/prisma'
import { ok, fail } from '~~/server/utils/response'
import { readSession } from '~~/server/utils/session'
import { readBody, setResponseStatus } from 'h3'

export default defineEventHandler(async (event) => {
  const session = await readSession(event)
  if (!session) {
    setResponseStatus(event, 401)
    return fail('Unauthorized', 401)
  }

  try {
    const body = await readBody(event)
    const { data, mode = 'insert' } = body // mode: 'insert' | 'overwrite'

    if (!data || typeof data !== 'object') {
      setResponseStatus(event, 400)
      return fail('Invalid backup data', 400)
    }

    // 如果是覆盖模式，先清空现有数据（保留 auth schema）
    if (mode === 'overwrite') {
      await prisma.$transaction([
        // 按依赖顺序删除（从子表到父表）
        prisma.compressedNft.deleteMany({}),
        prisma.merkleTree.deleteMany({}),
        prisma.noteContent.deleteMany({}),
        prisma.noteInfo.deleteMany({}),
        prisma.category.deleteMany({}),
        prisma.projectVersion.deleteMany({}),
        prisma.projectMenu.deleteMany({}),
        prisma.projectHome.deleteMany({}),
        prisma.project.deleteMany({}),
        prisma.fileManagement.deleteMany({}),
        prisma.systemConfig.deleteMany({}),
        prisma.systemHomepage.deleteMany({}),
      ])
    }

    // ID 映射表（旧 ID -> 新 ID）
    const idMaps: Record<string, Record<string, bigint>> = {
      projects: {},
      projectVersions: {},
      categories: {},
      projectMenus: {},
      projectHomes: {},
      noteInfos: {},
      noteContents: {},
      fileManagements: {},
      systemConfigs: {},
      systemHomepages: {},
      merkleTrees: {},
      compressedNfts: {},
    }

    // 1. 导入 Projects
    if (data.projects?.length) {
      for (const item of data.projects) {
        const { id, ...rest } = item
        const created = await prisma.project.create({
          data: {
            ...rest,
            createdAt: new Date(rest.createdAt),
            updatedAt: new Date(rest.updatedAt),
          },
        })
        idMaps.projects[id] = created.id
      }
    }

    // 2. 导入 ProjectVersions
    if (data.projectVersions?.length) {
      for (const item of data.projectVersions) {
        const { id, projectId, ...rest } = item
        const newProjectId = idMaps.projects[projectId]
        if (!newProjectId) continue

        const created = await prisma.projectVersion.create({
          data: {
            ...rest,
            projectId: newProjectId,
            createdAt: new Date(rest.createdAt),
            updatedAt: new Date(rest.updatedAt),
          },
        })
        idMaps.projectVersions[id] = created.id
      }
    }

    // 3. 导入 Categories
    if (data.categories?.length) {
      for (const item of data.categories) {
        const { id, projectVersionId, ...rest } = item
        const newVersionId = idMaps.projectVersions[projectVersionId]
        if (!newVersionId) continue

        const created = await prisma.category.create({
          data: {
            ...rest,
            projectVersionId: newVersionId,
            createdAt: new Date(rest.createdAt),
            updatedAt: new Date(rest.updatedAt),
          },
        })
        idMaps.categories[id] = created.id
      }
    }

    // 4. 导入 ProjectMenus（需要两次遍历处理父子关系）
    if (data.projectMenus?.length) {
      // 第一次：导入所有一级菜单（parentId 为 null）
      for (const item of data.projectMenus) {
        if (item.parentId) continue
        const { id, projectId, parentId, ...rest } = item
        const newProjectId = idMaps.projects[projectId]
        if (!newProjectId) continue

        const created = await prisma.projectMenu.create({
          data: {
            ...rest,
            projectId: newProjectId,
            parentId: null,
            createdAt: new Date(rest.createdAt),
            updatedAt: new Date(rest.updatedAt),
          },
        })
        idMaps.projectMenus[id] = created.id
      }

      // 第二次：导入所有二级菜单
      for (const item of data.projectMenus) {
        if (!item.parentId) continue
        const { id, projectId, parentId, ...rest } = item
        const newProjectId = idMaps.projects[projectId]
        const newParentId = idMaps.projectMenus[parentId]
        if (!newProjectId || !newParentId) continue

        const created = await prisma.projectMenu.create({
          data: {
            ...rest,
            projectId: newProjectId,
            parentId: newParentId,
            createdAt: new Date(rest.createdAt),
            updatedAt: new Date(rest.updatedAt),
          },
        })
        idMaps.projectMenus[id] = created.id
      }
    }

    // 5. 导入 ProjectHomes
    if (data.projectHomes?.length) {
      for (const item of data.projectHomes) {
        const { id, projectId, ...rest } = item
        const newProjectId = idMaps.projects[projectId]
        if (!newProjectId) continue

        const created = await prisma.projectHome.create({
          data: {
            ...rest,
            projectId: newProjectId,
            createdAt: new Date(rest.createdAt),
            updatedAt: new Date(rest.updatedAt),
          },
        })
        idMaps.projectHomes[id] = created.id
      }
    }

    // 6. 导入 NoteInfos
    if (data.noteInfos?.length) {
      for (const item of data.noteInfos) {
        const { id, categoryId, ...rest } = item
        const newCategoryId = idMaps.categories[categoryId]
        if (!newCategoryId) continue

        const created = await prisma.noteInfo.create({
          data: {
            ...rest,
            categoryId: newCategoryId,
            createdAt: new Date(rest.createdAt),
            updatedAt: new Date(rest.updatedAt),
          },
        })
        idMaps.noteInfos[id] = created.id
      }
    }

    // 7. 导入 NoteContents
    if (data.noteContents?.length) {
      for (const item of data.noteContents) {
        const { id, noteInfoId, ...rest } = item
        const newNoteInfoId = idMaps.noteInfos[noteInfoId]
        if (!newNoteInfoId) continue

        const created = await prisma.noteContent.create({
          data: {
            ...rest,
            noteInfoId: newNoteInfoId,
            createdAt: new Date(rest.createdAt),
            updatedAt: new Date(rest.updatedAt),
          },
        })
        idMaps.noteContents[id] = created.id
      }
    }

    // 8. 导入 FileManagements
    if (data.fileManagements?.length) {
      for (const item of data.fileManagements) {
        const { id, fileSize, ...rest } = item
        const created = await prisma.fileManagement.create({
          data: {
            ...rest,
            fileSize: BigInt(fileSize),
            createTime: new Date(rest.createTime),
          },
        })
        idMaps.fileManagements[id] = created.id
      }
    }

    // 9. 导入 SystemConfigs
    if (data.systemConfigs?.length) {
      for (const item of data.systemConfigs) {
        const { id, ...rest } = item

        // 检查是否已存在相同的 configKey
        const existing = await prisma.systemConfig.findUnique({
          where: { configKey: rest.configKey },
        })

        if (existing) {
          // 更新现有配置
          await prisma.systemConfig.update({
            where: { configKey: rest.configKey },
            data: {
              configValue: rest.configValue,
              description: rest.description,
              updatedAt: new Date(rest.updatedAt),
            },
          })
          idMaps.systemConfigs[id] = existing.id
        } else {
          // 创建新配置
          const created = await prisma.systemConfig.create({
            data: {
              ...rest,
              createdAt: new Date(rest.createdAt),
              updatedAt: new Date(rest.updatedAt),
            },
          })
          idMaps.systemConfigs[id] = created.id
        }
      }
    }

    // 10. 导入 SystemHomepages
    if (data.systemHomepages?.length) {
      for (const item of data.systemHomepages) {
        const { id, ...rest } = item
        const created = await prisma.systemHomepage.create({
          data: {
            ...rest,
            createdAt: new Date(rest.createdAt),
            updatedAt: new Date(rest.updatedAt),
          },
        })
        idMaps.systemHomepages[id] = created.id
      }
    }

    // 11. 导入 MerkleTrees
    if (data.merkleTrees?.length) {
      for (const item of data.merkleTrees) {
        const { id, maxCapacity, creationCost, ...rest } = item

        // 检查是否已存在相同的 treeAddress
        const existing = await prisma.merkleTree.findUnique({
          where: { treeAddress: rest.treeAddress },
        })

        if (existing) {
          idMaps.merkleTrees[id] = existing.id
        } else {
          const created = await prisma.merkleTree.create({
            data: {
              ...rest,
              maxCapacity: BigInt(maxCapacity),
              creationCost: BigInt(creationCost),
              createdAt: new Date(rest.createdAt),
              updatedAt: new Date(rest.updatedAt),
            },
          })
          idMaps.merkleTrees[id] = created.id
        }
      }
    }

    // 12. 导入 CompressedNfts
    if (data.compressedNfts?.length) {
      for (const item of data.compressedNfts) {
        const { id, merkleTreeId, projectId, originalImageId, ...rest } = item
        const newMerkleTreeId = idMaps.merkleTrees[merkleTreeId]
        const newProjectId = idMaps.projects[projectId]
        if (!newMerkleTreeId || !newProjectId) continue

        // 检查是否已存在相同的 assetId
        const existing = await prisma.compressedNft.findUnique({
          where: { assetId: rest.assetId },
        })

        if (existing) {
          idMaps.compressedNfts[id] = existing.id
        } else {
          const created = await prisma.compressedNft.create({
            data: {
              ...rest,
              merkleTreeId: newMerkleTreeId,
              projectId: newProjectId,
              originalImageId: originalImageId ? idMaps.fileManagements[originalImageId] || null : null,
              createdAt: new Date(rest.createdAt),
              updatedAt: new Date(rest.updatedAt),
            },
          })
          idMaps.compressedNfts[id] = created.id
        }
      }
    }

    return ok({
      message: 'Database import completed successfully',
      mode,
      imported: {
        projects: Object.keys(idMaps.projects).length,
        projectVersions: Object.keys(idMaps.projectVersions).length,
        categories: Object.keys(idMaps.categories).length,
        projectMenus: Object.keys(idMaps.projectMenus).length,
        projectHomes: Object.keys(idMaps.projectHomes).length,
        noteInfos: Object.keys(idMaps.noteInfos).length,
        noteContents: Object.keys(idMaps.noteContents).length,
        fileManagements: Object.keys(idMaps.fileManagements).length,
        systemConfigs: Object.keys(idMaps.systemConfigs).length,
        systemHomepages: Object.keys(idMaps.systemHomepages).length,
        merkleTrees: Object.keys(idMaps.merkleTrees).length,
        compressedNfts: Object.keys(idMaps.compressedNfts).length,
      },
    })
  } catch (err) {
    console.error('Database import error:', err)
    setResponseStatus(event, 500)
    return fail('Database import failed: ' + (err instanceof Error ? err.message : 'Unknown error'), 500)
  }
})
