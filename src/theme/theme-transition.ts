/**
 * @file theme-transition.ts
 * @project SlothVault
 * @module Theme Transition
 * @description Coordinates interruptible, accessible circular reveals for explicit color-mode changes.
 * @logic Commit only the latest requested theme, reveal its snapshot from the interaction origin, and release temporary effects on completion or fallback.
 * @dependencies app-theme, View Transition API, Web Animations API
 * @index_tags theme,animation,accessibility,view-transition
 * @author holic512
 */

import type { AppTheme } from '@/theme/app-theme'

export type ThemeTransitionOrigin = { x: number; y: number }

export function themeRevealRadius(origin: ThemeTransitionOrigin, width: number, height: number) {
  return Math.hypot(Math.max(origin.x, width - origin.x), Math.max(origin.y, height - origin.y))
}

export function createThemeTransition(initialTheme: AppTheme, applyTheme: (theme: AppTheme) => void) {
  let theme = initialTheme
  let cancelActive: (() => void) | undefined

  function cancel() {
    cancelActive?.()
    cancelActive = undefined
  }

  function setTheme(nextTheme: AppTheme, origin?: ThemeTransitionOrigin) {
    if (nextTheme === theme) return
    cancel()
    theme = nextTheme

    if (!origin || typeof document.startViewTransition !== 'function'
      || typeof document.documentElement.animate !== 'function'
      || window.matchMedia('(prefers-reduced-motion: reduce)').matches) {
      applyTheme(nextTheme)
      return
    }

    const root = document.documentElement
    let cancelled = false
    let applied = false
    let transition: ViewTransition | undefined
    let animation: Animation | undefined
    const apply = () => {
      if (cancelled || applied) return
      applied = true
      applyTheme(nextTheme)
    }
    const cleanup = () => {
      if (cancelActive !== stop) return
      animation?.cancel()
      root.removeAttribute('data-theme-transition')
      cancelActive = undefined
    }
    const stop = () => {
      cancelled = true
      transition?.skipTransition()
      cleanup()
    }
    cancelActive = stop
    root.setAttribute('data-theme-transition', '')

    try {
      transition = document.startViewTransition(apply)
      const currentTransition = transition
      void transition.ready.then(() => {
        if (cancelled) return
        const radius = themeRevealRadius(origin, window.innerWidth, window.innerHeight)
        animation = root.animate({
          clipPath: [
            `circle(0px at ${origin.x}px ${origin.y}px)`,
            `circle(${radius}px at ${origin.x}px ${origin.y}px)`,
          ],
        }, {
          duration: 480,
          easing: 'ease-out',
          fill: 'both',
          pseudoElement: '::view-transition-new(root)',
        })
        // Cancellation rejects this promise, but must never reject the theme change.
        void animation.finished.catch(() => {})
      }).catch(() => {
        apply()
        currentTransition.skipTransition()
        cleanup()
      })
      void transition.finished.then(cleanup, cleanup)
    } catch {
      apply()
      transition?.skipTransition()
      cleanup()
    }
  }

  return { setTheme, cancel }
}
