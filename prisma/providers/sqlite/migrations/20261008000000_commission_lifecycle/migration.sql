-- Commission lifecycle: additive schema upgrade; legacy-only cleanup runs once in the application upgrade.

CREATE TABLE "commission_contract_template" (
  "id" INTEGER PRIMARY KEY AUTOINCREMENT,
  "key" TEXT NOT NULL,
  "name" TEXT NOT NULL,
  "status" TEXT NOT NULL DEFAULT 'ACTIVE',
  "created_at" DATETIME NOT NULL DEFAULT CURRENT_TIMESTAMP,
  CONSTRAINT "uq_contract_template_key" UNIQUE ("key")
);

CREATE TABLE "commission_contract_template_version" (
  "id" INTEGER PRIMARY KEY AUTOINCREMENT,
  "template_id" INTEGER NOT NULL,
  "version" INTEGER NOT NULL,
  "status" TEXT NOT NULL DEFAULT 'DRAFT',
  "documents_json" TEXT NOT NULL,
  "fields_json" TEXT NOT NULL,
  "defaults_json" TEXT NOT NULL,
  "created_at" DATETIME NOT NULL DEFAULT CURRENT_TIMESTAMP,
  "published_at" DATETIME,
  FOREIGN KEY ("template_id") REFERENCES "commission_contract_template"("id") ON DELETE RESTRICT ON UPDATE NO ACTION,
  CONSTRAINT "uq_commission_template_version" UNIQUE ("template_id", "version")
);

CREATE TABLE "commission_settings" (
  "id" INTEGER NOT NULL PRIMARY KEY DEFAULT 1,
  "provider_json" TEXT NOT NULL DEFAULT '{}',
  "calendar_json" TEXT NOT NULL DEFAULT '{}'
);

CREATE TABLE "commission" (
  "id" INTEGER PRIMARY KEY AUTOINCREMENT,
  "commission_id" TEXT NOT NULL,
  "subject_user_id" INTEGER NOT NULL,
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
  FOREIGN KEY ("subject_user_id") REFERENCES "auth_user"("id") ON DELETE RESTRICT ON UPDATE NO ACTION,
  CONSTRAINT "uq_commission_identity" UNIQUE ("commission_id")
);

CREATE INDEX "idx_commission_subject_stage" ON "commission" ("subject_user_id", "stage");

CREATE TABLE "commission_milestone" (
  "id" INTEGER PRIMARY KEY AUTOINCREMENT,
  "commission_id" INTEGER NOT NULL,
  "title" TEXT NOT NULL,
  "description" TEXT NOT NULL,
  "due_at" DATETIME,
  "completed_at" DATETIME,
  FOREIGN KEY ("commission_id") REFERENCES "commission"("id") ON DELETE RESTRICT ON UPDATE NO ACTION
);

CREATE INDEX "idx_commission_milestone_owner" ON "commission_milestone" ("commission_id");

CREATE TABLE "commission_payment_plan" (
  "id" INTEGER PRIMARY KEY AUTOINCREMENT,
  "commission_id" INTEGER NOT NULL,
  "key" TEXT NOT NULL,
  "kind" TEXT NOT NULL,
  "title" TEXT NOT NULL,
  "amount_fen" BIGINT NOT NULL,
  "due_at" DATETIME,
  "basis" TEXT NOT NULL DEFAULT '',
  "reminded_at" DATETIME,
  FOREIGN KEY ("commission_id") REFERENCES "commission"("id") ON DELETE RESTRICT ON UPDATE NO ACTION,
  CONSTRAINT "uq_commission_payment_plan_key" UNIQUE ("commission_id", "key")
);

CREATE INDEX "idx_commission_plan_owner" ON "commission_payment_plan" ("commission_id");

