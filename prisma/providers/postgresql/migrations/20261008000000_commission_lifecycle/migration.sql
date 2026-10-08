-- Commission lifecycle: additive schema upgrade; legacy-only cleanup runs once in the application upgrade.

CREATE TABLE "commission_contract_template" (
  "id" SERIAL PRIMARY KEY,
  "key" VARCHAR(255) NOT NULL,
  "name" VARCHAR(255) NOT NULL,
  "status" VARCHAR(255) NOT NULL DEFAULT 'ACTIVE',
  "created_at" TIMESTAMPTZ(3) NOT NULL DEFAULT CURRENT_TIMESTAMP(3),
  CONSTRAINT "uq_contract_template_key" UNIQUE ("key")
);

CREATE TABLE "commission_contract_template_version" (
  "id" SERIAL PRIMARY KEY,
  "template_id" INTEGER NOT NULL,
  "version" INTEGER NOT NULL,
  "status" VARCHAR(255) NOT NULL DEFAULT 'DRAFT',
  "documents_json" TEXT NOT NULL,
  "fields_json" TEXT NOT NULL,
  "defaults_json" TEXT NOT NULL,
  "created_at" TIMESTAMPTZ(3) NOT NULL DEFAULT CURRENT_TIMESTAMP(3),
  "published_at" TIMESTAMPTZ(3),
  CONSTRAINT "uq_commission_template_version" UNIQUE ("template_id", "version")
);

CREATE TABLE "commission_settings" (
  "id" INTEGER NOT NULL PRIMARY KEY DEFAULT 1,
  "provider_json" TEXT NOT NULL DEFAULT '{}',
  "calendar_json" TEXT NOT NULL DEFAULT '{}'
);

CREATE TABLE "commission" (
  "id" SERIAL PRIMARY KEY,
  "commission_id" VARCHAR(255) NOT NULL,
  "subject_user_id" INTEGER NOT NULL,
  "title" VARCHAR(255) NOT NULL,
  "purpose" TEXT NOT NULL,
  "requirements" TEXT NOT NULL,
  "party_a_json" TEXT NOT NULL DEFAULT '{}',
  "party_b_json" TEXT NOT NULL DEFAULT '{}',
  "quotation_fen" BIGINT,
  "agreement_fen" BIGINT,
  "stage" VARCHAR(255) NOT NULL DEFAULT 'ASSESSMENT',
  "progress" INTEGER NOT NULL DEFAULT 0,
  "progress_note" TEXT NOT NULL DEFAULT '',
  "revision" INTEGER NOT NULL DEFAULT 0,
  "expected_delivery_at" TIMESTAMPTZ(3),
  "started_at" TIMESTAMPTZ(3),
  "accepted_at" TIMESTAMPTZ(3),
  "adjustment_days" INTEGER NOT NULL DEFAULT 15,
  "maintenance_days" INTEGER NOT NULL DEFAULT 30,
  "settlement_json" TEXT NOT NULL DEFAULT '{}',
  "created_at" TIMESTAMPTZ(3) NOT NULL DEFAULT CURRENT_TIMESTAMP(3),
  "updated_at" TIMESTAMPTZ(3) NOT NULL DEFAULT CURRENT_TIMESTAMP(3),
  CONSTRAINT "uq_commission_identity" UNIQUE ("commission_id")
);

CREATE INDEX "idx_commission_subject_stage" ON "commission" ("subject_user_id", "stage");

CREATE TABLE "commission_milestone" (
  "id" SERIAL PRIMARY KEY,
  "commission_id" INTEGER NOT NULL,
  "title" VARCHAR(255) NOT NULL,
  "description" TEXT NOT NULL,
  "due_at" TIMESTAMPTZ(3),
  "completed_at" TIMESTAMPTZ(3)
);

CREATE INDEX "idx_commission_milestone_owner" ON "commission_milestone" ("commission_id");

CREATE TABLE "commission_payment_plan" (
  "id" SERIAL PRIMARY KEY,
  "commission_id" INTEGER NOT NULL,
  "key" VARCHAR(255) NOT NULL,
  "kind" VARCHAR(255) NOT NULL,
  "title" VARCHAR(255) NOT NULL,
  "amount_fen" BIGINT NOT NULL,
  "due_at" TIMESTAMPTZ(3),
  "basis" TEXT NOT NULL DEFAULT '',
  "reminded_at" TIMESTAMPTZ(3),
  CONSTRAINT "uq_commission_payment_plan_key" UNIQUE ("commission_id", "key")
);

