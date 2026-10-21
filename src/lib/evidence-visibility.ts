/**
 * @file evidence-visibility.ts
 * @project SlothVault
 * @module Evidence Visibility Policy
 * @description Separates public Mainnet receipts from administrator-only test evidence.
 * @logic Apply the audience selected by trusted server entrypoints, independently of issuance settings or viewer roles.
 * @dependencies None
 * @index_tags evidence,permissions,mainnet,devnet
 * @author holic512
 */
export type EvidenceAudience = 'public' | 'admin'

export function evidenceNetworks(audience: EvidenceAudience): Array<'mainnet' | 'devnet'> {
  return audience === 'admin' ? ['mainnet', 'devnet'] : ['mainnet']
}

export function evidenceVisible(network: string, audience: EvidenceAudience) {
  return evidenceNetworks(audience).some(value => value === network)
}
