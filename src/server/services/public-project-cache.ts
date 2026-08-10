/**
 * @file public-project-cache.ts
 * @project SlothVault
 * @module Public Project Data Cache
 * @description Adds a short shared Next.js Data Cache in front of published project reads used by Server Components.
 * @logic Cache public navigation and document data independently for one minute so request-rendered pages avoid repeated ORM work while administrative publication changes become visible promptly.
 * @dependencies next/cache, public-projects service
 * @index_tags nextjs, data-cache, public-project, reading, revalidate
 * @author holic512
 */
import 'server-only'

import { unstable_cache } from 'next/cache'

import {
  getProjectHome,
  getProjectMenu,
  getProjectNote,
  getProjectSidebar,
  getProjectVersions,
  getPublicProject,
  listPublicProjects,
} from '@/server/services/public-projects'

const PUBLIC_CONTENT_REVALIDATE_SECONDS = 60

function iso(value: Date) {
  return value.toISOString()
}

export function getCachedPublicProjectList() {
  return unstable_cache(
    async () => {
      const projects = await listPublicProjects()
      return projects.map((project) => ({ ...project, updatedAt: iso(project.updatedAt) }))
    },
    ['public-project-list'],
    { revalidate: PUBLIC_CONTENT_REVALIDATE_SECONDS },
  )()
}

export function getCachedProjectShell(projectId: number) {
  return unstable_cache(
    async () => {
      const [project, versions, menus] = await Promise.all([
        getPublicProject(projectId),
        getProjectVersions(projectId),
        getProjectMenu(projectId),
      ])
      return {
        project: { ...project, updatedAt: iso(project.updatedAt) },
        versions,
        menus,
      }
    },
    ['public-project-shell', String(projectId)],
    { revalidate: PUBLIC_CONTENT_REVALIDATE_SECONDS },
  )()
}

export function getCachedProjectHome(projectId: number) {
  return unstable_cache(
    async () => {
      const home = await getProjectHome(projectId)
      return { ...home, updatedAt: iso(home.updatedAt) }
    },
    ['public-project-home', String(projectId)],
    { revalidate: PUBLIC_CONTENT_REVALIDATE_SECONDS },
  )()
}

export function getCachedProjectVersions(projectId: number) {
  return unstable_cache(
    () => getProjectVersions(projectId),
    ['public-project-versions', String(projectId)],
    { revalidate: PUBLIC_CONTENT_REVALIDATE_SECONDS },
  )()
}

export function getCachedProjectSidebar(projectId: number, versionId: number) {
  return unstable_cache(
    () => getProjectSidebar(projectId, versionId),
    ['public-project-sidebar', String(projectId), String(versionId)],
    { revalidate: PUBLIC_CONTENT_REVALIDATE_SECONDS },
  )()
}

export function getCachedProjectNote(projectId: number, versionId: number, noteId: number) {
  return unstable_cache(
    async () => {
      const note = await getProjectNote(projectId, versionId, noteId)
      return {
        ...note,
        updatedAt: iso(note.updatedAt),
        certificate: note.certificate
          ? { ...note.certificate, issuedAt: iso(note.certificate.issuedAt) }
          : null,
      }
    },
    ['public-project-note', String(projectId), String(versionId), String(noteId)],
    { revalidate: PUBLIC_CONTENT_REVALIDATE_SECONDS },
  )()
}
