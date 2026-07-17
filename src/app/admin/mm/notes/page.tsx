import type { Metadata } from 'next'

import { NotesManager } from '@/components/admin/notes-manager'

export const metadata: Metadata = { title: 'Note Management' }

export default function NotesPage() {
  return <NotesManager />
}
