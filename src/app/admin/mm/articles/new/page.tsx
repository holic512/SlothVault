import { ArticleEditor } from '@/components/admin/article-editor'
import { createPageMetadata } from '@/i18n/metadata'

export async function generateMetadata() {
  return createPageMetadata('adminArticleEdit')
}

export default function NewArticlePage() {
  return <ArticleEditor />
}
