/**
 * @file page.tsx
 * @project SlothVault
 * @module Public Homepage
 * @description Renders the administrator-managed Markdown homepage or a concise empty state in the shared public shell.
 * @logic Read enabled homepage content at request time, render it when meaningful, and otherwise direct visitors to the administrator for publication.
 * @dependencies homepage service, MarkdownView, PublicNavbar, next-intl
 * @index_tags homepage,public,markdown,empty-state
 * @author holic512
 */
import { getTranslations } from 'next-intl/server'

import { MarkdownView } from '@/components/markdown/markdown-view'
import { PublicNavbar } from '@/components/shell/public-navbar'
import { createPageMetadata } from '@/i18n/metadata'
import { getSystemBranding } from '@/server/services/system-branding'
import { getHomepageContent } from '@/server/services/homepage'
import publicStyles from '@/styles/modules/public.module.css'

export const dynamic = 'force-dynamic'

export async function generateMetadata() {
  return createPageMetadata('home')
}

export default async function HomePage() {
  const [content, t, branding] = await Promise.all([
    getHomepageContent(),
    getTranslations('HomepageEmpty'),
    getSystemBranding(),
  ])

  return (
    <div className={`${publicStyles.root} public-page`}>
      <PublicNavbar branding={branding} />
      <main className="homepage-main">
        <div className="content-container content-container--reading">
          {content ? (
            <MarkdownView content={content} className="homepage-markdown" />
          ) : (
            <section className="homepage-empty" aria-labelledby="homepage-empty-title">
              <h1 id="homepage-empty-title">{t('title')}</h1>
              <p>{t('description')}</p>
            </section>
          )}
        </div>
      </main>
    </div>
  )
}
