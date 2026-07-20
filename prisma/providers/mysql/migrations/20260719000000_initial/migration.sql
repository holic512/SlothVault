-- CreateTable
CREATE TABLE `auth_session` (
    `id` CHAR(36) NOT NULL,
    `user_id` INTEGER NOT NULL,
    `token_hash` VARCHAR(128) NOT NULL,
    `created_at` DATETIME(3) NOT NULL DEFAULT CURRENT_TIMESTAMP(3),
    `expires_at` DATETIME(3) NOT NULL,
    `revoked_at` DATETIME(3) NULL,
    `ip` VARCHAR(255) NULL,
    `user_agent` TEXT NULL,

    UNIQUE INDEX `uq_auth_session_token_hash`(`token_hash`),
    INDEX `idx_auth_session_expires_at`(`expires_at`),
    INDEX `idx_auth_session_user_id`(`user_id`),
    PRIMARY KEY (`id`)
) DEFAULT CHARACTER SET utf8mb4 COLLATE utf8mb4_unicode_ci;

-- CreateTable
CREATE TABLE `auth_user` (
    `id` INTEGER NOT NULL AUTO_INCREMENT,
    `username` VARCHAR(255) NOT NULL,
    `password` VARCHAR(255) NOT NULL,
    `email` VARCHAR(255) NULL,
    `created_at` DATETIME(3) NOT NULL DEFAULT CURRENT_TIMESTAMP(3),
    `updated_at` DATETIME(3) NOT NULL DEFAULT CURRENT_TIMESTAMP(3),

    UNIQUE INDEX `uq_auth_user_username`(`username`),
    PRIMARY KEY (`id`)
) DEFAULT CHARACTER SET utf8mb4 COLLATE utf8mb4_unicode_ci;

-- CreateTable
CREATE TABLE `collections_project` (
    `id` INTEGER NOT NULL AUTO_INCREMENT,
    `project_name` VARCHAR(128) NOT NULL,
    `avatar` VARCHAR(500) NULL,
    `weight` INTEGER NOT NULL,
    `status` SMALLINT NOT NULL,
    `require_auth` BOOLEAN NOT NULL DEFAULT false,
    `created_at` DATETIME(3) NOT NULL DEFAULT CURRENT_TIMESTAMP(3),
    `updated_at` DATETIME(3) NOT NULL DEFAULT CURRENT_TIMESTAMP(3),
    `is_deleted` BOOLEAN NOT NULL DEFAULT false,

    PRIMARY KEY (`id`)
) DEFAULT CHARACTER SET utf8mb4 COLLATE utf8mb4_unicode_ci;

-- CreateTable
CREATE TABLE `collections_project_menu` (
    `id` INTEGER NOT NULL AUTO_INCREMENT,
    `project_id` INTEGER NOT NULL,
    `parent_id` INTEGER NULL,
    `label` VARCHAR(64) NOT NULL,
    `url` VARCHAR(2048) NULL,
    `is_external` BOOLEAN NOT NULL DEFAULT false,
    `weight` INTEGER NOT NULL DEFAULT 0,
    `status` SMALLINT NOT NULL DEFAULT 1,
    `created_at` DATETIME(3) NOT NULL DEFAULT CURRENT_TIMESTAMP(3),
    `updated_at` DATETIME(3) NOT NULL DEFAULT CURRENT_TIMESTAMP(3),
    `is_deleted` BOOLEAN NOT NULL DEFAULT false,

    INDEX `idx_collections_project_menu_project_id`(`project_id`),
    INDEX `idx_collections_project_menu_parent_id`(`parent_id`),
    PRIMARY KEY (`id`)
) DEFAULT CHARACTER SET utf8mb4 COLLATE utf8mb4_unicode_ci;

-- CreateTable
CREATE TABLE `collections_project_home` (
    `id` INTEGER NOT NULL AUTO_INCREMENT,
    `project_id` INTEGER NOT NULL,
    `content` LONGTEXT NOT NULL,
    `status` SMALLINT NOT NULL DEFAULT 1,
    `created_at` DATETIME(3) NOT NULL DEFAULT CURRENT_TIMESTAMP(3),
    `updated_at` DATETIME(3) NOT NULL DEFAULT CURRENT_TIMESTAMP(3),
    `is_deleted` BOOLEAN NOT NULL DEFAULT false,

    UNIQUE INDEX `uq_collections_project_home_project_id`(`project_id`),
    INDEX `idx_collections_project_home_project_id`(`project_id`),
    PRIMARY KEY (`id`)
) DEFAULT CHARACTER SET utf8mb4 COLLATE utf8mb4_unicode_ci;

