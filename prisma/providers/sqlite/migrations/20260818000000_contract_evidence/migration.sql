-- Add one-to-one Web2 contract snapshots and their independent Solana evidence lifecycle.
CREATE TABLE "contract" (
    "id" INTEGER NOT NULL PRIMARY KEY AUTOINCREMENT,
    "contract_id" TEXT NOT NULL,
    "installation_id" TEXT,
    "issuer_user_id" INTEGER NOT NULL,
    "subject_user_id" INTEGER NOT NULL,
    "title" TEXT NOT NULL,
    "body" TEXT NOT NULL,
    "body_hash" TEXT NOT NULL,
    "contract_hash" TEXT,
    "attachment_file_id" INTEGER,
    "attachment_hash" TEXT,
    "party_commitment" TEXT NOT NULL,
    "status" INTEGER NOT NULL DEFAULT 0,
    "issued_at" DATETIME,
    "signed_at" DATETIME,
    "signed_session_id" TEXT,
    "signed_ip" TEXT,
    "signed_user_agent" TEXT,
    "declined_at" DATETIME,
    "decline_reason" TEXT,
    "cancelled_at" DATETIME,
    "created_at" DATETIME NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "updated_at" DATETIME NOT NULL DEFAULT CURRENT_TIMESTAMP,
    CONSTRAINT "contract_issuer_user_id_fkey" FOREIGN KEY ("issuer_user_id") REFERENCES "auth_user" ("id") ON DELETE RESTRICT ON UPDATE NO ACTION,
    CONSTRAINT "contract_subject_user_id_fkey" FOREIGN KEY ("subject_user_id") REFERENCES "auth_user" ("id") ON DELETE RESTRICT ON UPDATE NO ACTION,
    CONSTRAINT "contract_attachment_file_id_fkey" FOREIGN KEY ("attachment_file_id") REFERENCES "files_file_management" ("id") ON DELETE RESTRICT ON UPDATE NO ACTION
);

CREATE TABLE "contract_credential" (
    "id" INTEGER NOT NULL PRIMARY KEY AUTOINCREMENT,
    "contract_id" INTEGER NOT NULL,
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
    CONSTRAINT "contract_credential_contract_id_fkey" FOREIGN KEY ("contract_id") REFERENCES "contract" ("id") ON DELETE CASCADE ON UPDATE NO ACTION,
    CONSTRAINT "contract_credential_issuer_user_id_fkey" FOREIGN KEY ("issuer_user_id") REFERENCES "auth_user" ("id") ON DELETE RESTRICT ON UPDATE NO ACTION
);

CREATE TABLE "contract_credential_attempt" (
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
    CONSTRAINT "contract_credential_attempt_credential_id_fkey" FOREIGN KEY ("credential_id") REFERENCES "contract_credential" ("id") ON DELETE CASCADE ON UPDATE NO ACTION,
    CONSTRAINT "contract_credential_attempt_issuer_user_id_fkey" FOREIGN KEY ("issuer_user_id") REFERENCES "auth_user" ("id") ON DELETE RESTRICT ON UPDATE NO ACTION
);

CREATE UNIQUE INDEX "uq_contract_contract_id" ON "contract"("contract_id");
CREATE UNIQUE INDEX "uq_contract_attachment_file_id" ON "contract"("attachment_file_id");
CREATE INDEX "idx_contract_subject_status" ON "contract"("subject_user_id", "status");
CREATE INDEX "idx_contract_issuer_created" ON "contract"("issuer_user_id", "created_at");
CREATE UNIQUE INDEX "uq_contract_credential_transaction_signature" ON "contract_credential"("transaction_signature");
CREATE UNIQUE INDEX "uq_contract_credential_contract_network" ON "contract_credential"("contract_id", "network");
CREATE INDEX "idx_contract_credential_network_status" ON "contract_credential"("network", "status");
CREATE INDEX "idx_contract_credential_signer" ON "contract_credential"("signer_address");
CREATE INDEX "idx_contract_credential_attempt_status" ON "contract_credential_attempt"("credential_id", "status");
CREATE INDEX "idx_contract_credential_attempt_signature" ON "contract_credential_attempt"("transaction_signature");

CREATE TABLE "contract_admin_audit" (
    "id" INTEGER NOT NULL PRIMARY KEY AUTOINCREMENT,
    "contract_id" INTEGER NOT NULL,
    "actor_user_id" INTEGER NOT NULL,
    "action" TEXT NOT NULL,
    "created_at" DATETIME NOT NULL DEFAULT CURRENT_TIMESTAMP,
    CONSTRAINT "contract_admin_audit_contract_id_fkey" FOREIGN KEY ("contract_id") REFERENCES "contract" ("id") ON DELETE CASCADE ON UPDATE NO ACTION,
    CONSTRAINT "contract_admin_audit_actor_user_id_fkey" FOREIGN KEY ("actor_user_id") REFERENCES "auth_user" ("id") ON DELETE RESTRICT ON UPDATE NO ACTION
);

CREATE INDEX "idx_contract_admin_audit_contract_created" ON "contract_admin_audit"("contract_id", "created_at");
CREATE INDEX "idx_contract_admin_audit_actor_created" ON "contract_admin_audit"("actor_user_id", "created_at");
