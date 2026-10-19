-- Plugin metadata only; existing gift-card tables and all business rows are retained.
CREATE TABLE "plugin_installation" (
  "id" SERIAL PRIMARY KEY,
  "plugin_id" VARCHAR(128) NOT NULL,
  "version" VARCHAR(128) NOT NULL,
  "digest" VARCHAR(128) NOT NULL,
  "manifest_json" TEXT NOT NULL,
  "config_ciphertext" TEXT NOT NULL DEFAULT '',
  "access_bindings_json" TEXT NOT NULL DEFAULT '{}',
  "installed" BOOLEAN NOT NULL DEFAULT TRUE,
  "enabled" BOOLEAN NOT NULL DEFAULT FALSE,
  "generation" INTEGER NOT NULL DEFAULT 1,
  "source" VARCHAR(255),
  "error" VARCHAR(255),
  "created_at" TIMESTAMPTZ(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
  "updated_at" TIMESTAMPTZ(3) NOT NULL DEFAULT CURRENT_TIMESTAMP
);

CREATE UNIQUE INDEX "plugin_installation_plugin_id_key" ON "plugin_installation" ("plugin_id");

CREATE TABLE "plugin_package" (
  "id" SERIAL PRIMARY KEY,
  "plugin_id" VARCHAR(128) NOT NULL,
  "version" VARCHAR(128) NOT NULL,
  "digest" VARCHAR(128) NOT NULL,
  "manifest_json" TEXT NOT NULL,
  "created_at" TIMESTAMPTZ(3) NOT NULL DEFAULT CURRENT_TIMESTAMP
);

CREATE UNIQUE INDEX "plugin_package_digest_key" ON "plugin_package" ("digest");

CREATE TABLE "plugin_owned_table" (
  "id" SERIAL PRIMARY KEY,
  "plugin_id" VARCHAR(128) NOT NULL,
  "name" VARCHAR(128) NOT NULL,
  "descriptor_json" TEXT NOT NULL
);

CREATE UNIQUE INDEX "plugin_owned_table_name_key" ON "plugin_owned_table" ("name");

CREATE TABLE "plugin_migration" (
  "id" SERIAL PRIMARY KEY,
  "plugin_id" VARCHAR(128) NOT NULL,
  "key" VARCHAR(128) NOT NULL,
  "digest" VARCHAR(128) NOT NULL,
  "created_at" TIMESTAMPTZ(3) NOT NULL DEFAULT CURRENT_TIMESTAMP
);

CREATE UNIQUE INDEX "plugin_migration_identity" ON "plugin_migration" ("plugin_id", "key");

CREATE TABLE "plugin_operation" (
  "id" SERIAL PRIMARY KEY,
  "plugin_id" VARCHAR(128) NOT NULL,
  "action" VARCHAR(128) NOT NULL,
  "status" VARCHAR(128) NOT NULL DEFAULT 'RUNNING',
  "phase" VARCHAR(128) NOT NULL,
  "payload_json" TEXT NOT NULL DEFAULT '{}',
  "error" VARCHAR(255),
  "actor_user_id" INTEGER,
  "created_at" TIMESTAMPTZ(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
  "updated_at" TIMESTAMPTZ(3) NOT NULL DEFAULT CURRENT_TIMESTAMP
);

CREATE TABLE "plugin_task" (
  "id" SERIAL PRIMARY KEY,
  "plugin_id" VARCHAR(128) NOT NULL,
  "task_key" VARCHAR(255) NOT NULL,
  "kind" VARCHAR(128) NOT NULL,
  "handler" VARCHAR(128) NOT NULL,
  "payload_json" TEXT NOT NULL DEFAULT 'null',
  "status" VARCHAR(128) NOT NULL DEFAULT 'PENDING',
  "attempts" INTEGER NOT NULL DEFAULT 0,
  "run_at" TIMESTAMPTZ(3) NOT NULL,
  "error" VARCHAR(255),
  "created_at" TIMESTAMPTZ(3) NOT NULL DEFAULT CURRENT_TIMESTAMP
);

CREATE UNIQUE INDEX "plugin_task_task_key_key" ON "plugin_task" ("task_key");

CREATE INDEX "plugin_task_due" ON "plugin_task" ("status", "run_at");

CREATE TABLE "plugin_point_receipt" (
  "id" SERIAL PRIMARY KEY,
  "plugin_id" VARCHAR(128) NOT NULL,
  "source_key" VARCHAR(255) NOT NULL,
  "user_id" INTEGER,
  "amount" INTEGER NOT NULL,
  "balance_after" INTEGER NOT NULL,
  "created_at" TIMESTAMPTZ(3) NOT NULL DEFAULT CURRENT_TIMESTAMP
);

CREATE UNIQUE INDEX "plugin_point_receipt_identity" ON "plugin_point_receipt" ("plugin_id", "source_key");