-- CreateTable
CREATE TABLE `collections_project_version` (
    `id` INTEGER NOT NULL AUTO_INCREMENT,
    `project_id` INTEGER NOT NULL,
    `version` VARCHAR(64) NOT NULL,
    `description` TEXT NULL,
    `weight` INTEGER NOT NULL,
    `status` SMALLINT NOT NULL,
    `created_at` DATETIME(3) NOT NULL DEFAULT CURRENT_TIMESTAMP(3),
    `updated_at` DATETIME(3) NOT NULL DEFAULT CURRENT_TIMESTAMP(3),
    `is_deleted` BOOLEAN NOT NULL DEFAULT false,

    INDEX `idx_collections_project_version_project_id`(`project_id`),
    PRIMARY KEY (`id`)
) DEFAULT CHARACTER SET utf8mb4 COLLATE utf8mb4_unicode_ci;

-- CreateTable
CREATE TABLE `collections_category` (
    `id` INTEGER NOT NULL AUTO_INCREMENT,
    `project_version_id` INTEGER NOT NULL,
    `category_name` VARCHAR(64) NOT NULL,
    `weight` INTEGER NOT NULL,
    `status` SMALLINT NOT NULL,
    `created_at` DATETIME(3) NOT NULL DEFAULT CURRENT_TIMESTAMP(3),
    `updated_at` DATETIME(3) NOT NULL DEFAULT CURRENT_TIMESTAMP(3),
    `is_deleted` BOOLEAN NOT NULL DEFAULT false,

    INDEX `idx_collections_category_project_version_id`(`project_version_id`),
    PRIMARY KEY (`id`)
) DEFAULT CHARACTER SET utf8mb4 COLLATE utf8mb4_unicode_ci;

-- CreateTable
CREATE TABLE `docs_note_info` (
    `id` INTEGER NOT NULL AUTO_INCREMENT,
    `category_id` INTEGER NOT NULL,
    `note_title` VARCHAR(255) NOT NULL,
    `weight` INTEGER NOT NULL,
    `status` SMALLINT NOT NULL,
    `content_revision` INTEGER NOT NULL DEFAULT 0,
    `created_at` DATETIME(3) NOT NULL DEFAULT CURRENT_TIMESTAMP(3),
    `updated_at` DATETIME(3) NOT NULL DEFAULT CURRENT_TIMESTAMP(3),
    `is_deleted` BOOLEAN NOT NULL DEFAULT false,

    INDEX `idx_docs_note_info_category_id`(`category_id`),
    PRIMARY KEY (`id`)
) DEFAULT CHARACTER SET utf8mb4 COLLATE utf8mb4_unicode_ci;

-- CreateTable
CREATE TABLE `docs_note_content` (
    `id` INTEGER NOT NULL AUTO_INCREMENT,
    `note_info_id` INTEGER NOT NULL,
    `content` LONGTEXT NOT NULL,
    `version_note` VARCHAR(255) NULL,
    `is_primary` BOOLEAN NOT NULL DEFAULT false,
    `status` SMALLINT NOT NULL,
    `created_at` DATETIME(3) NOT NULL DEFAULT CURRENT_TIMESTAMP(3),
    `updated_at` DATETIME(3) NOT NULL DEFAULT CURRENT_TIMESTAMP(3),
    `is_deleted` BOOLEAN NOT NULL DEFAULT false,

    INDEX `idx_docs_note_content_note_info_id`(`note_info_id`),
    PRIMARY KEY (`id`)
) DEFAULT CHARACTER SET utf8mb4 COLLATE utf8mb4_unicode_ci;

-- CreateTable
CREATE TABLE `files_file_management` (
    `id` INTEGER NOT NULL AUTO_INCREMENT,
    `original_name` VARCHAR(255) NOT NULL,
    `file_name` VARCHAR(255) NOT NULL,
    `file_path` VARCHAR(500) NOT NULL,
    `file_size` BIGINT NOT NULL,
    `business_type` VARCHAR(50) NOT NULL,
    `status` SMALLINT NOT NULL DEFAULT 1,
    `create_time` DATETIME(3) NOT NULL DEFAULT CURRENT_TIMESTAMP(3),

    PRIMARY KEY (`id`)
) DEFAULT CHARACTER SET utf8mb4 COLLATE utf8mb4_unicode_ci;

