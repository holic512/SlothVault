/**
 * @file page.tsx
 * @project SlothVault
 * @module Public Homepage
 * @description Renders the optional personal cover, administrator-managed Markdown homepage and database-backed filing information.
 * @logic Read homepage content and validated cover independently at request time, frame meaningful content or the existing empty state, and retain authorized plugin slots around the core content.
 * @dependencies homepage services, HomepageSurface, MarkdownView, PublicNavbar, SystemFilingFooter, next-intl, PluginSlot
 * @index_tags homepage,public,cover,markdown,empty-state
 * @author holic512
 */
import { getTranslations } from 'next-intl/server'

import { PluginSlot } from '@/components/plugins/plugin-ui'
import { MarkdownView } from '@/components/markdown/markdown-view'
import { PublicNavbar } from '@/components/shell/public-navbar'
import { HomepageSurface } from '@/components/shell/homepage-surface'
import { SystemFilingFooter } from '@/components/shell/system-filing-footer'
import { createPageMetadata } from '@/i18n/metadata'
import { getSystemBranding } from '@/server/services/system-branding'
import { getHomepageContent } from '@/server/services/homepage'
import { getPublicHomepageCover } from '@/server/services/homepage-cover'
import publicStyles from '@/styles/modules/public.module.css'

export const dynamic = 'force-dynamic'

export async function generateMetadata() {
  return createPageMetadata('home')
}

export default async function HomePage() {
  const [content, t, branding, cover] = await Promise.all([
    getHomepageContent(),
    getTranslations('HomepageEmpty'),
    getSystemBranding(),
    getPublicHomepageCover(),
  ])

  return (
    <div className={`${publicStyles.root} public-page`}>
      <PublicNavbar branding={branding} />
      <HomepageSurface cover={cover}>
        <div className="content-container content-container--reading">
          <PluginSlot name="public.home.before" surface="public" />
          {content ? (
            <MarkdownView content={content} className="homepage-markdown" presentation="landing" />
          ) : (
            <section className="homepage-empty" aria-labelledby="homepage-empty-title">
              <h1 id="homepage-empty-title">{t('title')}</h1>
              <p>{t('description')}</p>
            </section>
          )}
          <PluginSlot name="public.home.after" surface="public" />
        </div>
      </HomepageSurface>
      <SystemFilingFooter />
    </div>
  )
}
