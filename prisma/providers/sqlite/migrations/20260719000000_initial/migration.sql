-- CreateTable
CREATE TABLE "auth_session" (
    "id" TEXT NOT NULL PRIMARY KEY,
    "user_id" INTEGER NOT NULL,
    "token_hash" TEXT NOT NULL,
    "created_at" DATETIME NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "expires_at" DATETIME NOT NULL,
    "revoked_at" DATETIME,
    "ip" TEXT,
    "user_agent" TEXT,
    CONSTRAINT "auth_session_user_id_fkey" FOREIGN KEY ("user_id") REFERENCES "auth_user" ("id") ON DELETE CASCADE ON UPDATE NO ACTION
);

-- CreateTable
CREATE TABLE "auth_user" (
    "id" INTEGER NOT NULL PRIMARY KEY AUTOINCREMENT,
    "username" TEXT NOT NULL,
    "password" TEXT NOT NULL,
    "email" TEXT,
    "created_at" DATETIME NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "updated_at" DATETIME NOT NULL DEFAULT CURRENT_TIMESTAMP
);

-- CreateTable
CREATE TABLE "collections_project" (
    "id" INTEGER NOT NULL PRIMARY KEY AUTOINCREMENT,
    "project_name" TEXT NOT NULL,
    "avatar" TEXT,
    "weight" INTEGER NOT NULL,
    "status" INTEGER NOT NULL,
    "require_auth" BOOLEAN NOT NULL DEFAULT false,
    "created_at" DATETIME NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "updated_at" DATETIME NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "is_deleted" BOOLEAN NOT NULL DEFAULT false
);

-- CreateTable
CREATE TABLE "collections_project_menu" (
    "id" INTEGER NOT NULL PRIMARY KEY AUTOINCREMENT,
    "project_id" INTEGER NOT NULL,
    "parent_id" INTEGER,
    "label" TEXT NOT NULL,
    "url" TEXT,
    "is_external" BOOLEAN NOT NULL DEFAULT false,
    "weight" INTEGER NOT NULL DEFAULT 0,
    "status" INTEGER NOT NULL DEFAULT 1,
    "created_at" DATETIME NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "updated_at" DATETIME NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "is_deleted" BOOLEAN NOT NULL DEFAULT false,
    CONSTRAINT "collections_project_menu_project_id_fkey" FOREIGN KEY ("project_id") REFERENCES "collections_project" ("id") ON DELETE CASCADE ON UPDATE NO ACTION,
    CONSTRAINT "collections_project_menu_parent_id_fkey" FOREIGN KEY ("parent_id") REFERENCES "collections_project_menu" ("id") ON DELETE CASCADE ON UPDATE NO ACTION
);

-- CreateTable
CREATE TABLE "collections_project_home" (
    "id" INTEGER NOT NULL PRIMARY KEY AUTOINCREMENT,
    "project_id" INTEGER NOT NULL,
    "content" TEXT NOT NULL,
    "status" INTEGER NOT NULL DEFAULT 1,
    "created_at" DATETIME NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "updated_at" DATETIME NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "is_deleted" BOOLEAN NOT NULL DEFAULT false,
    CONSTRAINT "collections_project_home_project_id_fkey" FOREIGN KEY ("project_id") REFERENCES "collections_project" ("id") ON DELETE CASCADE ON UPDATE NO ACTION
);

-- CreateTable
CREATE TABLE "collections_project_version" (
    "id" INTEGER NOT NULL PRIMARY KEY AUTOINCREMENT,
    "project_id" INTEGER NOT NULL,
    "version" TEXT NOT NULL,
    "description" TEXT,
    "weight" INTEGER NOT NULL,
    "status" INTEGER NOT NULL,
    "created_at" DATETIME NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "updated_at" DATETIME NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "is_deleted" BOOLEAN NOT NULL DEFAULT false,
    CONSTRAINT "collections_project_version_project_id_fkey" FOREIGN KEY ("project_id") REFERENCES "collections_project" ("id") ON DELETE NO ACTION ON UPDATE NO ACTION
);

-- CreateTable
CREATE TABLE "collections_category" (
    "id" INTEGER NOT NULL PRIMARY KEY AUTOINCREMENT,
    "project_version_id" INTEGER NOT NULL,
    "category_name" TEXT NOT NULL,
    "weight" INTEGER NOT NULL,
    "status" INTEGER NOT NULL,
    "created_at" DATETIME NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "updated_at" DATETIME NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "is_deleted" BOOLEAN NOT NULL DEFAULT false,
    CONSTRAINT "collections_category_project_version_id_fkey" FOREIGN KEY ("project_version_id") REFERENCES "collections_project_version" ("id") ON DELETE NO ACTION ON UPDATE NO ACTION
);

