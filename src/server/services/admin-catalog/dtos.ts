/**
 * @file dtos.ts
 * @project SlothVault
 * @module Admin Catalog DTOs
 * @description Maps project, project-version, and category records to stable administrator API DTOs.
 * @logic Serialize identifiers, retain existing nested relation shapes, and force legacy project authentication output to false.
 * @dependencies Prisma-compatible catalog record shapes
 * @index_tags admin,catalog,dto,project,project-version,category
 * @author holic512
 */
import 'server-only'

type ProjectLike = {
  id: number
  projectName: string
  avatar: string | null
  weight: number
  status: number
  requireAuth: boolean
  createdAt: Date
  updatedAt: Date
  isDeleted: boolean
}

type ProjectVersionLike = {
  id: number
  projectId: number
  version: string
  description: string | null
  weight: number
  status: number
  releaseId: string | null
  releaseHash: string | null
  manifestVersion: number | null
  publishedAt: Date | null
  createdAt: Date
  updatedAt: Date
  isDeleted: boolean
  project?: Pick<ProjectLike, 'id' | 'projectName'> | null
}

type CategoryLike = {
  id: number
  projectVersionId: number
  categoryName: string
  weight: number
  status: number
  createdAt: Date
  updatedAt: Date
  isDeleted: boolean
  projectVersion?:
    | (Pick<ProjectVersionLike, 'id' | 'projectId' | 'version'> & {
        publishedAt?: Date | null
        project?: Pick<ProjectLike, 'id' | 'projectName'> | null
      })
    | null
}

export function projectDto(project: ProjectLike) {
  return {
    id: project.id.toString(),
    projectName: project.projectName,
    avatar: project.avatar,
    weight: project.weight,
    status: project.status,
    requireAuth: false,
    createdAt: project.createdAt,
    updatedAt: project.updatedAt,
    isDeleted: project.isDeleted,
  }
}

export function projectSummaryDto(project: ProjectLike) {
  return {
    id: project.id.toString(),
    projectName: project.projectName,
    weight: project.weight,
    status: project.status,
    requireAuth: false,
    createdAt: project.createdAt,
    updatedAt: project.updatedAt,
    isDeleted: project.isDeleted,
  }
}

export function projectListDto(
  project: ProjectLike & {
    versions?: Array<{
      id: number
      version: string
      isDeleted: boolean
      _count?: { categories: number }
    }>
  },
) {
  const latestVersion = project.versions?.find((version) => !version.isDeleted)
  return {
    ...projectDto(project),
    latestVersion: latestVersion?.version || null,
    latestVersionId: latestVersion?.id.toString() || null,
    categoryCount: latestVersion?._count?.categories ?? 0,
  }
}

export function projectVersionBaseDto(projectVersion: ProjectVersionLike) {
  return {
    id: projectVersion.id.toString(),
    projectId: projectVersion.projectId.toString(),
    version: projectVersion.version,
    description: projectVersion.description,
    weight: projectVersion.weight,
    status: projectVersion.status,
    releaseId: projectVersion.releaseId,
    releaseHash: projectVersion.releaseHash,
    manifestVersion: projectVersion.manifestVersion,
    publishedAt: projectVersion.publishedAt,
    createdAt: projectVersion.createdAt,
    updatedAt: projectVersion.updatedAt,
    isDeleted: projectVersion.isDeleted,
  }
}

export function projectVersionDto(projectVersion: ProjectVersionLike) {
  return {
    ...projectVersionBaseDto(projectVersion),
    project: projectVersion.project
      ? {
          id: projectVersion.project.id.toString(),
          projectName: projectVersion.project.projectName,
        }
      : null,
  }
}
export function categoryBaseDto(category: CategoryLike) {
  return {
    id: category.id.toString(),
    projectVersionId: category.projectVersionId.toString(),
    categoryName: category.categoryName,
    weight: category.weight,
    status: category.status,
    createdAt: category.createdAt,
    updatedAt: category.updatedAt,
    isDeleted: category.isDeleted,
  }
}

export function categoryDto(category: CategoryLike) {
  const projectVersion = category.projectVersion
  return {
    ...categoryBaseDto(category),
    projectVersion: projectVersion
      ? {
          id: projectVersion.id.toString(),
          version: projectVersion.version,
          projectId: projectVersion.projectId.toString(),
          publishedAt: projectVersion.publishedAt ?? null,
          ...(projectVersion.project !== undefined
            ? {
                project: projectVersion.project
                  ? {
                      id: projectVersion.project.id.toString(),
                      projectName: projectVersion.project.projectName,
                    }
                  : null,
              }
            : {}),
        }
      : null,
  }
}