-- CreateTable
CREATE TABLE `system_config` (
    `id` INTEGER NOT NULL AUTO_INCREMENT,
    `config_key` VARCHAR(100) NOT NULL,
    `config_value` VARCHAR(500) NOT NULL,
    `description` VARCHAR(255) NULL,
    `created_at` DATETIME(3) NOT NULL DEFAULT CURRENT_TIMESTAMP(3),
    `updated_at` DATETIME(3) NOT NULL DEFAULT CURRENT_TIMESTAMP(3),

    UNIQUE INDEX `uq_system_config_key`(`config_key`),
    PRIMARY KEY (`id`)
) DEFAULT CHARACTER SET utf8mb4 COLLATE utf8mb4_unicode_ci;

-- CreateTable
CREATE TABLE `system_homepage` (
    `id` INTEGER NOT NULL AUTO_INCREMENT,
    `content` LONGTEXT NOT NULL,
    `status` SMALLINT NOT NULL DEFAULT 1,
    `created_at` DATETIME(3) NOT NULL DEFAULT CURRENT_TIMESTAMP(3),
    `updated_at` DATETIME(3) NOT NULL DEFAULT CURRENT_TIMESTAMP(3),
    `is_deleted` BOOLEAN NOT NULL DEFAULT false,

    PRIMARY KEY (`id`)
) DEFAULT CHARACTER SET utf8mb4 COLLATE utf8mb4_unicode_ci;

-- CreateTable
CREATE TABLE `system_installation` (
    `id` INTEGER NOT NULL,
    `provider` VARCHAR(20) NOT NULL,
    `status` VARCHAR(32) NOT NULL,
    `schema_revision` INTEGER NOT NULL,
    `installation_id` CHAR(36) NOT NULL,
    `created_at` DATETIME(3) NOT NULL DEFAULT CURRENT_TIMESTAMP(3),
    `updated_at` DATETIME(3) NOT NULL DEFAULT CURRENT_TIMESTAMP(3),
    `installed_at` DATETIME(3) NULL,

    UNIQUE INDEX `uq_system_installation_id`(`installation_id`),
    PRIMARY KEY (`id`)
) DEFAULT CHARACTER SET utf8mb4 COLLATE utf8mb4_unicode_ci;

-- CreateTable
CREATE TABLE `system_runtime_lock` (
    `key` VARCHAR(128) NOT NULL,
    `revision` INTEGER NOT NULL DEFAULT 0,
    `updated_at` DATETIME(3) NOT NULL DEFAULT CURRENT_TIMESTAMP(3),

    PRIMARY KEY (`key`)
) DEFAULT CHARACTER SET utf8mb4 COLLATE utf8mb4_unicode_ci;

-- CreateTable
CREATE TABLE `solana_merkle_tree` (
    `id` INTEGER NOT NULL AUTO_INCREMENT,
    `name` VARCHAR(128) NOT NULL,
    `tree_address` VARCHAR(64) NOT NULL,
    `tree_authority` VARCHAR(64) NOT NULL,
    `encrypted_key` TEXT NOT NULL,
    `creator_address` VARCHAR(64) NOT NULL,
    `max_depth` SMALLINT NOT NULL,
    `max_buffer_size` SMALLINT NOT NULL,
    `canopy_depth` SMALLINT NOT NULL,
    `network` VARCHAR(20) NOT NULL DEFAULT 'devnet',
    `total_minted` INTEGER NOT NULL DEFAULT 0,
    `max_capacity` BIGINT NOT NULL,
    `remaining_capacity` BIGINT NOT NULL DEFAULT 0,
    `capacity_revision` INTEGER NOT NULL DEFAULT 0,
    `creation_cost` BIGINT NOT NULL,
    `tx_signature` VARCHAR(128) NULL,
    `priority` INTEGER NOT NULL DEFAULT 0,
    `status` SMALLINT NOT NULL DEFAULT 0,
    `created_at` DATETIME(3) NOT NULL DEFAULT CURRENT_TIMESTAMP(3),
    `updated_at` DATETIME(3) NOT NULL DEFAULT CURRENT_TIMESTAMP(3),
    `is_deleted` BOOLEAN NOT NULL DEFAULT false,

    UNIQUE INDEX `uq_solana_merkle_tree_address`(`tree_address`),
    INDEX `idx_solana_merkle_tree_network_status`(`network`, `status`),
    INDEX `idx_solana_merkle_tree_creator`(`creator_address`),
    PRIMARY KEY (`id`)
) DEFAULT CHARACTER SET utf8mb4 COLLATE utf8mb4_unicode_ci;

