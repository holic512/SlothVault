-- CreateTable
CREATE TABLE "commission_invitation" (
    "id" INTEGER NOT NULL PRIMARY KEY AUTOINCREMENT,
    "commission_id" INTEGER NOT NULL,
    "token_hash" TEXT NOT NULL,
    "expires_at" DATETIME NOT NULL,
    "revoked_at" DATETIME,
    "claimed_at" DATETIME,
    "claimed_by_id" INTEGER,
    "created_at" DATETIME NOT NULL DEFAULT CURRENT_TIMESTAMP,
    CONSTRAINT "commission_invitation_commission_id_fkey" FOREIGN KEY ("commission_id") REFERENCES "commission" ("id") ON DELETE RESTRICT ON UPDATE NO ACTION
);

-- CreateTable
CREATE TABLE "commission_agreement" (
    "id" INTEGER NOT NULL PRIMARY KEY AUTOINCREMENT,
    "public_id" TEXT NOT NULL,
    "commission_id" INTEGER NOT NULL,
    "kind" TEXT NOT NULL DEFAULT 'AGREEMENT',
    "status" TEXT NOT NULL DEFAULT 'DRAFT',
    "title" TEXT NOT NULL,
    "body" TEXT NOT NULL,
    "template_json" TEXT NOT NULL,
    "values_json" TEXT NOT NULL,
    "file_keys_json" TEXT NOT NULL DEFAULT '[]',
    "total_fen" BIGINT,
    "maintenance_days" INTEGER NOT NULL DEFAULT 15,
    "confirmation_mode" TEXT NOT NULL DEFAULT 'ONLINE',
    "published_event_id" TEXT,
    "confirmed_at" DATETIME,
    "created_at" DATETIME NOT NULL DEFAULT CURRENT_TIMESTAMP,
    CONSTRAINT "commission_agreement_commission_id_fkey" FOREIGN KEY ("commission_id") REFERENCES "commission" ("id") ON DELETE RESTRICT ON UPDATE NO ACTION
);

-- CreateTable
CREATE TABLE "commission_submission" (
    "id" INTEGER NOT NULL PRIMARY KEY AUTOINCREMENT,
    "public_id" TEXT NOT NULL,
    "commission_id" INTEGER NOT NULL,
    "sequence" INTEGER NOT NULL,
    "command_id" TEXT NOT NULL,
    "request_hash" TEXT NOT NULL,
    "actor_user_id" INTEGER,
    "type" TEXT NOT NULL,
    "snapshot_json" TEXT NOT NULL,
    "snapshot_hash" TEXT NOT NULL,
    "previous_hash" TEXT,
    "proof_revision" INTEGER NOT NULL DEFAULT 0,
    "created_at" DATETIME NOT NULL DEFAULT CURRENT_TIMESTAMP,
    CONSTRAINT "commission_submission_commission_id_fkey" FOREIGN KEY ("commission_id") REFERENCES "commission" ("id") ON DELETE RESTRICT ON UPDATE NO ACTION
);

-- CreateTable
CREATE TABLE "commission_proof_attempt" (
    "id" INTEGER NOT NULL PRIMARY KEY AUTOINCREMENT,
    "submission_id" INTEGER NOT NULL,
    "network" TEXT NOT NULL,
    "issuer_user_id" INTEGER NOT NULL,
    "signer_address" TEXT NOT NULL,
    "status" TEXT NOT NULL DEFAULT 'PREPARED',
    "memo" TEXT NOT NULL,
    "message_hash" TEXT NOT NULL,
    "transaction_base64" TEXT NOT NULL,
    "last_valid_block_height" BIGINT NOT NULL,
    "expires_at" DATETIME NOT NULL,
    "transaction_signature" TEXT,
    "slot" BIGINT,
    "block_time" DATETIME,
    "fee_lamports" BIGINT,
    "error" TEXT,
    "created_at" DATETIME NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "finalized_at" DATETIME,
    CONSTRAINT "commission_proof_attempt_submission_id_fkey" FOREIGN KEY ("submission_id") REFERENCES "commission_submission" ("id") ON DELETE RESTRICT ON UPDATE NO ACTION
);

