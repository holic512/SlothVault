/**
 * @file page.tsx
 * @project SlothVault
 * @module Commission Workflow Route
 * @description Connects the commission workflow page or authenticated API boundary.
 * @logic Validate route inputs and delegate to the role-aware workflow service or shared page.
 * @dependencies Next.js, commission workflow modules
 * @index_tags commissions,workflow,access
 * @author holic512
 */
import { ContractTemplateManager } from '@/components/commissions/template-manager'
export const metadata = { title: '编辑合同模板' }
export default async function Page({ params }: { params: Promise<{ id: string }> }) { const { id } = await params; return <ContractTemplateManager key={id} id={id} /> }
