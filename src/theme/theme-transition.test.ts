import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest'

import { createThemeTransition, themeRevealRadius } from './theme-transition'

function deferred() {
  let resolve!: () => void
  let reject!: (reason?: unknown) => void
  const promise = new Promise<void>((yes, no) => { resolve = yes; reject = no })
  return { promise, resolve, reject }
}

function snapshot() {
  const ready = deferred()
  const finished = deferred()
  return {
    ready,
    finished,
    transition: { ready: ready.promise, finished: finished.promise, skipTransition: vi.fn() },
  }
}

describe('theme reveal', () => {
  const apply = vi.fn()
  let update: () => void
  let view: ReturnType<typeof snapshot>
  let root: { setAttribute: ReturnType<typeof vi.fn>; removeAttribute: ReturnType<typeof vi.fn>; animate: ReturnType<typeof vi.fn> }
  let startViewTransition: ReturnType<typeof vi.fn>
  let animation: { finished: Promise<void>; cancel: ReturnType<typeof vi.fn> }

  beforeEach(() => {
    apply.mockReset()
    view = snapshot()
    animation = { finished: Promise.resolve(), cancel: vi.fn() }
    root = { setAttribute: vi.fn(), removeAttribute: vi.fn(), animate: vi.fn(() => animation) }
    startViewTransition = vi.fn((callback: () => void) => { update = callback; return view.transition })
    vi.stubGlobal('document', { documentElement: root, startViewTransition })
    vi.stubGlobal('window', { innerWidth: 1440, innerHeight: 900, matchMedia: vi.fn(() => ({ matches: false })) })
  })

  afterEach(() => vi.unstubAllGlobals())

  it.each([{ x: 0, y: 0 }, { x: 720, y: 450 }, { x: 1380, y: 75 }])('covers every viewport corner from $x,$y', (origin) => {
    const radius = themeRevealRadius(origin, 1440, 900)
    for (const [x, y] of [[0, 0], [1440, 0], [0, 900], [1440, 900]]) {
      expect(radius).toBeGreaterThanOrEqual(Math.hypot(x - origin.x, y - origin.y))
    }
  })

  it.each(['light', 'dark'] as const)('reveals %s outward with the same timing and cleans up', async (next) => {
    const controller = createThemeTransition(next === 'dark' ? 'light' : 'dark', apply)
    controller.setTheme(next, { x: 200, y: 100 })
    expect(apply).not.toHaveBeenCalled()
    expect(root.setAttribute).toHaveBeenCalledWith('data-theme-transition', '')
    update()
    expect(apply).toHaveBeenCalledExactlyOnceWith(next)
    view.ready.resolve()
    await vi.waitFor(() => expect(root.animate).toHaveBeenCalledOnce())
    expect(root.animate).toHaveBeenCalledWith({ clipPath: [
      'circle(0px at 200px 100px)',
      `circle(${themeRevealRadius({ x: 200, y: 100 }, 1440, 900)}px at 200px 100px)`,
    ] }, { duration: 480, easing: 'ease-out', fill: 'both', pseudoElement: '::view-transition-new(root)' })
    view.finished.resolve()
    await vi.waitFor(() => expect(root.removeAttribute).toHaveBeenCalledWith('data-theme-transition'))
    expect(animation.cancel).toHaveBeenCalledOnce()
  })

  it.each(['missing transition', 'missing animation', 'reduced motion', 'no origin'])('switches immediately for %s', (reason) => {
    if (reason === 'missing transition') document.startViewTransition = undefined as never
    if (reason === 'missing animation') root.animate = undefined as never
    if (reason === 'reduced motion') vi.mocked(window.matchMedia).mockReturnValue({ matches: true } as MediaQueryList)
    const controller = createThemeTransition('light', apply)
    controller.setTheme('dark', reason === 'no origin' ? undefined : { x: 20, y: 30 })
    expect(apply).toHaveBeenCalledExactlyOnceWith('dark')
    expect(startViewTransition).not.toHaveBeenCalled()
    expect(root.setAttribute).not.toHaveBeenCalled()
  })

  it('ignores the current theme, including during an active reveal', () => {
    const controller = createThemeTransition('light', apply)
    controller.setTheme('light', { x: 20, y: 30 })
    expect(startViewTransition).not.toHaveBeenCalled()
    controller.setTheme('dark', { x: 20, y: 30 })
    controller.setTheme('dark', { x: 30, y: 40 })
    expect(startViewTransition).toHaveBeenCalledOnce()
  })

  it('falls back when snapshot initialization throws', () => {
    startViewTransition.mockImplementation(() => { throw new Error('unavailable') })
    createThemeTransition('light', apply).setTheme('dark', { x: 20, y: 30 })
    expect(apply).toHaveBeenCalledExactlyOnceWith('dark')
    expect(root.removeAttribute).toHaveBeenCalledWith('data-theme-transition')
  })

  it.each(['snapshot', 'animation'])('cleans up a failed %s without dropping the requested theme', async (reason) => {
    createThemeTransition('light', apply).setTheme('dark', { x: 20, y: 30 })
    if (reason === 'snapshot') view.ready.reject(new Error('snapshot failed'))
    else {
      root.animate.mockImplementation(() => { throw new Error('animation failed') })
      update()
      view.ready.resolve()
    }
    await vi.waitFor(() => expect(view.transition.skipTransition).toHaveBeenCalledOnce())
    expect(apply).toHaveBeenCalledExactlyOnceWith('dark')
    expect(root.removeAttribute).toHaveBeenCalledWith('data-theme-transition')
  })

  it('prevents an interrupted snapshot from overwriting the latest theme or cleaning up its effect', async () => {
    const controller = createThemeTransition('light', apply)
    controller.setTheme('dark', { x: 20, y: 30 })
    const oldUpdate = update
    const oldView = view
    view = snapshot()
    controller.setTheme('light', { x: 40, y: 50 })
    oldUpdate()
    update()
    expect(apply).toHaveBeenCalledExactlyOnceWith('light')
    expect(oldView.transition.skipTransition).toHaveBeenCalledOnce()
    root.removeAttribute.mockClear()
    oldView.finished.resolve()
    await oldView.finished.promise
    expect(root.removeAttribute).not.toHaveBeenCalled()
    view.ready.resolve()
    await vi.waitFor(() => expect(root.animate).toHaveBeenCalledOnce())
    controller.cancel()
    expect(animation.cancel).toHaveBeenCalledOnce()
    expect(root.removeAttribute).toHaveBeenCalledWith('data-theme-transition')
  })

  it('does not run a queued update after unmount cancellation', async () => {
    const controller = createThemeTransition('light', apply)
    controller.setTheme('dark', { x: 20, y: 30 })
    controller.cancel()
    update()
    view.ready.resolve()
    await view.ready.promise
    expect(apply).not.toHaveBeenCalled()
    expect(root.animate).not.toHaveBeenCalled()
    expect(root.removeAttribute).toHaveBeenCalledWith('data-theme-transition')
  })
})
