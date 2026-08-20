import { ArticlesManager } from '@/components/admin/articles-manager'
import { createPageMetadata } from '@/i18n/metadata'

export async function generateMetadata() {
  return createPageMetadata('adminArticles')
}

export default function AdminArticlesPage() {
  return <ArticlesManager />
}
