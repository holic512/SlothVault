/**
 * @file page.tsx
 * @project SlothVault
 * @module Public Homepage
 * @description Renders the administrator-managed Markdown homepage in the shared public shell.
 * @logic Read the newest enabled homepage at request time and fall back to a truthful built-in introduction.
 * @dependencies homepage service, MarkdownView, PublicNavbar
 * @index_tags homepage,public,markdown
 * @author holic512
 */
import { MarkdownView } from '@/components/markdown/markdown-view'
import { PublicNavbar } from '@/components/shell/public-navbar'
import { getHomepageContent } from '@/server/services/homepage'
import publicStyles from '@/styles/modules/public.module.css'

export const dynamic = 'force-dynamic'

export default async function HomePage() {
  const content = await getHomepageContent()

  return (
    <div className={`${publicStyles.root} public-page`}>
      <PublicNavbar />
      <main className="homepage-main">
        <div className="content-container content-container--reading">
          <MarkdownView content={content} className="homepage-markdown" />
        </div>
      </main>
    </div>
  )
}
