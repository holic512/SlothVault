import { createElement } from 'react'
import { renderToStaticMarkup } from 'react-dom/server'

import { describe, expect, it } from 'vitest'

import { ProjectMenuIcon } from '@/components/project/project-menu-icon'

import { isProjectMenuIcon, projectMenuIconKeys, resolveProjectMenuIcon } from './project-menu-icons'

describe('project menu icons', () => {
  it.each([
    ['https://github.com/holic512/slothtool', 'github'],
    ['https://www.GitLab.com/project', 'gitlab'],
    ['https://discord.gg/invite', 'discord'],
    ['https://youtube.com/@channel', 'youtube'],
    ['https://youtu.be/video', 'youtube'],
    ['https://x.com/account', 'twitter'],
    ['https://example.com', 'globe'],
    ['https://github.com.evil.test/project', 'globe'],
    ['https://github.com@evil.test/project', 'globe'],
    ['/docs', 'link'],
    [null, 'link'],
  ])('matches destinations without remote favicons: %s', (url, expected) => {
    expect(resolveProjectMenuIcon({ url })).toBe(expected)
  })

  it('supports legacy menus, explicit choices and hidden icons', () => {
    expect(resolveProjectMenuIcon({ url: 'https://github.com', icon: null })).toBe('github')
    expect(resolveProjectMenuIcon({ url: 'https://github.com', icon: 'terminal' })).toBe('terminal')
    expect(resolveProjectMenuIcon({ url: 'https://github.com', icon: 'none' })).toBeNull()
    expect(resolveProjectMenuIcon({ url: 'https://github.com', icon: 'unknown' })).toBe('github')
    expect(resolveProjectMenuIcon({ children: [{}] })).toBe('folder')
    expect(resolveProjectMenuIcon({ children: [{}], icon: 'github' })).toBe('github')
  })

  it('renders every supported icon locally and hides decorative icons from assistive technology', () => {
    for (const icon of projectMenuIconKeys) {
      expect(isProjectMenuIcon(icon)).toBe(true)
      const html = renderToStaticMarkup(createElement(ProjectMenuIcon, { icon }))
      if (icon === 'none') { expect(html).toBe(''); continue }
      expect(html).toContain('<svg')
      expect(html).toContain('aria-hidden="true"')
      expect(html).not.toContain('<img')
    }
    expect(isProjectMenuIcon('<svg>')).toBe(false)
    expect(isProjectMenuIcon({})).toBe(false)
  })
})