CREATE TABLE "commission_payment" (
  "id" INTEGER PRIMARY KEY AUTOINCREMENT,
  "commission_id" INTEGER NOT NULL,
  "plan_id" INTEGER NOT NULL,
  "amount_fen" BIGINT NOT NULL,
  "kind" TEXT NOT NULL DEFAULT 'RECEIPT',
  "status" TEXT NOT NULL DEFAULT 'PENDING',
  "note" TEXT NOT NULL,
  "evidence_file_id" INTEGER,
  "created_by_id" INTEGER NOT NULL,
  "confirmed_by_id" INTEGER,
  "created_at" DATETIME NOT NULL DEFAULT CURRENT_TIMESTAMP,
  "confirmed_at" DATETIME,
  FOREIGN KEY ("commission_id") REFERENCES "commission"("id") ON DELETE RESTRICT ON UPDATE NO ACTION,
  FOREIGN KEY ("plan_id") REFERENCES "commission_payment_plan"("id") ON DELETE RESTRICT ON UPDATE NO ACTION,
  FOREIGN KEY ("evidence_file_id") REFERENCES "commission_file"("id") ON DELETE RESTRICT ON UPDATE NO ACTION
);

CREATE INDEX "idx_commission_payment_owner_status" ON "commission_payment" ("commission_id", "status");

CREATE TABLE "commission_change" (
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
  "created_by_id" INTEGER NOT NULL,
  "created_at" DATETIME NOT NULL DEFAULT CURRENT_TIMESTAMP,
  "confirmed_at" DATETIME,
  FOREIGN KEY ("commission_id") REFERENCES "commission"("id") ON DELETE RESTRICT ON UPDATE NO ACTION
);

CREATE INDEX "idx_commission_change_owner_status" ON "commission_change" ("commission_id", "status");

CREATE TABLE "commission_issue" (
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
  "created_by_id" INTEGER NOT NULL,
  "created_at" DATETIME NOT NULL DEFAULT CURRENT_TIMESTAMP,
  "resolved_at" DATETIME,
  FOREIGN KEY ("commission_id") REFERENCES "commission"("id") ON DELETE RESTRICT ON UPDATE NO ACTION,
  FOREIGN KEY ("delivery_id") REFERENCES "commission_delivery"("id") ON DELETE RESTRICT ON UPDATE NO ACTION
);

CREATE INDEX "idx_commission_issue_owner_status" ON "commission_issue" ("commission_id", "status");

CREATE TABLE "commission_file" (
  "id" INTEGER PRIMARY KEY AUTOINCREMENT,
  "commission_id" INTEGER NOT NULL,
  "file_id" INTEGER NOT NULL,
  "purpose" TEXT NOT NULL,
  "sha256" TEXT NOT NULL,
  "uploader_user_id" INTEGER NOT NULL,
  "shared" BOOLEAN NOT NULL DEFAULT false,
  FOREIGN KEY ("commission_id") REFERENCES "commission"("id") ON DELETE RESTRICT ON UPDATE NO ACTION,
  FOREIGN KEY ("file_id") REFERENCES "files_file_management"("id") ON DELETE RESTRICT ON UPDATE NO ACTION,
  CONSTRAINT "uq_commission_managed_file" UNIQUE ("file_id")
);

CREATE INDEX "idx_commission_file_owner" ON "commission_file" ("commission_id");

CREATE TABLE "commission_delivery" (
  "id" INTEGER PRIMARY KEY AUTOINCREMENT,
  "commission_id" INTEGER NOT NULL,
  "version" TEXT NOT NULL,
  "kind" TEXT NOT NULL DEFAULT 'FINAL',
  "note" TEXT NOT NULL,
  "test_instructions" TEXT NOT NULL DEFAULT '',
  "manifest_json" TEXT NOT NULL DEFAULT '[]',
  "status" TEXT NOT NULL DEFAULT 'DRAFT',
  "created_at" DATETIME NOT NULL DEFAULT CURRENT_TIMESTAMP,
  "published_at" DATETIME,
  "received_at" DATETIME,
  "receipt_note" TEXT NOT NULL DEFAULT '',
  FOREIGN KEY ("commission_id") REFERENCES "commission"("id") ON DELETE RESTRICT ON UPDATE NO ACTION
);

CREATE INDEX "idx_commission_delivery_owner_status" ON "commission_delivery" ("commission_id", "status");

