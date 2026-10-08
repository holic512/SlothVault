/**
 * @file page.tsx
 * @project SlothVault
 * @module Contract Template Route
 * @description Opens versioned contract templates and commission presets.
 * @logic Keep template publication inside the administrator boundary.
 * @dependencies ContractTemplateManager, protected layout
 * @index_tags templates,admin,route
 * @author holic512
 */
import { ContractTemplateManager } from '@/components/commissions/template-manager'
import { createPageMetadata } from '@/i18n/metadata'
export async function generateMetadata() { return createPageMetadata('adminContractTemplates') }
export default function Page() { return <ContractTemplateManager /> }
