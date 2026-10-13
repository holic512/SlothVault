-- Account references are attribution, not ownership. Frozen evidence bytes are retained.

PRAGMA foreign_keys=OFF;

BEGIN TRANSACTION;

-- Reject broken legacy references instead of silently erasing historical user IDs.
CREATE TEMP TABLE "_account_reference_check" ("missing_count" INTEGER NOT NULL CONSTRAINT "account_user_reference_must_exist" CHECK ("missing_count" = 0));
INSERT INTO "_account_reference_check" SELECT COUNT(*) FROM "docs_note_info" WHERE "author_id" IS NOT NULL AND "author_id" NOT IN (SELECT "id" FROM "auth_user");
INSERT INTO "_account_reference_check" SELECT COUNT(*) FROM "commission_payment" WHERE "created_by_id" IS NOT NULL AND "created_by_id" NOT IN (SELECT "id" FROM "auth_user");
INSERT INTO "_account_reference_check" SELECT COUNT(*) FROM "commission_payment" WHERE "confirmed_by_id" IS NOT NULL AND "confirmed_by_id" NOT IN (SELECT "id" FROM "auth_user");
INSERT INTO "_account_reference_check" SELECT COUNT(*) FROM "commission_change" WHERE "created_by_id" IS NOT NULL AND "created_by_id" NOT IN (SELECT "id" FROM "auth_user");
INSERT INTO "_account_reference_check" SELECT COUNT(*) FROM "commission_issue" WHERE "created_by_id" IS NOT NULL AND "created_by_id" NOT IN (SELECT "id" FROM "auth_user");
INSERT INTO "_account_reference_check" SELECT COUNT(*) FROM "commission_file" WHERE "uploader_user_id" IS NOT NULL AND "uploader_user_id" NOT IN (SELECT "id" FROM "auth_user");
INSERT INTO "_account_reference_check" SELECT COUNT(*) FROM "commission_submission" WHERE "actor_user_id" IS NOT NULL AND "actor_user_id" NOT IN (SELECT "id" FROM "auth_user");
INSERT INTO "_account_reference_check" SELECT COUNT(*) FROM "commission_proof_attempt" WHERE "issuer_user_id" IS NOT NULL AND "issuer_user_id" NOT IN (SELECT "id" FROM "auth_user");
INSERT INTO "_account_reference_check" SELECT COUNT(*) FROM "commission_invitation" WHERE "claimed_by_id" IS NOT NULL AND "claimed_by_id" NOT IN (SELECT "id" FROM "auth_user");
DROP TABLE "_account_reference_check";

CREATE TABLE "new_points_transaction" (
 "attribution_json" TEXT NOT NULL DEFAULT '{}',
    "id" INTEGER NOT NULL PRIMARY KEY AUTOINCREMENT,
    "user_id" INTEGER NOT NULL,
    "amount" INTEGER NOT NULL,
    "balance_after" INTEGER NOT NULL,
    "type" TEXT NOT NULL,
    "reference_id" TEXT,
    "description" TEXT,
    "created_at" DATETIME NOT NULL DEFAULT CURRENT_TIMESTAMP,
    CONSTRAINT "points_transaction_user_id_fkey" FOREIGN KEY ("user_id") REFERENCES "auth_user" ("id") ON DELETE CASCADE ON UPDATE NO ACTION
);

INSERT INTO "new_points_transaction" ("id", "user_id", "amount", "balance_after", "type", "reference_id", "description", "created_at") SELECT "id", "user_id", "amount", "balance_after", "type", "reference_id", "description", "created_at" FROM "points_transaction";

DROP TABLE "points_transaction";

ALTER TABLE "new_points_transaction" RENAME TO "points_transaction";

CREATE INDEX "idx_points_transaction_user_created" ON "points_transaction"("user_id", "created_at");

CREATE INDEX "idx_points_transaction_reference" ON "points_transaction"("type", "reference_id");

CREATE TABLE "new_points_gift_card_batch" (
 "attribution_json" TEXT NOT NULL DEFAULT '{}',
    "id" INTEGER NOT NULL PRIMARY KEY AUTOINCREMENT,
    "name" TEXT NOT NULL,
    "points" INTEGER NOT NULL,
    "quantity" INTEGER NOT NULL,
    "expires_at" DATETIME,
    "status" INTEGER NOT NULL DEFAULT 1,
    "created_by_id" INTEGER,
    "created_at" DATETIME NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "updated_at" DATETIME NOT NULL DEFAULT CURRENT_TIMESTAMP,
    CONSTRAINT "points_gift_card_batch_created_by_id_fkey" FOREIGN KEY ("created_by_id") REFERENCES "auth_user" ("id") ON DELETE SET NULL ON UPDATE NO ACTION
);

