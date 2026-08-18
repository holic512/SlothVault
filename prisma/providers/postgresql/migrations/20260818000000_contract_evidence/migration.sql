-- Add one-to-one Web2 contract snapshots and their independent Solana evidence lifecycle.
CREATE TABLE "contract" (
    "id" SERIAL NOT NULL,
    "contract_id" UUID NOT NULL,
    "installation_id" UUID,
    "issuer_user_id" INTEGER NOT NULL,
    "subject_user_id" INTEGER NOT NULL,
    "title" VARCHAR(255) NOT NULL,
    "body" TEXT NOT NULL,
    "body_hash" CHAR(64) NOT NULL,
    "contract_hash" CHAR(64),
    "attachment_file_id" INTEGER,
    "attachment_hash" CHAR(64),
    "party_commitment" CHAR(64) NOT NULL,
    "status" SMALLINT NOT NULL DEFAULT 0,
    "issued_at" TIMESTAMPTZ(3),
    "signed_at" TIMESTAMPTZ(3),
    "signed_session_id" UUID,
    "signed_ip" VARCHAR(255),
    "signed_user_agent" TEXT,
    "declined_at" TIMESTAMPTZ(3),
    "decline_reason" VARCHAR(500),
    "cancelled_at" TIMESTAMPTZ(3),
    "created_at" TIMESTAMPTZ(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "updated_at" TIMESTAMPTZ(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    CONSTRAINT "contract_pkey" PRIMARY KEY ("id")
);

CREATE TABLE "contract_credential" (
    "id" SERIAL NOT NULL,
    "contract_id" INTEGER NOT NULL,
    "issuer_user_id" INTEGER NOT NULL,
    "network" VARCHAR(20) NOT NULL,
    "signer_address" VARCHAR(64) NOT NULL,
    "memo" TEXT NOT NULL,
    "transaction_signature" VARCHAR(128),
    "status" SMALLINT NOT NULL DEFAULT 0,
    "slot" BIGINT,
    "block_time" TIMESTAMPTZ(3),
    "fee_lamports" BIGINT,
    "finalized_at" TIMESTAMPTZ(3),
    "last_verified_at" TIMESTAMPTZ(3),
    "created_at" TIMESTAMPTZ(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "updated_at" TIMESTAMPTZ(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    CONSTRAINT "contract_credential_pkey" PRIMARY KEY ("id")
);

CREATE TABLE "contract_credential_attempt" (
    "id" SERIAL NOT NULL,
    "credential_id" INTEGER NOT NULL,
    "issuer_user_id" INTEGER NOT NULL,
    "signer_address" VARCHAR(64) NOT NULL,
    "memo" TEXT NOT NULL,
    "message_hash" CHAR(64) NOT NULL,
    "recent_blockhash" VARCHAR(100) NOT NULL,
    "last_valid_block_height" BIGINT NOT NULL,
    "transaction_signature" VARCHAR(128),
    "status" SMALLINT NOT NULL DEFAULT 0,
    "failure_code" VARCHAR(64),
    "failure_message" VARCHAR(500),
    "expires_at" TIMESTAMPTZ(3) NOT NULL,
    "submitted_at" TIMESTAMPTZ(3),
    "finalized_at" TIMESTAMPTZ(3),
    "created_at" TIMESTAMPTZ(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "updated_at" TIMESTAMPTZ(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    CONSTRAINT "contract_credential_attempt_pkey" PRIMARY KEY ("id")
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

ALTER TABLE "contract" ADD CONSTRAINT "contract_issuer_user_id_fkey" FOREIGN KEY ("issuer_user_id") REFERENCES "auth_user"("id") ON DELETE RESTRICT ON UPDATE NO ACTION;
ALTER TABLE "contract" ADD CONSTRAINT "contract_subject_user_id_fkey" FOREIGN KEY ("subject_user_id") REFERENCES "auth_user"("id") ON DELETE RESTRICT ON UPDATE NO ACTION;
ALTER TABLE "contract" ADD CONSTRAINT "contract_attachment_file_id_fkey" FOREIGN KEY ("attachment_file_id") REFERENCES "files_file_management"("id") ON DELETE RESTRICT ON UPDATE NO ACTION;
ALTER TABLE "contract_credential" ADD CONSTRAINT "contract_credential_contract_id_fkey" FOREIGN KEY ("contract_id") REFERENCES "contract"("id") ON DELETE CASCADE ON UPDATE NO ACTION;
ALTER TABLE "contract_credential" ADD CONSTRAINT "contract_credential_issuer_user_id_fkey" FOREIGN KEY ("issuer_user_id") REFERENCES "auth_user"("id") ON DELETE RESTRICT ON UPDATE NO ACTION;
ALTER TABLE "contract_credential_attempt" ADD CONSTRAINT "contract_credential_attempt_credential_id_fkey" FOREIGN KEY ("credential_id") REFERENCES "contract_credential"("id") ON DELETE CASCADE ON UPDATE NO ACTION;
ALTER TABLE "contract_credential_attempt" ADD CONSTRAINT "contract_credential_attempt_issuer_user_id_fkey" FOREIGN KEY ("issuer_user_id") REFERENCES "auth_user"("id") ON DELETE RESTRICT ON UPDATE NO ACTION;

CREATE TABLE "contract_admin_audit" (
    "id" SERIAL NOT NULL,
    "contract_id" INTEGER NOT NULL,
    "actor_user_id" INTEGER NOT NULL,
    "action" VARCHAR(64) NOT NULL,
    "created_at" TIMESTAMPTZ(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    CONSTRAINT "contract_admin_audit_pkey" PRIMARY KEY ("id")
);

CREATE INDEX "idx_contract_admin_audit_contract_created" ON "contract_admin_audit"("contract_id", "created_at");
CREATE INDEX "idx_contract_admin_audit_actor_created" ON "contract_admin_audit"("actor_user_id", "created_at");
ALTER TABLE "contract_admin_audit" ADD CONSTRAINT "contract_admin_audit_contract_id_fkey" FOREIGN KEY ("contract_id") REFERENCES "contract"("id") ON DELETE CASCADE ON UPDATE NO ACTION;
ALTER TABLE "contract_admin_audit" ADD CONSTRAINT "contract_admin_audit_actor_user_id_fkey" FOREIGN KEY ("actor_user_id") REFERENCES "auth_user"("id") ON DELETE RESTRICT ON UPDATE NO ACTION;
