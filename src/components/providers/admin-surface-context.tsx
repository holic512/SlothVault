'use client'

/**
 * @file admin-surface-context.tsx
 * @project SlothVault
 * @module Administrator Surface Boundary
 * @description Identifies management surfaces independently of shared typography and DOM placement.
 * @logic Default to public presentation; inherit the management boundary through React portals.
 * @dependencies React
 * @index_tags admin,context,portal,design
 * @author holic512
 */
import { createContext, useContext } from 'react'

export const AdminSurfaceContext = createContext(false)

export function useAdminSurface() {
  return useContext(AdminSurfaceContext)
}