INSERT INTO "new_points_gift_card_batch" ("id", "name", "points", "quantity", "expires_at", "status", "created_by_id", "created_at", "updated_at") SELECT "id", "name", "points", "quantity", "expires_at", "status", "created_by_id", "created_at", "updated_at" FROM "points_gift_card_batch";

DROP TABLE "points_gift_card_batch";

ALTER TABLE "new_points_gift_card_batch" RENAME TO "points_gift_card_batch";

CREATE INDEX "idx_gift_card_batch_creator" ON "points_gift_card_batch"("created_by_id");

CREATE INDEX "idx_gift_card_batch_status_expires" ON "points_gift_card_batch"("status", "expires_at");

CREATE TABLE "new_membership_grant" (
 "attribution_json" TEXT NOT NULL DEFAULT '{}',
    "id" INTEGER NOT NULL PRIMARY KEY AUTOINCREMENT,
    "user_id" INTEGER NOT NULL,
    "membership_level_id" INTEGER NOT NULL,
    "source" TEXT NOT NULL,
    "points_cost" INTEGER,
    "granted_by_user_id" INTEGER,
    "granted_at" DATETIME NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "expires_at" DATETIME,
    "revoked_at" DATETIME,
    "revoked_by_user_id" INTEGER,
    CONSTRAINT "membership_grant_user_id_fkey" FOREIGN KEY ("user_id") REFERENCES "auth_user"("id") ON DELETE RESTRICT ON UPDATE NO ACTION,
    CONSTRAINT "membership_grant_level_id_fkey" FOREIGN KEY ("membership_level_id") REFERENCES "membership_level"("id") ON DELETE RESTRICT ON UPDATE NO ACTION,
    CONSTRAINT "membership_grant_granted_by_user_id_fkey" FOREIGN KEY ("granted_by_user_id") REFERENCES "auth_user"("id") ON DELETE SET NULL ON UPDATE NO ACTION,
    CONSTRAINT "membership_grant_revoked_by_user_id_fkey" FOREIGN KEY ("revoked_by_user_id") REFERENCES "auth_user"("id") ON DELETE SET NULL ON UPDATE NO ACTION
);

INSERT INTO "new_membership_grant" ("id", "user_id", "membership_level_id", "source", "points_cost", "granted_by_user_id", "granted_at", "expires_at", "revoked_at", "revoked_by_user_id") SELECT "id", "user_id", "membership_level_id", "source", "points_cost", "granted_by_user_id", "granted_at", "expires_at", "revoked_at", "revoked_by_user_id" FROM "membership_grant";

DROP TABLE "membership_grant";

ALTER TABLE "new_membership_grant" RENAME TO "membership_grant";

CREATE INDEX "idx_membership_grant_user_active" ON "membership_grant"("user_id", "revoked_at", "expires_at");

CREATE INDEX "idx_membership_grant_level" ON "membership_grant"("membership_level_id");

CREATE TABLE "new_docs_note_info" (
 "attribution_json" TEXT NOT NULL DEFAULT '{}',
    "id" INTEGER NOT NULL PRIMARY KEY AUTOINCREMENT,
    "category_id" INTEGER NOT NULL,
    "note_title" TEXT NOT NULL,
    "weight" INTEGER NOT NULL,
    "status" INTEGER NOT NULL,
    "content_revision" INTEGER NOT NULL DEFAULT 0,
    "created_at" DATETIME NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "updated_at" DATETIME NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "is_deleted" BOOLEAN NOT NULL DEFAULT false, "author_id" INTEGER, "deleted_at" DATETIME, "tags_json" TEXT,
    CONSTRAINT "docs_note_info_category_id_fkey" FOREIGN KEY ("category_id") REFERENCES "collections_category" ("id") ON DELETE NO ACTION ON UPDATE NO ACTION
,
 CONSTRAINT "docs_note_info_author_id_fkey" FOREIGN KEY ("author_id") REFERENCES "auth_user"("id") ON DELETE SET NULL ON UPDATE NO ACTION
);

INSERT INTO "new_docs_note_info" ("id", "category_id", "note_title", "weight", "status", "content_revision", "created_at", "updated_at", "is_deleted", "author_id", "deleted_at", "tags_json") SELECT "id", "category_id", "note_title", "weight", "status", "content_revision", "created_at", "updated_at", "is_deleted", "author_id", "deleted_at", "tags_json" FROM "docs_note_info";

