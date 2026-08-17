/**
 * @file page.tsx
 * @project SlothVault
 * @module Public Personal Homepage
 * @description Renders a shareable personal profile and the administrator-authored public article archive.
 * @logic Resolve the profile, return a real 404 when absent, and mark articles whose containing release has transaction evidence.
 * @dependencies Next metadata/navigation, PublicNavbar, public-users service, Ant Design
 * @index_tags profile,personal-homepage,articles,release-evidence,public
 * @author holic512
 */
import type { Metadata } from 'next'
import Link from 'next/link'
import { notFound } from 'next/navigation'

import { PublicNavbar } from '@/components/shell/public-navbar'
import { createPageMetadata } from '@/i18n/metadata'
import { getPublicUserProfile } from '@/server/services/public-users'
import publicStyles from '@/styles/modules/public.module.css'

export const dynamic = 'force-dynamic'

export async function generateMetadata({
  params,
}: {
  params: Promise<{ username: string }>
}): Promise<Metadata> {
  const { username } = await params
  const profile = await getPublicUserProfile(username)
  return profile
    ? {
      ...(await createPageMetadata('userProfile', {
        username: profile.user.displayName || profile.user.username,
      })),
      description: profile.user.bio || undefined,
    }
    : createPageMetadata('userNotFound')
}

export default async function PublicUserPage({
  params,
}: {
  params: Promise<{ username: string }>
}) {
  const { username } = await params
  const profile = await getPublicUserProfile(username)
  if (!profile) notFound()

  return (
    <div className={`${publicStyles.root} public-page profile-page`}>
      <PublicNavbar />
      <main className="profile-main content-container">
        <section className="profile-hero">
          <div className="profile-avatar">
            {profile.user.avatar ? (
              // eslint-disable-next-line @next/next/no-img-element
              <img src={profile.user.avatar} alt="" />
            ) : (
              (profile.user.displayName || profile.user.username).charAt(0).toUpperCase()
            )}
          </div>
          <div>
            <span className="profile-kicker">@{profile.user.username}</span>
            <h1>{profile.user.displayName || profile.user.username}</h1>
            <p>{profile.user.bio || '这个人还没有写个人简介。'}</p>
            <small>加入于 {new Date(profile.user.createdAt).toLocaleDateString()}</small>
          </div>
        </section>

        <section className="profile-archive">
          <div className="profile-section-heading">
            <div>
              <span className="profile-kicker">Published</span>
              <h2>公开文章</h2>
            </div>
            <span>{profile.articles.length} 篇</span>
          </div>

          {profile.articles.length ? (
            <div className="profile-article-list">
              {profile.articles.map((article, index) => (
                <Link key={article.id} href={article.href} className="profile-article-link">
                  <article className="profile-article-card">
                    <span className="profile-article-index">{String(index + 1).padStart(2, '0')}</span>
                    <div>
                      <h3>{article.title}</h3>
                      <p>{article.project} / {article.version} / {article.category}</p>
                    </div>
                    <div className="profile-article-proof">
                      {article.hasEvidence ? <span title="版本已存证">✓</span> : null}
                      <span aria-hidden>↗</span>
                    </div>
                  </article>
                </Link>
              ))}
            </div>
          ) : (
            <p className="profile-empty">暂无公开文章</p>
          )}
        </section>
      </main>
    </div>
  )
}