-- CreateTable
CREATE TABLE `solana_compressed_nft` (
    `id` INTEGER NOT NULL AUTO_INCREMENT,
    `merkle_tree_id` INTEGER NOT NULL,
    `project_id` INTEGER NOT NULL,
    `asset_id` VARCHAR(64) NOT NULL,
    `leaf_index` INTEGER NOT NULL,
    `name` VARCHAR(128) NOT NULL,
    `symbol` VARCHAR(32) NULL,
    `description` TEXT NULL,
    `metadata_uri` VARCHAR(500) NULL,
    `image_cid` VARCHAR(128) NULL,
    `metadata_cid` VARCHAR(128) NULL,
    `original_image_id` INTEGER NULL,
    `owner_address` VARCHAR(64) NOT NULL,
    `mint_tx_signature` VARCHAR(128) NULL,
    `prepare_expires_at` DATETIME(3) NULL,
    `last_valid_block_height` BIGINT NULL,
    `capacity_reserved` BOOLEAN NOT NULL DEFAULT false,
    `status` SMALLINT NOT NULL DEFAULT 0,
    `created_at` DATETIME(3) NOT NULL DEFAULT CURRENT_TIMESTAMP(3),
    `updated_at` DATETIME(3) NOT NULL DEFAULT CURRENT_TIMESTAMP(3),

    UNIQUE INDEX `uq_solana_compressed_nft_asset_id`(`asset_id`),
    UNIQUE INDEX `uq_solana_compressed_nft_mint_tx`(`mint_tx_signature`),
    INDEX `idx_solana_compressed_nft_merkle_tree_id`(`merkle_tree_id`),
    INDEX `idx_solana_compressed_nft_project_id`(`project_id`),
    INDEX `idx_solana_compressed_nft_owner`(`owner_address`),
    INDEX `idx_solana_compressed_nft_project_owner`(`project_id`, `owner_address`),
    PRIMARY KEY (`id`)
) DEFAULT CHARACTER SET utf8mb4 COLLATE utf8mb4_unicode_ci;

-- AddForeignKey
ALTER TABLE `auth_session` ADD CONSTRAINT `auth_session_user_id_fkey` FOREIGN KEY (`user_id`) REFERENCES `auth_user`(`id`) ON DELETE CASCADE ON UPDATE NO ACTION;

-- AddForeignKey
ALTER TABLE `collections_project_menu` ADD CONSTRAINT `collections_project_menu_project_id_fkey` FOREIGN KEY (`project_id`) REFERENCES `collections_project`(`id`) ON DELETE CASCADE ON UPDATE NO ACTION;

-- AddForeignKey
ALTER TABLE `collections_project_menu` ADD CONSTRAINT `collections_project_menu_parent_id_fkey` FOREIGN KEY (`parent_id`) REFERENCES `collections_project_menu`(`id`) ON DELETE CASCADE ON UPDATE NO ACTION;

-- AddForeignKey
ALTER TABLE `collections_project_home` ADD CONSTRAINT `collections_project_home_project_id_fkey` FOREIGN KEY (`project_id`) REFERENCES `collections_project`(`id`) ON DELETE CASCADE ON UPDATE NO ACTION;

-- AddForeignKey
ALTER TABLE `collections_project_version` ADD CONSTRAINT `collections_project_version_project_id_fkey` FOREIGN KEY (`project_id`) REFERENCES `collections_project`(`id`) ON DELETE NO ACTION ON UPDATE NO ACTION;

-- AddForeignKey
ALTER TABLE `collections_category` ADD CONSTRAINT `collections_category_project_version_id_fkey` FOREIGN KEY (`project_version_id`) REFERENCES `collections_project_version`(`id`) ON DELETE NO ACTION ON UPDATE NO ACTION;

-- AddForeignKey
ALTER TABLE `docs_note_info` ADD CONSTRAINT `docs_note_info_category_id_fkey` FOREIGN KEY (`category_id`) REFERENCES `collections_category`(`id`) ON DELETE NO ACTION ON UPDATE NO ACTION;

-- AddForeignKey
ALTER TABLE `docs_note_content` ADD CONSTRAINT `docs_note_content_note_info_id_fkey` FOREIGN KEY (`note_info_id`) REFERENCES `docs_note_info`(`id`) ON DELETE NO ACTION ON UPDATE NO ACTION;

-- AddForeignKey
ALTER TABLE `solana_compressed_nft` ADD CONSTRAINT `solana_compressed_nft_merkle_tree_id_fkey` FOREIGN KEY (`merkle_tree_id`) REFERENCES `solana_merkle_tree`(`id`) ON DELETE CASCADE ON UPDATE NO ACTION;
-- Seed portable Solana tree-priority locks
INSERT INTO `system_runtime_lock` (`key`, `revision`, `updated_at`) VALUES
    ('solana-tree-priority:mainnet', 0, CURRENT_TIMESTAMP(3)),
    ('solana-tree-priority:devnet', 0, CURRENT_TIMESTAMP(3));