DROP TABLE "docs_note_info";

ALTER TABLE "new_docs_note_info" RENAME TO "docs_note_info";

CREATE INDEX "idx_docs_note_info_category_id" ON "docs_note_info"("category_id");

CREATE INDEX "idx_docs_note_info_author_id" ON "docs_note_info"("author_id");

CREATE TABLE "new_contract" (
 "attribution_json" TEXT NOT NULL DEFAULT '{}',
    "id" INTEGER NOT NULL PRIMARY KEY AUTOINCREMENT,
    "contract_id" TEXT NOT NULL,
    "installation_id" TEXT,
    "issuer_user_id" INTEGER,
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
    "updated_at" DATETIME NOT NULL DEFAULT CURRENT_TIMESTAMP, "commission_id" INTEGER REFERENCES "commission"("id") ON DELETE RESTRICT ON UPDATE NO ACTION, "template_version_id" INTEGER REFERENCES "commission_contract_template_version"("id") ON DELETE RESTRICT ON UPDATE NO ACTION, "document_type" TEXT NOT NULL DEFAULT 'AGREEMENT', "source_record_id" INTEGER, "snapshot_hash" TEXT, "snapshot_json" TEXT, "provider_session_id" TEXT, "provider_ip" TEXT, "provider_user_agent" TEXT,
    CONSTRAINT "contract_issuer_user_id_fkey" FOREIGN KEY ("issuer_user_id") REFERENCES "auth_user" ("id") ON DELETE SET NULL ON UPDATE NO ACTION,
    CONSTRAINT "contract_subject_user_id_fkey" FOREIGN KEY ("subject_user_id") REFERENCES "auth_user" ("id") ON DELETE RESTRICT ON UPDATE NO ACTION,
    CONSTRAINT "contract_attachment_file_id_fkey" FOREIGN KEY ("attachment_file_id") REFERENCES "files_file_management" ("id") ON DELETE RESTRICT ON UPDATE NO ACTION
);

INSERT INTO "new_contract" ("id", "contract_id", "installation_id", "issuer_user_id", "subject_user_id", "title", "body", "body_hash", "contract_hash", "attachment_file_id", "attachment_hash", "party_commitment", "status", "issued_at", "signed_at", "signed_session_id", "signed_ip", "signed_user_agent", "declined_at", "decline_reason", "cancelled_at", "created_at", "updated_at", "commission_id", "template_version_id", "document_type", "source_record_id", "snapshot_hash", "snapshot_json", "provider_session_id", "provider_ip", "provider_user_agent") SELECT "id", "contract_id", "installation_id", "issuer_user_id", "subject_user_id", "title", "body", "body_hash", "contract_hash", "attachment_file_id", "attachment_hash", "party_commitment", "status", "issued_at", "signed_at", "signed_session_id", "signed_ip", "signed_user_agent", "declined_at", "decline_reason", "cancelled_at", "created_at", "updated_at", "commission_id", "template_version_id", "document_type", "source_record_id", "snapshot_hash", "snapshot_json", "provider_session_id", "provider_ip", "provider_user_agent" FROM "contract";

DROP TABLE "contract";

ALTER TABLE "new_contract" RENAME TO "contract";

CREATE UNIQUE INDEX "uq_contract_contract_id" ON "contract"("contract_id");

CREATE UNIQUE INDEX "uq_contract_attachment_file_id" ON "contract"("attachment_file_id");

CREATE INDEX "idx_contract_subject_status" ON "contract"("subject_user_id", "status");

CREATE INDEX "idx_contract_issuer_created" ON "contract"("issuer_user_id", "created_at");

CREATE INDEX "idx_contract_commission_type_status" ON "contract" ("commission_id", "document_type", "status");

CREATE TABLE "new_contract_admin_audit" (
 "attribution_json" TEXT NOT NULL DEFAULT '{}',
    "id" INTEGER NOT NULL PRIMARY KEY AUTOINCREMENT,
    "contract_id" INTEGER NOT NULL,
    "actor_user_id" INTEGER,
    "action" TEXT NOT NULL,
    "created_at" DATETIME NOT NULL DEFAULT CURRENT_TIMESTAMP,
    CONSTRAINT "contract_admin_audit_contract_id_fkey" FOREIGN KEY ("contract_id") REFERENCES "contract" ("id") ON DELETE CASCADE ON UPDATE NO ACTION,
    CONSTRAINT "contract_admin_audit_actor_user_id_fkey" FOREIGN KEY ("actor_user_id") REFERENCES "auth_user" ("id") ON DELETE SET NULL ON UPDATE NO ACTION
);

