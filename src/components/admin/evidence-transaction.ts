/**
 * @file evidence-transaction.ts
 * @project SlothVault
 * @module Legacy Evidence Transaction Export
 * @description Preserves the previous evidence-signing import while the reusable wallet boundary owns its implementation.
 * @logic Re-export the generic prepared-transaction signer so existing imports remain compatible during the wallet boundary migration.
 * @dependencies solana-transaction
 * @index_tags evidence,solana,wallet,transaction,compatibility
 * @author holic512
 */
export { signPreparedSolanaTransaction as signEvidenceTransaction } from '@/components/wallet/solana-transaction'
