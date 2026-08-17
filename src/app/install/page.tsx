/**
 * @file page.tsx
 * @project SlothVault
 * @module First-run Installation Route
 * @description Exposes the database and administrator installation wizard for an unconfigured deployment.
 * @logic Render the client-side installer, which resumes from the server-reported installation state.
 * @dependencies Next.js metadata, install-wizard
 * @index_tags install,first-run,database,administrator
 * @author holic512
 */
import { InstallWizard } from '@/components/install/install-wizard'
import { createPageMetadata } from '@/i18n/metadata'

export async function generateMetadata() {
  return {
    ...(await createPageMetadata('install')),
    description: 'Configure the database and first administrator for SlothVault.',
  }
}

export default function InstallPage() {
  return <InstallWizard />
}