INSERT INTO "new_contract_admin_audit" ("id", "contract_id", "actor_user_id", "action", "created_at") SELECT "id", "contract_id", "actor_user_id", "action", "created_at" FROM "contract_admin_audit";

DROP TABLE "contract_admin_audit";

ALTER TABLE "new_contract_admin_audit" RENAME TO "contract_admin_audit";

CREATE INDEX "idx_contract_admin_audit_contract_created" ON "contract_admin_audit"("contract_id", "created_at");

CREATE INDEX "idx_contract_admin_audit_actor_created" ON "contract_admin_audit"("actor_user_id", "created_at");

CREATE TABLE "new_contract_credential" (
 "attribution_json" TEXT NOT NULL DEFAULT '{}',
    "id" INTEGER NOT NULL PRIMARY KEY AUTOINCREMENT,
    "contract_id" INTEGER NOT NULL,
    "issuer_user_id" INTEGER,
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
    CONSTRAINT "contract_credential_issuer_user_id_fkey" FOREIGN KEY ("issuer_user_id") REFERENCES "auth_user" ("id") ON DELETE SET NULL ON UPDATE NO ACTION
);

INSERT INTO "new_contract_credential" ("id", "contract_id", "issuer_user_id", "network", "signer_address", "memo", "transaction_signature", "status", "slot", "block_time", "fee_lamports", "finalized_at", "last_verified_at", "created_at", "updated_at") SELECT "id", "contract_id", "issuer_user_id", "network", "signer_address", "memo", "transaction_signature", "status", "slot", "block_time", "fee_lamports", "finalized_at", "last_verified_at", "created_at", "updated_at" FROM "contract_credential";

DROP TABLE "contract_credential";

ALTER TABLE "new_contract_credential" RENAME TO "contract_credential";

CREATE UNIQUE INDEX "uq_contract_credential_transaction_signature" ON "contract_credential"("transaction_signature");

CREATE UNIQUE INDEX "uq_contract_credential_contract_network" ON "contract_credential"("contract_id", "network");

CREATE INDEX "idx_contract_credential_network_status" ON "contract_credential"("network", "status");

CREATE INDEX "idx_contract_credential_signer" ON "contract_credential"("signer_address");

CREATE TABLE "new_contract_credential_attempt" (
 "attribution_json" TEXT NOT NULL DEFAULT '{}',
    "id" INTEGER NOT NULL PRIMARY KEY AUTOINCREMENT,
    "credential_id" INTEGER NOT NULL,
    "issuer_user_id" INTEGER,
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
    CONSTRAINT "contract_credential_attempt_issuer_user_id_fkey" FOREIGN KEY ("issuer_user_id") REFERENCES "auth_user" ("id") ON DELETE SET NULL ON UPDATE NO ACTION
);

INSERT INTO "new_contract_credential_attempt" ("id", "credential_id", "issuer_user_id", "signer_address", "memo", "message_hash", "recent_blockhash", "last_valid_block_height", "transaction_signature", "status", "failure_code", "failure_message", "expires_at", "submitted_at", "finalized_at", "created_at", "updated_at") SELECT "id", "credential_id", "issuer_user_id", "signer_address", "memo", "message_hash", "recent_blockhash", "last_valid_block_height", "transaction_signature", "status", "failure_code", "failure_message", "expires_at", "submitted_at", "finalized_at", "created_at", "updated_at" FROM "contract_credential_attempt";

DROP TABLE "contract_credential_attempt";

ALTER TABLE "new_contract_credential_attempt" RENAME TO "contract_credential_attempt";

CREATE INDEX "idx_contract_credential_attempt_status" ON "contract_credential_attempt"("credential_id", "status");

CREATE INDEX "idx_contract_credential_attempt_signature" ON "contract_credential_attempt"("transaction_signature");

CREATE TABLE "new_release_credential" (
 "attribution_json" TEXT NOT NULL DEFAULT '{}',
    "id" INTEGER NOT NULL PRIMARY KEY AUTOINCREMENT,
    "project_version_id" INTEGER NOT NULL,
    "issuer_user_id" INTEGER,
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
    "updated_at" DATETIME NOT NULL DEFAULT CURRENT_TIMESTAMP, "note_content_id" INTEGER REFERENCES "docs_note_content"("id") ON DELETE RESTRICT ON UPDATE NO ACTION, "subject_type" TEXT NOT NULL DEFAULT 'PROJECT_VERSION', "subject_id" TEXT NOT NULL DEFAULT '', "subject_hash" TEXT NOT NULL DEFAULT '', "subject_manifest_version" INTEGER NOT NULL DEFAULT 1,
    CONSTRAINT "release_credential_project_version_id_fkey" FOREIGN KEY ("project_version_id") REFERENCES "collections_project_version" ("id") ON DELETE CASCADE ON UPDATE NO ACTION,
    CONSTRAINT "release_credential_issuer_user_id_fkey" FOREIGN KEY ("issuer_user_id") REFERENCES "auth_user" ("id") ON DELETE SET NULL ON UPDATE NO ACTION
);

