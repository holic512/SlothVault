/**
 * @file homepage-cover.ts
 * @project SlothVault
 * @module Homepage Cover Contract
 * @description Shares the bounded optional homepage cover configuration across editing, rendering, file access, and backups.
 * @logic Accept only canonical local static-image paths and explicit positions; invalid persisted settings fall back to a disabled cover.
 * @dependencies none
 * @index_tags homepage,cover,config,validation,uploads
 * @author holic512
 */
export type HomepageCover = {
  enabled: boolean
  filePath: string
  positionX: number
  positionY: number
}

export const DEFAULT_HOMEPAGE_COVER: HomepageCover = Object.freeze({
  enabled: false,
  filePath: '',
  positionX: 50,
  positionY: 50,
})

export const HOMEPAGE_COVER_CONFIG_MAX_CHARACTERS = 500

function isCoverPath(value: string) {
  return value.startsWith('uploads/') && /\.(?:jpe?g|png|webp)$/i.test(value) &&
    value.split('/').every(segment => /^[a-zA-Z0-9_-][a-zA-Z0-9._-]*$/.test(segment))
}

export function parseHomepageCover(value: unknown): HomepageCover | null {
  if (!value || typeof value !== 'object' || Array.isArray(value)) return null
  const keys = Object.keys(value)
  if (keys.length !== 4 || !['enabled', 'filePath', 'positionX', 'positionY'].every(key => Object.hasOwn(value, key))) return null
  const { enabled, filePath, positionX, positionY } = value as Record<string, unknown>
  if (typeof enabled !== 'boolean' || typeof filePath !== 'string' ||
      typeof positionX !== 'number' || !Number.isFinite(positionX) || positionX < 0 || positionX > 100 ||
      typeof positionY !== 'number' || !Number.isFinite(positionY) || positionY < 0 || positionY > 100 ||
      (filePath !== '' && !isCoverPath(filePath)) || (enabled && !filePath)) return null
  const cover = { enabled, filePath, positionX, positionY }
  return JSON.stringify(cover).length <= HOMEPAGE_COVER_CONFIG_MAX_CHARACTERS ? cover : null
}

export function readHomepageCover(value: string | null | undefined): HomepageCover {
  if (!value || value.length > HOMEPAGE_COVER_CONFIG_MAX_CHARACTERS) return { ...DEFAULT_HOMEPAGE_COVER }
  try { return parseHomepageCover(JSON.parse(value)) ?? { ...DEFAULT_HOMEPAGE_COVER } }
  catch { return { ...DEFAULT_HOMEPAGE_COVER } }
}

/** Disabled covers remain previewable by the administrator. */
export function homepageCoverUrl(cover: HomepageCover): string | null {
  return isCoverPath(cover.filePath) ? `/${cover.filePath}` : null
}
