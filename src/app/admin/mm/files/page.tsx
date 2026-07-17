import type { Metadata } from 'next'

import { FilesManager } from '@/components/admin/files-manager'

export const metadata: Metadata = { title: 'File Management' }

export default function FilesPage() {
  return <FilesManager />
}
