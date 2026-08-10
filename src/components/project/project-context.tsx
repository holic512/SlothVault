/**
 * @file project-context.tsx
 * @project SlothVault
 * @module Public Project DTOs
 * @description Defines the serialized public project navigation shapes shared by the server layout and client navigation island.
 * @logic Keep project, version, and menu contracts independent from React state so route data can remain server-rendered.
 * @dependencies None
 * @index_tags project, dto, reader, navigation
 * @author holic512
 */
export type PublicProject = {
  id: string
  projectName: string
  avatar: string | null
  status: number
  updatedAt: string
}

export type ProjectVersion = {
  id: string
  version: string
  description: string | null
  weight: number
}

export type ProjectMenu = {
  id: string
  label: string
  url: string | null
  isExternal: boolean
  weight: number
  children: ProjectMenu[]
}
