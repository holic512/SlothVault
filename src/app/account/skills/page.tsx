/**
 * @file page.tsx
 * @project SlothVault
 * @module Account Knowledge Package Skill Route
 * @description Renders the signed-in user's source-grounded knowledge-package Skill guide.
 * @logic Reuse the account authorization boundary and mount the client-side Skill workflow without exposing any model credentials or source-upload capability.
 * @dependencies AccountKnowledgeSkillView, localized page metadata, account layout
 * @index_tags account, skill, knowledge-package, route, import
 * @author holic512
 */
import { AccountKnowledgeSkillView } from '@/components/account/account-knowledge-skill-view'
import { createPageMetadata } from '@/i18n/metadata'

export async function generateMetadata() {
  return createPageMetadata('accountKnowledgeSkill')
}

export default function AccountKnowledgeSkillPage() {
  return <AccountKnowledgeSkillView />
}
