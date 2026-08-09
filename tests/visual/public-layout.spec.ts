import { expect, test, type BrowserContext, type Page } from '@playwright/test'

const baseURL = 'http://localhost:3000'

async function setTheme(context: BrowserContext, page: Page, theme: 'light' | 'dark') {
  await context.addCookies([
    { name: 'sv_theme', value: theme, url: baseURL },
    { name: 'sv_locale', value: 'en', url: baseURL },
  ])
  await page.addInitScript((value) => localStorage.setItem('theme', value), theme)
}

async function stabilize(page: Page) {
  await page.addStyleTag({
    content: `
      nextjs-portal { display: none !important; }
      html { scrollbar-width: none !important; }
      *::-webkit-scrollbar { display: none !important; }
      *, *::before, *::after { animation-duration: 0s !important; transition-duration: 0s !important; }
    `,
  })
  await expect.poll(() => page.evaluate(() => document.fonts.status)).toBe('loaded')
}

async function expectNoHorizontalOverflow(page: Page) {
  const overflow = await page.evaluate(() => document.documentElement.scrollWidth - document.documentElement.clientWidth)
  expect(overflow).toBeLessThanOrEqual(1)
}

async function mockProjectList(page: Page) {
  await page.route('**/api/project/list', async (route) => {
    await route.fulfill({
      contentType: 'application/json',
      body: JSON.stringify({
        code: 0,
        message: 'ok',
        data: [
          {
            id: 'visual-project-a',
            projectName: 'Atlas Notes',
            avatar: null,
            latestVersion: '2.4',
            latestVersionDesc: 'A stable collection for testing the editorial publication card and responsive grid.',
            categoryCount: 8,
            updatedAt: '2026-01-15T12:00:00.000Z',
          },
          {
            id: 'visual-project-b',
            projectName: 'Quiet Systems',
            avatar: null,
            latestVersion: '1.0',
            latestVersionDesc: 'Documentation with deliberately restrained typography and metadata.',
            categoryCount: 5,
            updatedAt: '2026-01-12T12:00:00.000Z',
          },
          {
            id: 'visual-project-c',
            projectName: 'Field Manual',
            avatar: null,
            latestVersion: '3.1',
            latestVersionDesc: 'A third card keeps the representative desktop grid behavior observable.',
            categoryCount: 11,
            updatedAt: '2026-01-10T12:00:00.000Z',
          },
        ],
      }),
    })
  })
}

test('@desktop public navigation and publication grid remain stable', async ({ context, page }) => {
  await setTheme(context, page, 'light')
  await mockProjectList(page)
  await page.goto('/project/projectList')
  await expect(page.getByRole('heading', { name: 'Atlas Notes' })).toBeVisible()
  await stabilize(page)
  await expectNoHorizontalOverflow(page)
  await expect(page).toHaveScreenshot('publication-grid-light.png', { fullPage: true })
})

test('@desktop authentication surface hydrates directly into light mode', async ({ context, page }) => {
  await setTheme(context, page, 'light')
  await page.goto('/login')
  await expect(page.locator('html')).toHaveClass(/light/)
  await expect(page.locator('.auth-card')).toBeVisible()
  await stabilize(page)
  await expectNoHorizontalOverflow(page)
  await expect(page).toHaveScreenshot('login-light.png', { fullPage: true })
})

test('@desktop authentication surface hydrates directly into dark mode', async ({ context, page }) => {
  await setTheme(context, page, 'dark')
  await page.goto('/login')
  await expect(page.locator('html')).toHaveClass(/dark/)
  await expect(page.locator('.auth-card')).toBeVisible()
  await stabilize(page)
  await expectNoHorizontalOverflow(page)
  await expect(page).toHaveScreenshot('login-dark.png', { fullPage: true })
})

test('@mobile mobile navigation keeps public destinations reachable', async ({ context, page }) => {
  await setTheme(context, page, 'light')
  await mockProjectList(page)
  await page.goto('/project/projectList')
  await expect(page.getByRole('heading', { name: 'Atlas Notes' })).toBeVisible()
  await page.getByRole('button', { name: 'Open navigation' }).click()
  await expect(page.getByRole('navigation', { name: 'Mobile navigation' })).toBeVisible()
  await stabilize(page)
  await expect(page).toHaveScreenshot('mobile-navigation-open.png')
})
