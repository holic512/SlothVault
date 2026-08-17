import { HomepageEditor } from '@/components/admin/homepage-editor'
import { createPageMetadata } from '@/i18n/metadata'

export async function generateMetadata() {
  return createPageMetadata('adminHomepage')
}

export default function HomepagePage() {
  return <HomepageEditor />
}
