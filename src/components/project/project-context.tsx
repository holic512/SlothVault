'use client'

/**
 * @file project-context.tsx
 * @project SlothVault
 * @module Public Project State
 * @description Shares public project metadata, versions, and menus across nested reading routes.
 * @logic Keep one public project query in the layout and expose its stable reading context to home, redirect, and note pages.
 * @dependencies React context
 * @index_tags project,context,reader,state-boundary
 * @author holic512
 */
import { createContext, useContext } from 'react'

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

export type ProjectContextValue = {
  projectId: string
  project: PublicProject
  versions: ProjectVersion[]
  menus: ProjectMenu[]
}

const ProjectContext = createContext<ProjectContextValue | null>(null)

export const ProjectContextProvider = ProjectContext.Provider

export function useProjectContext() {
  const context = useContext(ProjectContext)
  if (!context) throw new Error('useProjectContext must be used inside ProjectShell')
  return context
}
