import { KnowledgeImportManager } from '@/components/admin/knowledge-import-manager'
import { createPageMetadata } from '@/i18n/metadata'

export async function generateMetadata() {
  return createPageMetadata('adminProjects')
}

export default function KnowledgeImportPage() {
  return <KnowledgeImportManager />
}
