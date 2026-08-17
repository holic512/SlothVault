import { CategoriesManager } from '@/components/admin/categories-manager'
import { createPageMetadata } from '@/i18n/metadata'

export async function generateMetadata() {
  return createPageMetadata('adminCategories')
}

export default function CategoriesPage() {
  return <CategoriesManager />
}
