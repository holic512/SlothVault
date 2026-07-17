-- Persist enough transaction context to reconcile a cNFT attempt after the
-- browser session expires or the submit request disconnects.
ALTER TABLE "public"."compressed_nft"
ADD COLUMN "prepare_expires_at" TIMESTAMPTZ(6),
ADD COLUMN "last_valid_block_height" BIGINT;

-- A Solana transaction signature identifies exactly one signed transaction.
CREATE UNIQUE INDEX "compressed_nft_mint_tx_signature_key"
ON "public"."compressed_nft"("mint_tx_signature");