INSERT INTO "new_release_credential" ("id", "project_version_id", "issuer_user_id", "network", "signer_address", "memo", "transaction_signature", "status", "slot", "block_time", "fee_lamports", "finalized_at", "last_verified_at", "created_at", "updated_at", "note_content_id", "subject_type", "subject_id", "subject_hash", "subject_manifest_version") SELECT "id", "project_version_id", "issuer_user_id", "network", "signer_address", "memo", "transaction_signature", "status", "slot", "block_time", "fee_lamports", "finalized_at", "last_verified_at", "created_at", "updated_at", "note_content_id", "subject_type", "subject_id", "subject_hash", "subject_manifest_version" FROM "release_credential";

DROP TABLE "release_credential";

ALTER TABLE "new_release_credential" RENAME TO "release_credential";

CREATE UNIQUE INDEX "uq_release_credential_transaction_signature" ON "release_credential"("transaction_signature");

CREATE INDEX "idx_release_credential_network_status" ON "release_credential"("network", "status");

CREATE INDEX "idx_release_credential_signer" ON "release_credential"("signer_address");

CREATE UNIQUE INDEX "uq_release_credential_subject_network" ON "release_credential"("subject_type", "subject_id", "network");

CREATE INDEX "idx_release_credential_note_content" ON "release_credential"("note_content_id");

CREATE TABLE "new_release_credential_attempt" (
 "attribution_json" TEXT NOT NULL DEFAULT '{}',
    "id" INTEGER NOT NULL PRIMARY KEY AUTOINCREMENT,
    "credential_id" INTEGER NOT NULL,
    "issuer_user_id" INTEGER,
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
    CONSTRAINT "release_credential_attempt_issuer_user_id_fkey" FOREIGN KEY ("issuer_user_id") REFERENCES "auth_user" ("id") ON DELETE SET NULL ON UPDATE NO ACTION
);

INSERT INTO "new_release_credential_attempt" ("id", "credential_id", "issuer_user_id", "signer_address", "memo", "message_hash", "recent_blockhash", "last_valid_block_height", "transaction_signature", "status", "failure_code", "failure_message", "expires_at", "submitted_at", "finalized_at", "created_at", "updated_at") SELECT "id", "credential_id", "issuer_user_id", "signer_address", "memo", "message_hash", "recent_blockhash", "last_valid_block_height", "transaction_signature", "status", "failure_code", "failure_message", "expires_at", "submitted_at", "finalized_at", "created_at", "updated_at" FROM "release_credential_attempt";

DROP TABLE "release_credential_attempt";

ALTER TABLE "new_release_credential_attempt" RENAME TO "release_credential_attempt";

CREATE INDEX "idx_release_credential_attempt_status" ON "release_credential_attempt"("credential_id", "status");

CREATE INDEX "idx_release_credential_attempt_signature" ON "release_credential_attempt"("transaction_signature");

CREATE TABLE "new_commission_payment" (
 "attribution_json" TEXT NOT NULL DEFAULT '{}',
  "id" INTEGER PRIMARY KEY AUTOINCREMENT,
  "commission_id" INTEGER NOT NULL,
  "plan_id" INTEGER NOT NULL,
  "amount_fen" BIGINT NOT NULL,
  "kind" TEXT NOT NULL DEFAULT 'RECEIPT',
  "status" TEXT NOT NULL DEFAULT 'PENDING',
  "note" TEXT NOT NULL,
  "evidence_file_id" INTEGER,
  "created_by_id" INTEGER,
  "confirmed_by_id" INTEGER,
  "created_at" DATETIME NOT NULL DEFAULT CURRENT_TIMESTAMP,
  "confirmed_at" DATETIME,
  FOREIGN KEY ("commission_id") REFERENCES "commission"("id") ON DELETE RESTRICT ON UPDATE NO ACTION,
  FOREIGN KEY ("plan_id") REFERENCES "commission_payment_plan"("id") ON DELETE RESTRICT ON UPDATE NO ACTION,
  FOREIGN KEY ("evidence_file_id") REFERENCES "commission_file"("id") ON DELETE RESTRICT ON UPDATE NO ACTION
,
 CONSTRAINT "commission_payment_created_by_id_fkey" FOREIGN KEY ("created_by_id") REFERENCES "auth_user"("id") ON DELETE SET NULL ON UPDATE NO ACTION
,
 CONSTRAINT "commission_payment_confirmed_by_id_fkey" FOREIGN KEY ("confirmed_by_id") REFERENCES "auth_user"("id") ON DELETE SET NULL ON UPDATE NO ACTION
);