-- CreateTable
CREATE TABLE "docs_note_info" (
    "id" INTEGER NOT NULL PRIMARY KEY AUTOINCREMENT,
    "category_id" INTEGER NOT NULL,
    "note_title" TEXT NOT NULL,
    "weight" INTEGER NOT NULL,
    "status" INTEGER NOT NULL,
    "content_revision" INTEGER NOT NULL DEFAULT 0,
    "created_at" DATETIME NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "updated_at" DATETIME NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "is_deleted" BOOLEAN NOT NULL DEFAULT false,
    CONSTRAINT "docs_note_info_category_id_fkey" FOREIGN KEY ("category_id") REFERENCES "collections_category" ("id") ON DELETE NO ACTION ON UPDATE NO ACTION
);

-- CreateTable
CREATE TABLE "docs_note_content" (
    "id" INTEGER NOT NULL PRIMARY KEY AUTOINCREMENT,
    "note_info_id" INTEGER NOT NULL,
    "content" TEXT NOT NULL,
    "version_note" TEXT,
    "is_primary" BOOLEAN NOT NULL DEFAULT false,
    "status" INTEGER NOT NULL,
    "created_at" DATETIME NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "updated_at" DATETIME NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "is_deleted" BOOLEAN NOT NULL DEFAULT false,
    CONSTRAINT "docs_note_content_note_info_id_fkey" FOREIGN KEY ("note_info_id") REFERENCES "docs_note_info" ("id") ON DELETE NO ACTION ON UPDATE NO ACTION
);

-- CreateTable
CREATE TABLE "files_file_management" (
    "id" INTEGER NOT NULL PRIMARY KEY AUTOINCREMENT,
    "original_name" TEXT NOT NULL,
    "file_name" TEXT NOT NULL,
    "file_path" TEXT NOT NULL,
    "file_size" BIGINT NOT NULL,
    "business_type" TEXT NOT NULL,
    "status" INTEGER NOT NULL DEFAULT 1,
    "create_time" DATETIME NOT NULL DEFAULT CURRENT_TIMESTAMP
);

-- CreateTable
CREATE TABLE "system_config" (
    "id" INTEGER NOT NULL PRIMARY KEY AUTOINCREMENT,
    "config_key" TEXT NOT NULL,
    "config_value" TEXT NOT NULL,
    "description" TEXT,
    "created_at" DATETIME NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "updated_at" DATETIME NOT NULL DEFAULT CURRENT_TIMESTAMP
);

-- CreateTable
CREATE TABLE "system_homepage" (
    "id" INTEGER NOT NULL PRIMARY KEY AUTOINCREMENT,
    "content" TEXT NOT NULL,
    "status" INTEGER NOT NULL DEFAULT 1,
    "created_at" DATETIME NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "updated_at" DATETIME NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "is_deleted" BOOLEAN NOT NULL DEFAULT false
);

-- CreateTable
CREATE TABLE "system_installation" (
    "id" INTEGER NOT NULL PRIMARY KEY AUTOINCREMENT,
    "provider" TEXT NOT NULL,
    "status" TEXT NOT NULL,
    "schema_revision" INTEGER NOT NULL,
    "installation_id" TEXT NOT NULL,
    "created_at" DATETIME NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "updated_at" DATETIME NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "installed_at" DATETIME
);

-- CreateTable
CREATE TABLE "system_runtime_lock" (
    "key" TEXT NOT NULL PRIMARY KEY,
    "revision" INTEGER NOT NULL DEFAULT 0,
    "updated_at" DATETIME NOT NULL DEFAULT CURRENT_TIMESTAMP
);

-- CreateTable
CREATE TABLE "solana_merkle_tree" (
    "id" INTEGER NOT NULL PRIMARY KEY AUTOINCREMENT,
    "name" TEXT NOT NULL,
    "tree_address" TEXT NOT NULL,
    "tree_authority" TEXT NOT NULL,
    "encrypted_key" TEXT NOT NULL,
    "creator_address" TEXT NOT NULL,
    "max_depth" INTEGER NOT NULL,
    "max_buffer_size" INTEGER NOT NULL,
    "canopy_depth" INTEGER NOT NULL,
    "network" TEXT NOT NULL DEFAULT 'devnet',
    "total_minted" INTEGER NOT NULL DEFAULT 0,
    "max_capacity" BIGINT NOT NULL,
    "remaining_capacity" BIGINT NOT NULL DEFAULT 0,
    "capacity_revision" INTEGER NOT NULL DEFAULT 0,
    "creation_cost" BIGINT NOT NULL,
    "tx_signature" TEXT,
    "priority" INTEGER NOT NULL DEFAULT 0,
    "status" INTEGER NOT NULL DEFAULT 0,
    "created_at" DATETIME NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "updated_at" DATETIME NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "is_deleted" BOOLEAN NOT NULL DEFAULT false
);