-- RedefineTables
PRAGMA defer_foreign_keys=ON;
PRAGMA foreign_keys=OFF;
CREATE TABLE "new_commission_contract_template_version" (
    "format" TEXT NOT NULL DEFAULT 'LEGACY',
    "id" INTEGER NOT NULL PRIMARY KEY AUTOINCREMENT,
    "template_id" INTEGER NOT NULL,
    "version" INTEGER NOT NULL,
    "status" TEXT NOT NULL DEFAULT 'DRAFT',
    "documents_json" TEXT NOT NULL,
    "fields_json" TEXT NOT NULL,
    "defaults_json" TEXT NOT NULL,
    "created_at" DATETIME NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "published_at" DATETIME,
    CONSTRAINT "commission_contract_template_version_template_id_fkey" FOREIGN KEY ("template_id") REFERENCES "commission_contract_template" ("id") ON DELETE RESTRICT ON UPDATE NO ACTION
);
INSERT INTO "new_commission_contract_template_version" ("created_at", "defaults_json", "documents_json", "fields_json", "id", "published_at", "status", "template_id", "version") SELECT "created_at", "defaults_json", "documents_json", "fields_json", "id", "published_at", "status", "template_id", "version" FROM "commission_contract_template_version";
DROP TABLE "commission_contract_template_version";
ALTER TABLE "new_commission_contract_template_version" RENAME TO "commission_contract_template_version";
CREATE UNIQUE INDEX "uq_commission_template_version" ON "commission_contract_template_version"("template_id", "version");
CREATE TABLE "new_commission" (
    "id" INTEGER NOT NULL PRIMARY KEY AUTOINCREMENT,
    "commission_id" TEXT NOT NULL,
    "subject_user_id" INTEGER,
    "title" TEXT NOT NULL,
    "purpose" TEXT NOT NULL,
    "requirements" TEXT NOT NULL,
    "party_a_json" TEXT NOT NULL DEFAULT '{}',
    "party_b_json" TEXT NOT NULL DEFAULT '{}',
    "quotation_fen" BIGINT,
    "agreement_fen" BIGINT,
    "stage" TEXT NOT NULL DEFAULT 'ASSESSMENT',
    "progress" INTEGER NOT NULL DEFAULT 0,
    "progress_note" TEXT NOT NULL DEFAULT '',
    "revision" INTEGER NOT NULL DEFAULT 0,
    "expected_delivery_at" DATETIME,
    "started_at" DATETIME,
    "accepted_at" DATETIME,
    "adjustment_days" INTEGER NOT NULL DEFAULT 15,
    "maintenance_days" INTEGER NOT NULL DEFAULT 30,
    "settlement_json" TEXT NOT NULL DEFAULT '{}',
    "created_at" DATETIME NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "updated_at" DATETIME NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "workflow_version" INTEGER NOT NULL DEFAULT 1,
    "paused" BOOLEAN NOT NULL DEFAULT false,
    "payment_percent" INTEGER NOT NULL DEFAULT 0,
    "confirmation_mode" TEXT NOT NULL DEFAULT 'ONLINE',
    "maintenance_started_at" DATETIME,
    "maintenance_ends_at" DATETIME,
    "maintenance_closed_at" DATETIME,
    "maintenance_close_reason" TEXT NOT NULL DEFAULT '',
    CONSTRAINT "commission_subject_user_id_fkey" FOREIGN KEY ("subject_user_id") REFERENCES "auth_user" ("id") ON DELETE RESTRICT ON UPDATE NO ACTION
);
INSERT INTO "new_commission" ("accepted_at", "adjustment_days", "agreement_fen", "commission_id", "created_at", "expected_delivery_at", "id", "maintenance_days", "party_a_json", "party_b_json", "progress", "progress_note", "purpose", "quotation_fen", "requirements", "revision", "settlement_json", "stage", "started_at", "subject_user_id", "title", "updated_at") SELECT "accepted_at", "adjustment_days", "agreement_fen", "commission_id", "created_at", "expected_delivery_at", "id", "maintenance_days", "party_a_json", "party_b_json", "progress", "progress_note", "purpose", "quotation_fen", "requirements", "revision", "settlement_json", "stage", "started_at", "subject_user_id", "title", "updated_at" FROM "commission";
DROP TABLE "commission";
ALTER TABLE "new_commission" RENAME TO "commission";
CREATE UNIQUE INDEX "uq_commission_identity" ON "commission"("commission_id");
CREATE INDEX "idx_commission_subject_stage" ON "commission"("subject_user_id", "stage");
PRAGMA foreign_keys=ON;
PRAGMA defer_foreign_keys=OFF;

-- CreateIndex
CREATE UNIQUE INDEX "uq_commission_invitation_token" ON "commission_invitation"("token_hash");

-- CreateIndex
CREATE INDEX "idx_commission_invitation_owner" ON "commission_invitation"("commission_id");

-- CreateIndex
CREATE UNIQUE INDEX "uq_commission_agreement_public" ON "commission_agreement"("public_id");

-- CreateIndex
CREATE INDEX "idx_commission_agreement_owner_status" ON "commission_agreement"("commission_id", "status");

-- CreateIndex
CREATE UNIQUE INDEX "uq_commission_submission_public" ON "commission_submission"("public_id");

-- CreateIndex
CREATE UNIQUE INDEX "uq_commission_submission_sequence" ON "commission_submission"("commission_id", "sequence");

-- CreateIndex
CREATE UNIQUE INDEX "uq_commission_submission_command" ON "commission_submission"("commission_id", "command_id");

-- CreateIndex
CREATE UNIQUE INDEX "uq_commission_proof_signature" ON "commission_proof_attempt"("transaction_signature");

-- CreateIndex
CREATE INDEX "idx_commission_proof_submission_network" ON "commission_proof_attempt"("submission_id", "network");

-- CreateIndex
CREATE INDEX "idx_commission_proof_status" ON "commission_proof_attempt"("status");