INSERT INTO "new_commission_payment" ("id", "commission_id", "plan_id", "amount_fen", "kind", "status", "note", "evidence_file_id", "created_by_id", "confirmed_by_id", "created_at", "confirmed_at") SELECT "id", "commission_id", "plan_id", "amount_fen", "kind", "status", "note", "evidence_file_id", "created_by_id", "confirmed_by_id", "created_at", "confirmed_at" FROM "commission_payment";

DROP TABLE "commission_payment";

ALTER TABLE "new_commission_payment" RENAME TO "commission_payment";

CREATE INDEX "idx_commission_payment_owner_status" ON "commission_payment" ("commission_id", "status");

CREATE TABLE "new_commission_change" (
 "attribution_json" TEXT NOT NULL DEFAULT '{}',
  "id" INTEGER PRIMARY KEY AUTOINCREMENT,
  "commission_id" INTEGER NOT NULL,
  "title" TEXT NOT NULL,
  "original" TEXT NOT NULL,
  "proposed" TEXT NOT NULL,
  "reason" TEXT NOT NULL,
  "impact" TEXT NOT NULL DEFAULT '',
  "fee_fen" BIGINT NOT NULL DEFAULT 0,
  "extension_days" INTEGER NOT NULL DEFAULT 0,
  "status" TEXT NOT NULL DEFAULT 'PROPOSED',
  "created_by_id" INTEGER,
  "created_at" DATETIME NOT NULL DEFAULT CURRENT_TIMESTAMP,
  "confirmed_at" DATETIME,
  FOREIGN KEY ("commission_id") REFERENCES "commission"("id") ON DELETE RESTRICT ON UPDATE NO ACTION
,
 CONSTRAINT "commission_change_created_by_id_fkey" FOREIGN KEY ("created_by_id") REFERENCES "auth_user"("id") ON DELETE SET NULL ON UPDATE NO ACTION
);

INSERT INTO "new_commission_change" ("id", "commission_id", "title", "original", "proposed", "reason", "impact", "fee_fen", "extension_days", "status", "created_by_id", "created_at", "confirmed_at") SELECT "id", "commission_id", "title", "original", "proposed", "reason", "impact", "fee_fen", "extension_days", "status", "created_by_id", "created_at", "confirmed_at" FROM "commission_change";

DROP TABLE "commission_change";

ALTER TABLE "new_commission_change" RENAME TO "commission_change";

CREATE INDEX "idx_commission_change_owner_status" ON "commission_change" ("commission_id", "status");

CREATE TABLE "new_commission_issue" (
 "attribution_json" TEXT NOT NULL DEFAULT '{}',
  "id" INTEGER PRIMARY KEY AUTOINCREMENT,
  "commission_id" INTEGER NOT NULL,
  "delivery_id" INTEGER,
  "title" TEXT NOT NULL,
  "kind" TEXT NOT NULL DEFAULT 'BUG',
  "severity" TEXT NOT NULL DEFAULT 'GENERAL',
  "status" TEXT NOT NULL DEFAULT 'OPEN',
  "steps" TEXT NOT NULL,
  "expected" TEXT NOT NULL,
  "actual" TEXT NOT NULL,
  "resolution" TEXT NOT NULL DEFAULT '',
  "file_ids_json" TEXT NOT NULL DEFAULT '[]',
  "due_at" DATETIME,
  "created_by_id" INTEGER,
  "created_at" DATETIME NOT NULL DEFAULT CURRENT_TIMESTAMP,
  "resolved_at" DATETIME,
  FOREIGN KEY ("commission_id") REFERENCES "commission"("id") ON DELETE RESTRICT ON UPDATE NO ACTION,
  FOREIGN KEY ("delivery_id") REFERENCES "commission_delivery"("id") ON DELETE RESTRICT ON UPDATE NO ACTION
,
 CONSTRAINT "commission_issue_created_by_id_fkey" FOREIGN KEY ("created_by_id") REFERENCES "auth_user"("id") ON DELETE SET NULL ON UPDATE NO ACTION
);