-- CreateTable
CREATE TABLE "solana_compressed_nft" (
    "id" INTEGER NOT NULL PRIMARY KEY AUTOINCREMENT,
    "merkle_tree_id" INTEGER NOT NULL,
    "project_id" INTEGER NOT NULL,
    "asset_id" TEXT NOT NULL,
    "leaf_index" INTEGER NOT NULL,
    "name" TEXT NOT NULL,
    "symbol" TEXT,
    "description" TEXT,
    "metadata_uri" TEXT,
    "image_cid" TEXT,
    "metadata_cid" TEXT,
    "original_image_id" INTEGER,
    "owner_address" TEXT NOT NULL,
    "mint_tx_signature" TEXT,
    "prepare_expires_at" DATETIME,
    "last_valid_block_height" BIGINT,
    "capacity_reserved" BOOLEAN NOT NULL DEFAULT false,
    "status" INTEGER NOT NULL DEFAULT 0,
    "created_at" DATETIME NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "updated_at" DATETIME NOT NULL DEFAULT CURRENT_TIMESTAMP,
    CONSTRAINT "solana_compressed_nft_merkle_tree_id_fkey" FOREIGN KEY ("merkle_tree_id") REFERENCES "solana_merkle_tree" ("id") ON DELETE CASCADE ON UPDATE NO ACTION
);

-- CreateIndex
CREATE UNIQUE INDEX "uq_auth_session_token_hash" ON "auth_session"("token_hash");

-- CreateIndex
CREATE INDEX "idx_auth_session_expires_at" ON "auth_session"("expires_at");

-- CreateIndex
CREATE INDEX "idx_auth_session_user_id" ON "auth_session"("user_id");

-- CreateIndex
CREATE UNIQUE INDEX "uq_auth_user_username" ON "auth_user"("username");

-- CreateIndex
CREATE INDEX "idx_collections_project_menu_project_id" ON "collections_project_menu"("project_id");

-- CreateIndex
CREATE INDEX "idx_collections_project_menu_parent_id" ON "collections_project_menu"("parent_id");

-- CreateIndex
CREATE UNIQUE INDEX "uq_collections_project_home_project_id" ON "collections_project_home"("project_id");

-- CreateIndex
CREATE INDEX "idx_collections_project_home_project_id" ON "collections_project_home"("project_id");

-- CreateIndex
CREATE INDEX "idx_collections_project_version_project_id" ON "collections_project_version"("project_id");

-- CreateIndex
CREATE INDEX "idx_collections_category_project_version_id" ON "collections_category"("project_version_id");

-- CreateIndex
CREATE INDEX "idx_docs_note_info_category_id" ON "docs_note_info"("category_id");

-- CreateIndex
CREATE INDEX "idx_docs_note_content_note_info_id" ON "docs_note_content"("note_info_id");

-- CreateIndex
CREATE UNIQUE INDEX "uq_system_config_key" ON "system_config"("config_key");

-- CreateIndex
CREATE UNIQUE INDEX "uq_system_installation_id" ON "system_installation"("installation_id");

-- CreateIndex
CREATE UNIQUE INDEX "uq_solana_merkle_tree_address" ON "solana_merkle_tree"("tree_address");

-- CreateIndex
CREATE INDEX "idx_solana_merkle_tree_network_status" ON "solana_merkle_tree"("network", "status");

-- CreateIndex
CREATE INDEX "idx_solana_merkle_tree_creator" ON "solana_merkle_tree"("creator_address");

-- CreateIndex
CREATE UNIQUE INDEX "uq_solana_compressed_nft_asset_id" ON "solana_compressed_nft"("asset_id");

-- CreateIndex
CREATE UNIQUE INDEX "uq_solana_compressed_nft_mint_tx" ON "solana_compressed_nft"("mint_tx_signature");

-- CreateIndex
CREATE INDEX "idx_solana_compressed_nft_merkle_tree_id" ON "solana_compressed_nft"("merkle_tree_id");

-- CreateIndex
CREATE INDEX "idx_solana_compressed_nft_project_id" ON "solana_compressed_nft"("project_id");

-- CreateIndex
CREATE INDEX "idx_solana_compressed_nft_owner" ON "solana_compressed_nft"("owner_address");

-- CreateIndex
CREATE INDEX "idx_solana_compressed_nft_project_owner" ON "solana_compressed_nft"("project_id", "owner_address");
-- Seed portable Solana tree-priority locks
INSERT INTO "system_runtime_lock" ("key", "revision", "updated_at") VALUES
    ('solana-tree-priority:mainnet', 0, CURRENT_TIMESTAMP),
    ('solana-tree-priority:devnet', 0, CURRENT_TIMESTAMP);
