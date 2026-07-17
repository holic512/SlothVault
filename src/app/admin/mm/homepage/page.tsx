import type { Metadata } from 'next'

import { HomepageEditor } from '@/components/admin/homepage-editor'

export const metadata: Metadata = { title: 'Homepage Management' }

export default function HomepagePage() {
  return <HomepageEditor />
}