INSERT INTO "new_commission_issue" ("id", "commission_id", "delivery_id", "title", "kind", "severity", "status", "steps", "expected", "actual", "resolution", "file_ids_json", "due_at", "created_by_id", "created_at", "resolved_at") SELECT "id", "commission_id", "delivery_id", "title", "kind", "severity", "status", "steps", "expected", "actual", "resolution", "file_ids_json", "due_at", "created_by_id", "created_at", "resolved_at" FROM "commission_issue";

DROP TABLE "commission_issue";

ALTER TABLE "new_commission_issue" RENAME TO "commission_issue";

CREATE INDEX "idx_commission_issue_owner_status" ON "commission_issue" ("commission_id", "status");

CREATE TABLE "new_commission_file" (
 "attribution_json" TEXT NOT NULL DEFAULT '{}',
  "id" INTEGER PRIMARY KEY AUTOINCREMENT,
  "commission_id" INTEGER NOT NULL,
  "file_id" INTEGER NOT NULL,
  "purpose" TEXT NOT NULL,
  "sha256" TEXT NOT NULL,
  "uploader_user_id" INTEGER,
  "shared" BOOLEAN NOT NULL DEFAULT false,
  FOREIGN KEY ("commission_id") REFERENCES "commission"("id") ON DELETE RESTRICT ON UPDATE NO ACTION,
  FOREIGN KEY ("file_id") REFERENCES "files_file_management"("id") ON DELETE RESTRICT ON UPDATE NO ACTION,
  CONSTRAINT "uq_commission_managed_file" UNIQUE ("file_id")
,
 CONSTRAINT "commission_file_uploader_user_id_fkey" FOREIGN KEY ("uploader_user_id") REFERENCES "auth_user"("id") ON DELETE SET NULL ON UPDATE NO ACTION
);

INSERT INTO "new_commission_file" ("id", "commission_id", "file_id", "purpose", "sha256", "uploader_user_id", "shared") SELECT "id", "commission_id", "file_id", "purpose", "sha256", "uploader_user_id", "shared" FROM "commission_file";

DROP TABLE "commission_file";

ALTER TABLE "new_commission_file" RENAME TO "commission_file";

CREATE INDEX "idx_commission_file_owner" ON "commission_file" ("commission_id");

CREATE TABLE "new_commission_event" (
 "attribution_json" TEXT NOT NULL DEFAULT '{}',
  "id" INTEGER PRIMARY KEY AUTOINCREMENT,
  "commission_id" INTEGER NOT NULL,
  "actor_user_id" INTEGER,
  "command_id" TEXT NOT NULL,
  "type" TEXT NOT NULL,
  "note" TEXT NOT NULL,
  "data_json" TEXT NOT NULL DEFAULT '{}',
  "created_at" DATETIME NOT NULL DEFAULT CURRENT_TIMESTAMP,
  FOREIGN KEY ("commission_id") REFERENCES "commission"("id") ON DELETE RESTRICT ON UPDATE NO ACTION,
  FOREIGN KEY ("actor_user_id") REFERENCES "auth_user"("id") ON DELETE SET NULL ON UPDATE NO ACTION,
  CONSTRAINT "uq_commission_event_command" UNIQUE ("commission_id", "command_id")
);

INSERT INTO "new_commission_event" ("id", "commission_id", "actor_user_id", "command_id", "type", "note", "data_json", "created_at") SELECT "id", "commission_id", "actor_user_id", "command_id", "type", "note", "data_json", "created_at" FROM "commission_event";

DROP TABLE "commission_event";

ALTER TABLE "new_commission_event" RENAME TO "commission_event";

CREATE INDEX "idx_commission_event_owner_created" ON "commission_event" ("commission_id", "created_at");

CREATE TABLE "new_commission_submission" (
 "attribution_json" TEXT NOT NULL DEFAULT '{}',
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
,
 CONSTRAINT "commission_submission_actor_user_id_fkey" FOREIGN KEY ("actor_user_id") REFERENCES "auth_user"("id") ON DELETE SET NULL ON UPDATE NO ACTION
);

INSERT INTO "new_commission_submission" ("id", "public_id", "commission_id", "sequence", "command_id", "request_hash", "actor_user_id", "type", "snapshot_json", "snapshot_hash", "previous_hash", "proof_revision", "created_at") SELECT "id", "public_id", "commission_id", "sequence", "command_id", "request_hash", "actor_user_id", "type", "snapshot_json", "snapshot_hash", "previous_hash", "proof_revision", "created_at" FROM "commission_submission";

DROP TABLE "commission_submission";

