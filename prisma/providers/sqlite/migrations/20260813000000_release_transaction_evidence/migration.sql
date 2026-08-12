-- Replace article cNFT storage with project-version transaction evidence.
DROP TABLE IF EXISTS "solana_compressed_nft";
DROP TABLE IF EXISTS "solana_merkle_tree";
DROP TABLE IF EXISTS "system_runtime_lock";
DELETE FROM "system_config" WHERE "config_key" IN ('solana_network', 'SOLANA_RPC_URL', 'SOLANA_DEVNET_RPC_URL', 'FILEBASE_ACCESS_KEY', 'FILEBASE_SECRET_KEY', 'FILEBASE_BUCKET', 'FILEBASE_ENDPOINT');

CREATE TABLE "release_credential" (
    "id" INTEGER NOT NULL PRIMARY KEY AUTOINCREMENT,
    "project_version_id" INTEGER NOT NULL,
    "issuer_user_id" INTEGER NOT NULL,
    "network" TEXT NOT NULL,
    "signer_address" TEXT NOT NULL,
    "memo" TEXT NOT NULL,
    "transaction_signature" TEXT,
    "status" INTEGER NOT NULL DEFAULT 0,
    "slot" BIGINT,
    "block_time" DATETIME,
    "fee_lamports" BIGINT,
    "finalized_at" DATETIME,
    "last_verified_at" DATETIME,
    "created_at" DATETIME NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "updated_at" DATETIME NOT NULL DEFAULT CURRENT_TIMESTAMP,
    CONSTRAINT "release_credential_project_version_id_fkey" FOREIGN KEY ("project_version_id") REFERENCES "collections_project_version" ("id") ON DELETE CASCADE ON UPDATE NO ACTION,
    CONSTRAINT "release_credential_issuer_user_id_fkey" FOREIGN KEY ("issuer_user_id") REFERENCES "auth_user" ("id") ON DELETE RESTRICT ON UPDATE NO ACTION
);

CREATE TABLE "release_credential_attempt" (
    "id" INTEGER NOT NULL PRIMARY KEY AUTOINCREMENT,
    "credential_id" INTEGER NOT NULL,
    "issuer_user_id" INTEGER NOT NULL,
    "signer_address" TEXT NOT NULL,
    "memo" TEXT NOT NULL,
    "message_hash" TEXT NOT NULL,
    "recent_blockhash" TEXT NOT NULL,
    "last_valid_block_height" BIGINT NOT NULL,
    "transaction_signature" TEXT,
    "status" INTEGER NOT NULL DEFAULT 0,
    "failure_code" TEXT,
    "failure_message" TEXT,
    "expires_at" DATETIME NOT NULL,
    "submitted_at" DATETIME,
    "finalized_at" DATETIME,
    "created_at" DATETIME NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "updated_at" DATETIME NOT NULL DEFAULT CURRENT_TIMESTAMP,
    CONSTRAINT "release_credential_attempt_credential_id_fkey" FOREIGN KEY ("credential_id") REFERENCES "release_credential" ("id") ON DELETE CASCADE ON UPDATE NO ACTION,
    CONSTRAINT "release_credential_attempt_issuer_user_id_fkey" FOREIGN KEY ("issuer_user_id") REFERENCES "auth_user" ("id") ON DELETE RESTRICT ON UPDATE NO ACTION
);

CREATE UNIQUE INDEX "uq_release_credential_transaction_signature" ON "release_credential"("transaction_signature");
CREATE UNIQUE INDEX "uq_release_credential_version_network" ON "release_credential"("project_version_id", "network");
CREATE INDEX "idx_release_credential_network_status" ON "release_credential"("network", "status");
CREATE INDEX "idx_release_credential_signer" ON "release_credential"("signer_address");
CREATE INDEX "idx_release_credential_attempt_status" ON "release_credential_attempt"("credential_id", "status");
CREATE INDEX "idx_release_credential_attempt_signature" ON "release_credential_attempt"("transaction_signature");
