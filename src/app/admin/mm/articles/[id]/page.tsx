import { ArticleEditor } from '@/components/admin/article-editor'
import { createPageMetadata } from '@/i18n/metadata'

export async function generateMetadata() {
  return createPageMetadata('adminArticleEdit')
}

export default async function EditArticlePage({
  params,
}: {
  params: Promise<{ id: string }>
}) {
  const { id } = await params
  return <ArticleEditor key={id} articleId={id} />
}