CREATE TABLE "commission_delivery_item" (
  "id" INTEGER PRIMARY KEY AUTOINCREMENT,
  "delivery_id" INTEGER NOT NULL,
  "file_id" INTEGER,
  "label" TEXT NOT NULL,
  "url" TEXT,
  "version_note" TEXT NOT NULL DEFAULT '',
  FOREIGN KEY ("delivery_id") REFERENCES "commission_delivery"("id") ON DELETE RESTRICT ON UPDATE NO ACTION,
  FOREIGN KEY ("file_id") REFERENCES "commission_file"("id") ON DELETE RESTRICT ON UPDATE NO ACTION
);

CREATE INDEX "idx_commission_delivery_item_batch" ON "commission_delivery_item" ("delivery_id");

CREATE TABLE "commission_acceptance" (
  "id" INTEGER PRIMARY KEY AUTOINCREMENT,
  "commission_id" INTEGER NOT NULL,
  "delivery_id" INTEGER NOT NULL,
  "result" TEXT NOT NULL,
  "basis" TEXT NOT NULL,
  "outstanding" TEXT NOT NULL,
  "status" TEXT NOT NULL DEFAULT 'DRAFT',
  "created_at" DATETIME NOT NULL DEFAULT CURRENT_TIMESTAMP,
  "confirmed_at" DATETIME,
  "reminded_at" DATETIME,
  "supplemental_due_at" DATETIME,
  "deemed_basis" TEXT,
  FOREIGN KEY ("commission_id") REFERENCES "commission"("id") ON DELETE RESTRICT ON UPDATE NO ACTION,
  FOREIGN KEY ("delivery_id") REFERENCES "commission_delivery"("id") ON DELETE RESTRICT ON UPDATE NO ACTION
);

CREATE INDEX "idx_commission_acceptance_owner_status" ON "commission_acceptance" ("commission_id", "status");

CREATE TABLE "commission_event" (
  "id" INTEGER PRIMARY KEY AUTOINCREMENT,
  "commission_id" INTEGER NOT NULL,
  "actor_user_id" INTEGER NOT NULL,
  "command_id" TEXT NOT NULL,
  "type" TEXT NOT NULL,
  "note" TEXT NOT NULL,
  "data_json" TEXT NOT NULL DEFAULT '{}',
  "created_at" DATETIME NOT NULL DEFAULT CURRENT_TIMESTAMP,
  FOREIGN KEY ("commission_id") REFERENCES "commission"("id") ON DELETE RESTRICT ON UPDATE NO ACTION,
  FOREIGN KEY ("actor_user_id") REFERENCES "auth_user"("id") ON DELETE RESTRICT ON UPDATE NO ACTION,
  CONSTRAINT "uq_commission_event_command" UNIQUE ("commission_id", "command_id")
);

CREATE INDEX "idx_commission_event_owner_created" ON "commission_event" ("commission_id", "created_at");

ALTER TABLE "contract" ADD COLUMN "commission_id" INTEGER REFERENCES "commission"("id") ON DELETE RESTRICT ON UPDATE NO ACTION;

ALTER TABLE "contract" ADD COLUMN "template_version_id" INTEGER REFERENCES "commission_contract_template_version"("id") ON DELETE RESTRICT ON UPDATE NO ACTION;

ALTER TABLE "contract" ADD COLUMN "document_type" TEXT NOT NULL DEFAULT 'AGREEMENT';

ALTER TABLE "contract" ADD COLUMN "source_record_id" INTEGER;

ALTER TABLE "contract" ADD COLUMN "snapshot_hash" TEXT;

ALTER TABLE "contract" ADD COLUMN "snapshot_json" TEXT;

ALTER TABLE "contract" ADD COLUMN "provider_session_id" TEXT;

ALTER TABLE "contract" ADD COLUMN "provider_ip" TEXT;

ALTER TABLE "contract" ADD COLUMN "provider_user_agent" TEXT;

CREATE INDEX "idx_contract_commission_type_status" ON "contract" ("commission_id", "document_type", "status");