CREATE INDEX "idx_commission_plan_owner" ON "commission_payment_plan" ("commission_id");

CREATE TABLE "commission_payment" (
  "id" SERIAL PRIMARY KEY,
  "commission_id" INTEGER NOT NULL,
  "plan_id" INTEGER NOT NULL,
  "amount_fen" BIGINT NOT NULL,
  "kind" VARCHAR(255) NOT NULL DEFAULT 'RECEIPT',
  "status" VARCHAR(255) NOT NULL DEFAULT 'PENDING',
  "note" TEXT NOT NULL,
  "evidence_file_id" INTEGER,
  "created_by_id" INTEGER NOT NULL,
  "confirmed_by_id" INTEGER,
  "created_at" TIMESTAMPTZ(3) NOT NULL DEFAULT CURRENT_TIMESTAMP(3),
  "confirmed_at" TIMESTAMPTZ(3)
);

CREATE INDEX "idx_commission_payment_owner_status" ON "commission_payment" ("commission_id", "status");

CREATE TABLE "commission_change" (
  "id" SERIAL PRIMARY KEY,
  "commission_id" INTEGER NOT NULL,
  "title" VARCHAR(255) NOT NULL,
  "original" TEXT NOT NULL,
  "proposed" TEXT NOT NULL,
  "reason" VARCHAR(255) NOT NULL,
  "impact" TEXT NOT NULL DEFAULT '',
  "fee_fen" BIGINT NOT NULL DEFAULT 0,
  "extension_days" INTEGER NOT NULL DEFAULT 0,
  "status" VARCHAR(255) NOT NULL DEFAULT 'PROPOSED',
  "created_by_id" INTEGER NOT NULL,
  "created_at" TIMESTAMPTZ(3) NOT NULL DEFAULT CURRENT_TIMESTAMP(3),
  "confirmed_at" TIMESTAMPTZ(3)
);

CREATE INDEX "idx_commission_change_owner_status" ON "commission_change" ("commission_id", "status");

CREATE TABLE "commission_issue" (
  "id" SERIAL PRIMARY KEY,
  "commission_id" INTEGER NOT NULL,
  "delivery_id" INTEGER,
  "title" VARCHAR(255) NOT NULL,
  "kind" VARCHAR(255) NOT NULL DEFAULT 'BUG',
  "severity" VARCHAR(255) NOT NULL DEFAULT 'GENERAL',
  "status" VARCHAR(255) NOT NULL DEFAULT 'OPEN',
  "steps" TEXT NOT NULL,
  "expected" TEXT NOT NULL,
  "actual" TEXT NOT NULL,
  "resolution" TEXT NOT NULL DEFAULT '',
  "file_ids_json" TEXT NOT NULL DEFAULT '[]',
  "due_at" TIMESTAMPTZ(3),
  "created_by_id" INTEGER NOT NULL,
  "created_at" TIMESTAMPTZ(3) NOT NULL DEFAULT CURRENT_TIMESTAMP(3),
  "resolved_at" TIMESTAMPTZ(3)
);

CREATE INDEX "idx_commission_issue_owner_status" ON "commission_issue" ("commission_id", "status");

CREATE TABLE "commission_file" (
  "id" SERIAL PRIMARY KEY,
  "commission_id" INTEGER NOT NULL,
  "file_id" INTEGER NOT NULL,
  "purpose" TEXT NOT NULL,
  "sha256" VARCHAR(255) NOT NULL,
  "uploader_user_id" INTEGER NOT NULL,
  "shared" BOOLEAN NOT NULL DEFAULT false,
  CONSTRAINT "uq_commission_managed_file" UNIQUE ("file_id")
);

CREATE INDEX "idx_commission_file_owner" ON "commission_file" ("commission_id");

CREATE TABLE "commission_delivery" (
  "id" SERIAL PRIMARY KEY,
  "commission_id" INTEGER NOT NULL,
  "version" VARCHAR(255) NOT NULL,
  "kind" VARCHAR(255) NOT NULL DEFAULT 'FINAL',
  "note" TEXT NOT NULL,
  "test_instructions" TEXT NOT NULL DEFAULT '',
  "manifest_json" TEXT NOT NULL DEFAULT '[]',
  "status" VARCHAR(255) NOT NULL DEFAULT 'DRAFT',
  "created_at" TIMESTAMPTZ(3) NOT NULL DEFAULT CURRENT_TIMESTAMP(3),
  "published_at" TIMESTAMPTZ(3),
  "received_at" TIMESTAMPTZ(3),
  "receipt_note" TEXT NOT NULL DEFAULT ''
);

