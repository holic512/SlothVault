/**
 * @file metadata.ts
 * @project SlothVault
 * @module Localized Page Metadata
 * @description Centralizes localized browser-title generation for App Router pages.
 * @logic Resolve one PageTitles message on the server and return it in the Next.js metadata shape, with optional interpolation values for dynamic routes.
 * @dependencies next-intl/server, next metadata API, messages/PageTitles
 * @index_tags i18n,metadata,page-title,seo,nextjs
 * @author holic512
 */
import type { Metadata } from 'next'
import type { TranslationValues } from 'next-intl'
import { getTranslations } from 'next-intl/server'

export type PageTitleKey =
  | 'account'
  | 'accountPoints'
  | 'accountProfile'
  | 'accountSecurity'
  | 'adminBackup'
  | 'adminCategories'
  | 'adminDashboard'
  | 'adminEvidence'
  | 'adminFiles'
  | 'adminGiftCards'
  | 'adminHomepage'
  | 'adminInit'
  | 'adminLogin'
  | 'adminNoteContent'
  | 'adminNotes'
  | 'adminProjectHome'
  | 'adminProjects'
  | 'adminSettings'
  | 'adminSolana'
  | 'adminUsers'
  | 'evidenceReceipt'
  | 'home'
  | 'install'
  | 'login'
  | 'maintenance'
  | 'projectDocs'
  | 'projectHome'
  | 'projectNote'
  | 'projects'
  | 'register'
  | 'userProfile'
  | 'userNotFound'

export async function createPageMetadata(
  titleKey: PageTitleKey,
  values?: TranslationValues,
): Promise<Metadata> {
  const t = await getTranslations('PageTitles')
  return { title: t(titleKey, values) }
}
