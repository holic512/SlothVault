import { redirect } from 'next/navigation'

export default function AdminEntryPage() {
  redirect('/admin/auth/login')
}
