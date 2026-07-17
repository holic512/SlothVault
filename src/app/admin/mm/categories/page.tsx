import type { Metadata } from 'next'

import { CategoriesManager } from '@/components/admin/categories-manager'

export const metadata: Metadata = { title: 'Category Management' }

export default function CategoriesPage() {
  return <CategoriesManager />
}