CREATE INDEX "idx_commission_delivery_owner_status" ON "commission_delivery" ("commission_id", "status");

CREATE TABLE "commission_delivery_item" (
  "id" SERIAL PRIMARY KEY,
  "delivery_id" INTEGER NOT NULL,
  "file_id" INTEGER,
  "label" VARCHAR(255) NOT NULL,
  "url" VARCHAR(255),
  "version_note" VARCHAR(255) NOT NULL DEFAULT ''
);

CREATE INDEX "idx_commission_delivery_item_batch" ON "commission_delivery_item" ("delivery_id");

CREATE TABLE "commission_acceptance" (
  "id" SERIAL PRIMARY KEY,
  "commission_id" INTEGER NOT NULL,
  "delivery_id" INTEGER NOT NULL,
  "result" VARCHAR(255) NOT NULL,
  "basis" TEXT NOT NULL,
  "outstanding" TEXT NOT NULL,
  "status" VARCHAR(255) NOT NULL DEFAULT 'DRAFT',
  "created_at" TIMESTAMPTZ(3) NOT NULL DEFAULT CURRENT_TIMESTAMP(3),
  "confirmed_at" TIMESTAMPTZ(3),
  "reminded_at" TIMESTAMPTZ(3),
  "supplemental_due_at" TIMESTAMPTZ(3),
  "deemed_basis" TEXT
);

CREATE INDEX "idx_commission_acceptance_owner_status" ON "commission_acceptance" ("commission_id", "status");

CREATE TABLE "commission_event" (
  "id" SERIAL PRIMARY KEY,
  "commission_id" INTEGER NOT NULL,
  "actor_user_id" INTEGER NOT NULL,
  "command_id" VARCHAR(255) NOT NULL,
  "type" VARCHAR(255) NOT NULL,
  "note" TEXT NOT NULL,
  "data_json" TEXT NOT NULL DEFAULT '{}',
  "created_at" TIMESTAMPTZ(3) NOT NULL DEFAULT CURRENT_TIMESTAMP(3),
  CONSTRAINT "uq_commission_event_command" UNIQUE ("commission_id", "command_id")
);

CREATE INDEX "idx_commission_event_owner_created" ON "commission_event" ("commission_id", "created_at");

ALTER TABLE "commission_contract_template_version" ADD CONSTRAINT "commission_contract_template_version_template_id_fkey" FOREIGN KEY ("template_id") REFERENCES "commission_contract_template"("id") ON DELETE RESTRICT ON UPDATE NO ACTION;

ALTER TABLE "commission" ADD CONSTRAINT "commission_subject_user_id_fkey" FOREIGN KEY ("subject_user_id") REFERENCES "auth_user"("id") ON DELETE RESTRICT ON UPDATE NO ACTION;

ALTER TABLE "commission_milestone" ADD CONSTRAINT "commission_milestone_commission_id_fkey" FOREIGN KEY ("commission_id") REFERENCES "commission"("id") ON DELETE RESTRICT ON UPDATE NO ACTION;

ALTER TABLE "commission_payment_plan" ADD CONSTRAINT "commission_payment_plan_commission_id_fkey" FOREIGN KEY ("commission_id") REFERENCES "commission"("id") ON DELETE RESTRICT ON UPDATE NO ACTION;

ALTER TABLE "commission_payment" ADD CONSTRAINT "commission_payment_commission_id_fkey" FOREIGN KEY ("commission_id") REFERENCES "commission"("id") ON DELETE RESTRICT ON UPDATE NO ACTION;

ALTER TABLE "commission_payment" ADD CONSTRAINT "commission_payment_plan_id_fkey" FOREIGN KEY ("plan_id") REFERENCES "commission_payment_plan"("id") ON DELETE RESTRICT ON UPDATE NO ACTION;

ALTER TABLE "commission_payment" ADD CONSTRAINT "commission_payment_evidence_file_id_fkey" FOREIGN KEY ("evidence_file_id") REFERENCES "commission_file"("id") ON DELETE RESTRICT ON UPDATE NO ACTION;

