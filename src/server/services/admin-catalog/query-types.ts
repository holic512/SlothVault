/**
 * @file query-types.ts
 * @project SlothVault
 * @module Admin Catalog Query Types
 * @description Defines the list query contracts shared by catalog administration services.
 * @logic Constrain supported order fields and combine pagination with project, version, and category filters.
 * @dependencies TypeScript type system
 * @index_tags admin,catalog,query,pagination,types
 * @author holic512
 */
import 'server-only'

type ProjectOrderField =
  | 'id'
  | 'projectName'
  | 'weight'
  | 'status'
  | 'createdAt'
  | 'updatedAt'

type ProjectVersionOrderField =
  | 'id'
  | 'version'
  | 'weight'
  | 'status'
  | 'createdAt'
  | 'updatedAt'

type CategoryOrderField =
  | 'id'
  | 'categoryName'
  | 'weight'
  | 'status'
  | 'createdAt'
  | 'updatedAt'

type PageQuery<TOrderField extends string> = {
  page: number
  pageSize: number
  skip: number
  orderByField: TOrderField
  order: 'asc' | 'desc'
}

export type ProjectListQuery = PageQuery<ProjectOrderField> & {
  keyword: string
  includeDeleted: boolean
  onlyDeleted: boolean
  status?: number
}

export type ProjectVersionListQuery = PageQuery<ProjectVersionOrderField> & {
  keyword: string
  includeDeleted: boolean
  onlyDeleted: boolean
  includeProject: boolean
  status?: number
  projectId?: number
}

export type ProjectVersionByProjectQuery = PageQuery<ProjectVersionOrderField> & {
  projectId: number
  includeDeleted: boolean
  onlyDeleted: boolean
  includeProjectInfo: boolean
}

export type CategoryListQuery = PageQuery<CategoryOrderField> & {
  keyword: string
  includeDeleted: boolean
  onlyDeleted: boolean
  includeProjectVersion: boolean
  status?: number
  projectVersionId?: number
  projectId?: number
}

export type CategoryByProjectVersionQuery = PageQuery<CategoryOrderField> & {
  projectVersionId: number
  includeDeleted: boolean
  onlyDeleted: boolean
  includeProjectVersionInfo: boolean
}
