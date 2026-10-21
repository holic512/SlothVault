/**
 * @file project-menu-icons.ts
 * @project SlothVault
 * @module Project Navigation Icons
 * @description Defines portable menu icon keys and deterministic URL-based defaults without remote image requests.
 * @logic Prefer explicit choices, honor hidden icons, recognize trusted hostnames, then fall back to a folder or link.
 * @dependencies None
 * @index_tags project,menu,icons,validation,defaults
 * @author holic512
 */
export const projectMenuIconKeys = [
  'home', 'book-open', 'github', 'gitlab', 'discord', 'youtube', 'twitter',
  'code', 'terminal', 'download', 'globe', 'link', 'folder', 'message-circle', 'file-text', 'external-link', 'none',
] as const

export type ProjectMenuIconKey = typeof projectMenuIconKeys[number]

export function isProjectMenuIcon(value: unknown): value is ProjectMenuIconKey {
  return typeof value === 'string' && projectMenuIconKeys.includes(value as ProjectMenuIconKey)
}

export function resolveProjectMenuIcon(menu: { icon?: string | null; url?: string | null; children?: unknown[] }): Exclude<ProjectMenuIconKey, 'none'> | null {
  if (menu.icon === 'none') return null
  if (isProjectMenuIcon(menu.icon)) return menu.icon as Exclude<ProjectMenuIconKey, 'none'>
  if (menu.children?.length) return 'folder'
  if (menu.url) {
    try {
      const url = new URL(menu.url)
      if (url.protocol === 'https:' || url.protocol === 'http:') {
        const host = url.hostname.toLowerCase().replace(/^www\./, '')
        if (host === 'github.com') return 'github'
        if (host === 'gitlab.com') return 'gitlab'
        if (host === 'discord.com' || host === 'discord.gg') return 'discord'
        if (host === 'youtube.com' || host === 'youtu.be') return 'youtube'
        if (host === 'x.com' || host === 'twitter.com') return 'twitter'
        return 'globe'
      }
    } catch { /* Relative destinations use the generic link icon. */ }
  }
  return 'link'
}
