-- Plugin metadata only; existing gift-card tables and all business rows are retained.
CREATE TABLE "plugin_installation" (
  "id" INTEGER PRIMARY KEY AUTOINCREMENT,
  "plugin_id" TEXT NOT NULL,
  "version" TEXT NOT NULL,
  "digest" TEXT NOT NULL,
  "manifest_json" TEXT NOT NULL,
  "config_ciphertext" TEXT NOT NULL DEFAULT '',
  "access_bindings_json" TEXT NOT NULL DEFAULT '{}',
  "installed" INTEGER NOT NULL DEFAULT 1,
  "enabled" INTEGER NOT NULL DEFAULT 0,
  "generation" INTEGER NOT NULL DEFAULT 1,
  "source" TEXT,
  "error" TEXT,
  "created_at" TEXT NOT NULL DEFAULT CURRENT_TIMESTAMP,
  "updated_at" TEXT NOT NULL DEFAULT CURRENT_TIMESTAMP
);

CREATE UNIQUE INDEX "plugin_installation_plugin_id_key" ON "plugin_installation" ("plugin_id");

CREATE TABLE "plugin_package" (
  "id" INTEGER PRIMARY KEY AUTOINCREMENT,
  "plugin_id" TEXT NOT NULL,
  "version" TEXT NOT NULL,
  "digest" TEXT NOT NULL,
  "manifest_json" TEXT NOT NULL,
  "created_at" TEXT NOT NULL DEFAULT CURRENT_TIMESTAMP
);

CREATE UNIQUE INDEX "plugin_package_digest_key" ON "plugin_package" ("digest");

CREATE TABLE "plugin_owned_table" (
  "id" INTEGER PRIMARY KEY AUTOINCREMENT,
  "plugin_id" TEXT NOT NULL,
  "name" TEXT NOT NULL,
  "descriptor_json" TEXT NOT NULL
);

CREATE UNIQUE INDEX "plugin_owned_table_name_key" ON "plugin_owned_table" ("name");

CREATE TABLE "plugin_migration" (
  "id" INTEGER PRIMARY KEY AUTOINCREMENT,
  "plugin_id" TEXT NOT NULL,
  "key" TEXT NOT NULL,
  "digest" TEXT NOT NULL,
  "created_at" TEXT NOT NULL DEFAULT CURRENT_TIMESTAMP
);

CREATE UNIQUE INDEX "plugin_migration_identity" ON "plugin_migration" ("plugin_id", "key");

CREATE TABLE "plugin_operation" (
  "id" INTEGER PRIMARY KEY AUTOINCREMENT,
  "plugin_id" TEXT NOT NULL,
  "action" TEXT NOT NULL,
  "status" TEXT NOT NULL DEFAULT 'RUNNING',
  "phase" TEXT NOT NULL,
  "payload_json" TEXT NOT NULL DEFAULT '{}',
  "error" TEXT,
  "actor_user_id" INTEGER,
  "created_at" TEXT NOT NULL DEFAULT CURRENT_TIMESTAMP,
  "updated_at" TEXT NOT NULL DEFAULT CURRENT_TIMESTAMP
);

CREATE TABLE "plugin_task" (
  "id" INTEGER PRIMARY KEY AUTOINCREMENT,
  "plugin_id" TEXT NOT NULL,
  "task_key" TEXT NOT NULL,
  "kind" TEXT NOT NULL,
  "handler" TEXT NOT NULL,
  "payload_json" TEXT NOT NULL DEFAULT 'null',
  "status" TEXT NOT NULL DEFAULT 'PENDING',
  "attempts" INTEGER NOT NULL DEFAULT 0,
  "run_at" TEXT NOT NULL,
  "error" TEXT,
  "created_at" TEXT NOT NULL DEFAULT CURRENT_TIMESTAMP
);

CREATE UNIQUE INDEX "plugin_task_task_key_key" ON "plugin_task" ("task_key");

CREATE INDEX "plugin_task_due" ON "plugin_task" ("status", "run_at");

CREATE TABLE "plugin_point_receipt" (
  "id" INTEGER PRIMARY KEY AUTOINCREMENT,
  "plugin_id" TEXT NOT NULL,
  "source_key" TEXT NOT NULL,
  "user_id" INTEGER,
  "amount" INTEGER NOT NULL,
  "balance_after" INTEGER NOT NULL,
  "created_at" TEXT NOT NULL DEFAULT CURRENT_TIMESTAMP
);

CREATE UNIQUE INDEX "plugin_point_receipt_identity" ON "plugin_point_receipt" ("plugin_id", "source_key");