ALTER TABLE "commission_change" ADD CONSTRAINT "commission_change_commission_id_fkey" FOREIGN KEY ("commission_id") REFERENCES "commission"("id") ON DELETE RESTRICT ON UPDATE NO ACTION;

ALTER TABLE "commission_issue" ADD CONSTRAINT "commission_issue_commission_id_fkey" FOREIGN KEY ("commission_id") REFERENCES "commission"("id") ON DELETE RESTRICT ON UPDATE NO ACTION;

ALTER TABLE "commission_issue" ADD CONSTRAINT "commission_issue_delivery_id_fkey" FOREIGN KEY ("delivery_id") REFERENCES "commission_delivery"("id") ON DELETE RESTRICT ON UPDATE NO ACTION;

ALTER TABLE "commission_file" ADD CONSTRAINT "commission_file_commission_id_fkey" FOREIGN KEY ("commission_id") REFERENCES "commission"("id") ON DELETE RESTRICT ON UPDATE NO ACTION;

ALTER TABLE "commission_file" ADD CONSTRAINT "commission_file_file_id_fkey" FOREIGN KEY ("file_id") REFERENCES "files_file_management"("id") ON DELETE RESTRICT ON UPDATE NO ACTION;

ALTER TABLE "commission_delivery" ADD CONSTRAINT "commission_delivery_commission_id_fkey" FOREIGN KEY ("commission_id") REFERENCES "commission"("id") ON DELETE RESTRICT ON UPDATE NO ACTION;

ALTER TABLE "commission_delivery_item" ADD CONSTRAINT "commission_delivery_item_delivery_id_fkey" FOREIGN KEY ("delivery_id") REFERENCES "commission_delivery"("id") ON DELETE RESTRICT ON UPDATE NO ACTION;

ALTER TABLE "commission_delivery_item" ADD CONSTRAINT "commission_delivery_item_file_id_fkey" FOREIGN KEY ("file_id") REFERENCES "commission_file"("id") ON DELETE RESTRICT ON UPDATE NO ACTION;

ALTER TABLE "commission_acceptance" ADD CONSTRAINT "commission_acceptance_commission_id_fkey" FOREIGN KEY ("commission_id") REFERENCES "commission"("id") ON DELETE RESTRICT ON UPDATE NO ACTION;

ALTER TABLE "commission_acceptance" ADD CONSTRAINT "commission_acceptance_delivery_id_fkey" FOREIGN KEY ("delivery_id") REFERENCES "commission_delivery"("id") ON DELETE RESTRICT ON UPDATE NO ACTION;

ALTER TABLE "commission_event" ADD CONSTRAINT "commission_event_commission_id_fkey" FOREIGN KEY ("commission_id") REFERENCES "commission"("id") ON DELETE RESTRICT ON UPDATE NO ACTION;

ALTER TABLE "commission_event" ADD CONSTRAINT "commission_event_actor_user_id_fkey" FOREIGN KEY ("actor_user_id") REFERENCES "auth_user"("id") ON DELETE RESTRICT ON UPDATE NO ACTION;

ALTER TABLE "contract" ADD COLUMN "commission_id" INTEGER;

ALTER TABLE "contract" ADD COLUMN "template_version_id" INTEGER;

ALTER TABLE "contract" ADD COLUMN "document_type" VARCHAR(255) NOT NULL DEFAULT 'AGREEMENT';

ALTER TABLE "contract" ADD COLUMN "source_record_id" INTEGER;

ALTER TABLE "contract" ADD COLUMN "snapshot_hash" CHAR(64);

ALTER TABLE "contract" ADD COLUMN "snapshot_json" TEXT;

ALTER TABLE "contract" ADD COLUMN "provider_session_id" VARCHAR(255);

ALTER TABLE "contract" ADD COLUMN "provider_ip" VARCHAR(255);

ALTER TABLE "contract" ADD COLUMN "provider_user_agent" TEXT;

ALTER TABLE "contract" ADD CONSTRAINT "contract_commission_id_fkey" FOREIGN KEY ("commission_id") REFERENCES "commission"("id") ON DELETE RESTRICT ON UPDATE NO ACTION;

ALTER TABLE "contract" ADD CONSTRAINT "contract_template_version_id_fkey" FOREIGN KEY ("template_version_id") REFERENCES "commission_contract_template_version"("id") ON DELETE RESTRICT ON UPDATE NO ACTION;

CREATE INDEX "idx_contract_commission_type_status" ON "contract" ("commission_id", "document_type", "status");
