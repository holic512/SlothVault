/**
 * @file admin-catalog.ts
 * @project SlothVault
 * @module Admin Catalog
 * @description Preserves the public service entry point for catalog parsing, DTO mapping, and project, version, and category administration.
 * @logic Re-export the focused catalog modules so existing route and service imports keep the same contract.
 * @dependencies admin-catalog values, DTOs, query types, projects, project versions, categories
 * @index_tags admin,catalog,service,facade
 * @author holic512
 */
import 'server-only'

export * from './admin-catalog/categories'
export * from './admin-catalog/dtos'
export * from './admin-catalog/project-versions'
export * from './admin-catalog/projects'
export * from './admin-catalog/query-types'
export * from './admin-catalog/values'