ALTER TABLE "new_commission_submission" RENAME TO "commission_submission";

CREATE UNIQUE INDEX "uq_commission_submission_public" ON "commission_submission"("public_id");

CREATE UNIQUE INDEX "uq_commission_submission_sequence" ON "commission_submission"("commission_id", "sequence");

CREATE UNIQUE INDEX "uq_commission_submission_command" ON "commission_submission"("commission_id", "command_id");

CREATE TABLE "new_commission_proof_attempt" (
 "attribution_json" TEXT NOT NULL DEFAULT '{}',
    "id" INTEGER NOT NULL PRIMARY KEY AUTOINCREMENT,
    "submission_id" INTEGER NOT NULL,
    "network" TEXT NOT NULL,
    "issuer_user_id" INTEGER,
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
,
 CONSTRAINT "commission_proof_attempt_issuer_user_id_fkey" FOREIGN KEY ("issuer_user_id") REFERENCES "auth_user"("id") ON DELETE SET NULL ON UPDATE NO ACTION
);

INSERT INTO "new_commission_proof_attempt" ("id", "submission_id", "network", "issuer_user_id", "signer_address", "status", "memo", "message_hash", "transaction_base64", "last_valid_block_height", "expires_at", "transaction_signature", "slot", "block_time", "fee_lamports", "error", "created_at", "finalized_at") SELECT "id", "submission_id", "network", "issuer_user_id", "signer_address", "status", "memo", "message_hash", "transaction_base64", "last_valid_block_height", "expires_at", "transaction_signature", "slot", "block_time", "fee_lamports", "error", "created_at", "finalized_at" FROM "commission_proof_attempt";

DROP TABLE "commission_proof_attempt";

ALTER TABLE "new_commission_proof_attempt" RENAME TO "commission_proof_attempt";

CREATE UNIQUE INDEX "uq_commission_proof_signature" ON "commission_proof_attempt"("transaction_signature");

CREATE INDEX "idx_commission_proof_submission_network" ON "commission_proof_attempt"("submission_id", "network");

CREATE INDEX "idx_commission_proof_status" ON "commission_proof_attempt"("status");

CREATE TABLE "new_commission_invitation" (
    "id" INTEGER NOT NULL PRIMARY KEY AUTOINCREMENT,
    "commission_id" INTEGER NOT NULL,
    "token_hash" TEXT NOT NULL,
    "expires_at" DATETIME NOT NULL,
    "revoked_at" DATETIME,
    "claimed_at" DATETIME,
    "claimed_by_id" INTEGER,
    "created_at" DATETIME NOT NULL DEFAULT CURRENT_TIMESTAMP,
    CONSTRAINT "commission_invitation_commission_id_fkey" FOREIGN KEY ("commission_id") REFERENCES "commission" ("id") ON DELETE RESTRICT ON UPDATE NO ACTION
,
 CONSTRAINT "commission_invitation_claimed_by_id_fkey" FOREIGN KEY ("claimed_by_id") REFERENCES "auth_user"("id") ON DELETE RESTRICT ON UPDATE NO ACTION
);

INSERT INTO "new_commission_invitation" ("id", "commission_id", "token_hash", "expires_at", "revoked_at", "claimed_at", "claimed_by_id", "created_at") SELECT "id", "commission_id", "token_hash", "expires_at", "revoked_at", "claimed_at", "claimed_by_id", "created_at" FROM "commission_invitation";

DROP TABLE "commission_invitation";

ALTER TABLE "new_commission_invitation" RENAME TO "commission_invitation";

CREATE UNIQUE INDEX "uq_commission_invitation_token" ON "commission_invitation"("token_hash");

CREATE INDEX "idx_commission_invitation_owner" ON "commission_invitation"("commission_id");

CREATE TABLE "auth_user_deletion_record" ("id" INTEGER NOT NULL PRIMARY KEY AUTOINCREMENT, "public_id" TEXT NOT NULL, "username" TEXT NOT NULL, "user_snapshot_json" TEXT NOT NULL, "actor_snapshot_json" TEXT NOT NULL, "summary_json" TEXT NOT NULL, "user_created_at" DATETIME NOT NULL, "deleted_at" DATETIME NOT NULL DEFAULT CURRENT_TIMESTAMP);

CREATE UNIQUE INDEX "uq_auth_user_deletion_public_id" ON "auth_user_deletion_record"("public_id");

CREATE INDEX "idx_auth_user_deletion_deleted_at" ON "auth_user_deletion_record"("deleted_at");

COMMIT;

PRAGMA foreign_keys=ON;

PRAGMA foreign_key_check;
