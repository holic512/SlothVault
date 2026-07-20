-- CreateSchema
CREATE SCHEMA IF NOT EXISTS "public";

-- CreateTable
CREATE TABLE "auth_session" (
    "id" UUID NOT NULL,
    "user_id" INTEGER NOT NULL,
    "token_hash" VARCHAR(128) NOT NULL,
    "created_at" TIMESTAMPTZ(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "expires_at" TIMESTAMPTZ(3) NOT NULL,
    "revoked_at" TIMESTAMPTZ(3),
    "ip" VARCHAR(255),
    "user_agent" TEXT,

    CONSTRAINT "auth_session_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "auth_user" (
    "id" SERIAL NOT NULL,
    "username" VARCHAR(255) NOT NULL,
    "password" VARCHAR(255) NOT NULL,
    "email" VARCHAR(255),
    "created_at" TIMESTAMPTZ(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "updated_at" TIMESTAMPTZ(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,

    CONSTRAINT "auth_user_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "collections_project" (
    "id" SERIAL NOT NULL,
    "project_name" VARCHAR(128) NOT NULL,
    "avatar" VARCHAR(500),
    "weight" INTEGER NOT NULL,
    "status" SMALLINT NOT NULL,
    "require_auth" BOOLEAN NOT NULL DEFAULT false,
    "created_at" TIMESTAMPTZ(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "updated_at" TIMESTAMPTZ(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "is_deleted" BOOLEAN NOT NULL DEFAULT false,

    CONSTRAINT "collections_project_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "collections_project_menu" (
    "id" SERIAL NOT NULL,
    "project_id" INTEGER NOT NULL,
    "parent_id" INTEGER,
    "label" VARCHAR(64) NOT NULL,
    "url" VARCHAR(2048),
    "is_external" BOOLEAN NOT NULL DEFAULT false,
    "weight" INTEGER NOT NULL DEFAULT 0,
    "status" SMALLINT NOT NULL DEFAULT 1,
    "created_at" TIMESTAMPTZ(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "updated_at" TIMESTAMPTZ(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "is_deleted" BOOLEAN NOT NULL DEFAULT false,

    CONSTRAINT "collections_project_menu_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "collections_project_home" (
    "id" SERIAL NOT NULL,
    "project_id" INTEGER NOT NULL,
    "content" TEXT NOT NULL,
    "status" SMALLINT NOT NULL DEFAULT 1,
    "created_at" TIMESTAMPTZ(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "updated_at" TIMESTAMPTZ(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "is_deleted" BOOLEAN NOT NULL DEFAULT false,

    CONSTRAINT "collections_project_home_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "collections_project_version" (
    "id" SERIAL NOT NULL,
    "project_id" INTEGER NOT NULL,
    "version" VARCHAR(64) NOT NULL,
    "description" TEXT,
    "weight" INTEGER NOT NULL,
    "status" SMALLINT NOT NULL,
    "created_at" TIMESTAMPTZ(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "updated_at" TIMESTAMPTZ(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "is_deleted" BOOLEAN NOT NULL DEFAULT false,

    CONSTRAINT "collections_project_version_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "collections_category" (
    "id" SERIAL NOT NULL,
    "project_version_id" INTEGER NOT NULL,
    "category_name" VARCHAR(64) NOT NULL,
    "weight" INTEGER NOT NULL,
    "status" SMALLINT NOT NULL,
    "created_at" TIMESTAMPTZ(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "updated_at" TIMESTAMPTZ(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "is_deleted" BOOLEAN NOT NULL DEFAULT false,

    CONSTRAINT "collections_category_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "docs_note_info" (
    "id" SERIAL NOT NULL,
    "category_id" INTEGER NOT NULL,
    "note_title" VARCHAR(255) NOT NULL,
    "weight" INTEGER NOT NULL,
    "status" SMALLINT NOT NULL,
    "content_revision" INTEGER NOT NULL DEFAULT 0,
    "created_at" TIMESTAMPTZ(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "updated_at" TIMESTAMPTZ(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "is_deleted" BOOLEAN NOT NULL DEFAULT false,

    CONSTRAINT "docs_note_info_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "docs_note_content" (
    "id" SERIAL NOT NULL,
    "note_info_id" INTEGER NOT NULL,
    "content" TEXT NOT NULL,
    "version_note" VARCHAR(255),
    "is_primary" BOOLEAN NOT NULL DEFAULT false,
    "status" SMALLINT NOT NULL,
    "created_at" TIMESTAMPTZ(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "updated_at" TIMESTAMPTZ(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "is_deleted" BOOLEAN NOT NULL DEFAULT false,

    CONSTRAINT "docs_note_content_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "files_file_management" (
    "id" SERIAL NOT NULL,
    "original_name" VARCHAR(255) NOT NULL,
    "file_name" VARCHAR(255) NOT NULL,
    "file_path" VARCHAR(500) NOT NULL,
    "file_size" BIGINT NOT NULL,
    "business_type" VARCHAR(50) NOT NULL,
    "status" SMALLINT NOT NULL DEFAULT 1,
    "create_time" TIMESTAMPTZ(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,

    CONSTRAINT "files_file_management_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "system_config" (
    "id" SERIAL NOT NULL,
    "config_key" VARCHAR(100) NOT NULL,
    "config_value" VARCHAR(500) NOT NULL,
    "description" VARCHAR(255),
    "created_at" TIMESTAMPTZ(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "updated_at" TIMESTAMPTZ(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,

    CONSTRAINT "system_config_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "system_homepage" (
    "id" SERIAL NOT NULL,
    "content" TEXT NOT NULL,
    "status" SMALLINT NOT NULL DEFAULT 1,
    "created_at" TIMESTAMPTZ(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "updated_at" TIMESTAMPTZ(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "is_deleted" BOOLEAN NOT NULL DEFAULT false,

    CONSTRAINT "system_homepage_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "system_installation" (
    "id" INTEGER NOT NULL,
    "provider" VARCHAR(20) NOT NULL,
    "status" VARCHAR(32) NOT NULL,
    "schema_revision" INTEGER NOT NULL,
    "installation_id" UUID NOT NULL,
    "created_at" TIMESTAMPTZ(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "updated_at" TIMESTAMPTZ(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "installed_at" TIMESTAMPTZ(3),

    CONSTRAINT "system_installation_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "system_runtime_lock" (
    "key" VARCHAR(128) NOT NULL,
    "revision" INTEGER NOT NULL DEFAULT 0,
    "updated_at" TIMESTAMPTZ(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,

    CONSTRAINT "system_runtime_lock_pkey" PRIMARY KEY ("key")
);

-- CreateTable
CREATE TABLE "solana_merkle_tree" (
    "id" SERIAL NOT NULL,
    "name" VARCHAR(128) NOT NULL,
    "tree_address" VARCHAR(64) NOT NULL,
    "tree_authority" VARCHAR(64) NOT NULL,
    "encrypted_key" TEXT NOT NULL,
    "creator_address" VARCHAR(64) NOT NULL,
    "max_depth" SMALLINT NOT NULL,
    "max_buffer_size" SMALLINT NOT NULL,
    "canopy_depth" SMALLINT NOT NULL,
    "network" VARCHAR(20) NOT NULL DEFAULT 'devnet',
    "total_minted" INTEGER NOT NULL DEFAULT 0,
    "max_capacity" BIGINT NOT NULL,
    "remaining_capacity" BIGINT NOT NULL DEFAULT 0,
    "capacity_revision" INTEGER NOT NULL DEFAULT 0,
    "creation_cost" BIGINT NOT NULL,
    "tx_signature" VARCHAR(128),
    "priority" INTEGER NOT NULL DEFAULT 0,
    "status" SMALLINT NOT NULL DEFAULT 0,
    "created_at" TIMESTAMPTZ(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "updated_at" TIMESTAMPTZ(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "is_deleted" BOOLEAN NOT NULL DEFAULT false,

    CONSTRAINT "solana_merkle_tree_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "solana_compressed_nft" (
    "id" SERIAL NOT NULL,
    "merkle_tree_id" INTEGER NOT NULL,
    "project_id" INTEGER NOT NULL,
    "asset_id" VARCHAR(64) NOT NULL,
    "leaf_index" INTEGER NOT NULL,
    "name" VARCHAR(128) NOT NULL,
    "symbol" VARCHAR(32),
    "description" TEXT,
    "metadata_uri" VARCHAR(500),
    "image_cid" VARCHAR(128),
    "metadata_cid" VARCHAR(128),
    "original_image_id" INTEGER,
    "owner_address" VARCHAR(64) NOT NULL,
    "mint_tx_signature" VARCHAR(128),
    "prepare_expires_at" TIMESTAMPTZ(3),
    "last_valid_block_height" BIGINT,
    "capacity_reserved" BOOLEAN NOT NULL DEFAULT false,
    "status" SMALLINT NOT NULL DEFAULT 0,
    "created_at" TIMESTAMPTZ(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "updated_at" TIMESTAMPTZ(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,

    CONSTRAINT "solana_compressed_nft_pkey" PRIMARY KEY ("id")
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

-- AddForeignKey
ALTER TABLE "auth_session" ADD CONSTRAINT "auth_session_user_id_fkey" FOREIGN KEY ("user_id") REFERENCES "auth_user"("id") ON DELETE CASCADE ON UPDATE NO ACTION;

-- AddForeignKey
ALTER TABLE "collections_project_menu" ADD CONSTRAINT "collections_project_menu_project_id_fkey" FOREIGN KEY ("project_id") REFERENCES "collections_project"("id") ON DELETE CASCADE ON UPDATE NO ACTION;

-- AddForeignKey
ALTER TABLE "collections_project_menu" ADD CONSTRAINT "collections_project_menu_parent_id_fkey" FOREIGN KEY ("parent_id") REFERENCES "collections_project_menu"("id") ON DELETE CASCADE ON UPDATE NO ACTION;

-- AddForeignKey
ALTER TABLE "collections_project_home" ADD CONSTRAINT "collections_project_home_project_id_fkey" FOREIGN KEY ("project_id") REFERENCES "collections_project"("id") ON DELETE CASCADE ON UPDATE NO ACTION;

-- AddForeignKey
ALTER TABLE "collections_project_version" ADD CONSTRAINT "collections_project_version_project_id_fkey" FOREIGN KEY ("project_id") REFERENCES "collections_project"("id") ON DELETE NO ACTION ON UPDATE NO ACTION;

-- AddForeignKey
ALTER TABLE "collections_category" ADD CONSTRAINT "collections_category_project_version_id_fkey" FOREIGN KEY ("project_version_id") REFERENCES "collections_project_version"("id") ON DELETE NO ACTION ON UPDATE NO ACTION;

-- AddForeignKey
ALTER TABLE "docs_note_info" ADD CONSTRAINT "docs_note_info_category_id_fkey" FOREIGN KEY ("category_id") REFERENCES "collections_category"("id") ON DELETE NO ACTION ON UPDATE NO ACTION;

-- AddForeignKey
ALTER TABLE "docs_note_content" ADD CONSTRAINT "docs_note_content_note_info_id_fkey" FOREIGN KEY ("note_info_id") REFERENCES "docs_note_info"("id") ON DELETE NO ACTION ON UPDATE NO ACTION;

-- AddForeignKey
ALTER TABLE "solana_compressed_nft" ADD CONSTRAINT "solana_compressed_nft_merkle_tree_id_fkey" FOREIGN KEY ("merkle_tree_id") REFERENCES "solana_merkle_tree"("id") ON DELETE CASCADE ON UPDATE NO ACTION;
-- Seed portable Solana tree-priority locks
INSERT INTO "system_runtime_lock" ("key", "revision", "updated_at") VALUES
    ('solana-tree-priority:mainnet', 0, CURRENT_TIMESTAMP),
    ('solana-tree-priority:devnet', 0, CURRENT_TIMESTAMP);
