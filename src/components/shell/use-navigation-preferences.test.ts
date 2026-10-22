import { describe, expect, it } from 'vitest'

import { expandNavigationGroup, parseNavigationPreferences } from './use-navigation-preferences'

describe('navigation preferences', () => {
  it('recovers corrupt and old storage without hiding the navigation', () => {
    for (const value of [null, 'not-json', 'null', '42', '{}']) {
      expect(parseNavigationPreferences(value)).toEqual({ collapsed: false, openGroups: [], route: '' })
    }
  })

  it('accepts bounded group identifiers and only a boolean collapsed preference', () => {
    expect(parseNavigationPreferences(JSON.stringify({ collapsed: 'true', openGroups: ['content', 'content', null, 8, 'plugins'], route: '/untrusted' })))
      .toEqual({ collapsed: false, openGroups: ['content', 'plugins'], route: '' })
    expect(parseNavigationPreferences(JSON.stringify({ collapsed: true, openGroups: Array.from({ length: 60 }, (_, index) => `group-${index}`) })).openGroups).toHaveLength(50)
  })

  it('opens a destination group without discarding other manually expanded groups', () => {
    const value = { collapsed: true, openGroups: ['content'], route: '/admin/mm/articles:content' }
    expect(expandNavigationGroup(value, 'plugins', '/admin/mm/plugins:plugins')).toEqual({
      collapsed: true, openGroups: ['content', 'plugins'], route: '/admin/mm/plugins:plugins',
    })
    expect(value.openGroups).toEqual(['content'])
  })

  it('allows closing the current group until the route changes', () => {
    const value = { collapsed: false, openGroups: [], route: '/account/points:benefits' }
    expect(expandNavigationGroup(value, 'benefits', '/account/points:benefits')).toBe(value)
    expect(expandNavigationGroup(value, 'benefits', '/account/membership:benefits').openGroups).toEqual(['benefits'])
  })

  it('reveals a plugin destination after its contributions arrive asynchronously', () => {
    const pending = { collapsed: false, openGroups: ['account'], route: '/account/extensions/example:' }
    expect(expandNavigationGroup(pending, 'plugins', '/account/extensions/example:plugins').openGroups).toEqual(['account', 'plugins'])
  })

  it('keeps overview routes outside collapsible groups', () => {
    const value = { collapsed: false, openGroups: ['system'], route: '/admin/mm/settings:system' }
    expect(expandNavigationGroup(value, undefined, '/admin/mm:overview').openGroups).toEqual(['system'])
  })
})
