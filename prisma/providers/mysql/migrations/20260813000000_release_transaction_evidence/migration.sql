-- Replace article cNFT storage with project-version transaction evidence.
DROP TABLE IF EXISTS `solana_compressed_nft`;
DROP TABLE IF EXISTS `solana_merkle_tree`;
DROP TABLE IF EXISTS `system_runtime_lock`;
DELETE FROM `system_config` WHERE `config_key` IN ('solana_network', 'SOLANA_RPC_URL', 'SOLANA_DEVNET_RPC_URL', 'FILEBASE_ACCESS_KEY', 'FILEBASE_SECRET_KEY', 'FILEBASE_BUCKET', 'FILEBASE_ENDPOINT');

CREATE TABLE `release_credential` (
    `id` INTEGER NOT NULL AUTO_INCREMENT,
    `project_version_id` INTEGER NOT NULL,
    `issuer_user_id` INTEGER NOT NULL,
    `network` VARCHAR(20) NOT NULL,
    `signer_address` VARCHAR(64) NOT NULL,
    `memo` TEXT NOT NULL,
    `transaction_signature` VARCHAR(128) NULL,
    `status` SMALLINT NOT NULL DEFAULT 0,
    `slot` BIGINT NULL,
    `block_time` DATETIME(3) NULL,
    `fee_lamports` BIGINT NULL,
    `finalized_at` DATETIME(3) NULL,
    `last_verified_at` DATETIME(3) NULL,
    `created_at` DATETIME(3) NOT NULL DEFAULT CURRENT_TIMESTAMP(3),
    `updated_at` DATETIME(3) NOT NULL DEFAULT CURRENT_TIMESTAMP(3),
    UNIQUE INDEX `uq_release_credential_transaction_signature`(`transaction_signature`),
    UNIQUE INDEX `uq_release_credential_version_network`(`project_version_id`, `network`),
    INDEX `idx_release_credential_network_status`(`network`, `status`),
    INDEX `idx_release_credential_signer`(`signer_address`),
    PRIMARY KEY (`id`)
) DEFAULT CHARACTER SET utf8mb4 COLLATE utf8mb4_unicode_ci;

CREATE TABLE `release_credential_attempt` (
    `id` INTEGER NOT NULL AUTO_INCREMENT,
    `credential_id` INTEGER NOT NULL,
    `issuer_user_id` INTEGER NOT NULL,
    `signer_address` VARCHAR(64) NOT NULL,
    `memo` TEXT NOT NULL,
    `message_hash` CHAR(64) NOT NULL,
    `recent_blockhash` VARCHAR(100) NOT NULL,
    `last_valid_block_height` BIGINT NOT NULL,
    `transaction_signature` VARCHAR(128) NULL,
    `status` SMALLINT NOT NULL DEFAULT 0,
    `failure_code` VARCHAR(64) NULL,
    `failure_message` VARCHAR(500) NULL,
    `expires_at` DATETIME(3) NOT NULL,
    `submitted_at` DATETIME(3) NULL,
    `finalized_at` DATETIME(3) NULL,
    `created_at` DATETIME(3) NOT NULL DEFAULT CURRENT_TIMESTAMP(3),
    `updated_at` DATETIME(3) NOT NULL DEFAULT CURRENT_TIMESTAMP(3),
    INDEX `idx_release_credential_attempt_status`(`credential_id`, `status`),
    INDEX `idx_release_credential_attempt_signature`(`transaction_signature`),
    PRIMARY KEY (`id`)
) DEFAULT CHARACTER SET utf8mb4 COLLATE utf8mb4_unicode_ci;

ALTER TABLE `release_credential` ADD CONSTRAINT `release_credential_project_version_id_fkey` FOREIGN KEY (`project_version_id`) REFERENCES `collections_project_version`(`id`) ON DELETE CASCADE ON UPDATE NO ACTION;
ALTER TABLE `release_credential` ADD CONSTRAINT `release_credential_issuer_user_id_fkey` FOREIGN KEY (`issuer_user_id`) REFERENCES `auth_user`(`id`) ON DELETE RESTRICT ON UPDATE NO ACTION;
ALTER TABLE `release_credential_attempt` ADD CONSTRAINT `release_credential_attempt_credential_id_fkey` FOREIGN KEY (`credential_id`) REFERENCES `release_credential`(`id`) ON DELETE CASCADE ON UPDATE NO ACTION;
ALTER TABLE `release_credential_attempt` ADD CONSTRAINT `release_credential_attempt_issuer_user_id_fkey` FOREIGN KEY (`issuer_user_id`) REFERENCES `auth_user`(`id`) ON DELETE RESTRICT ON UPDATE NO ACTION;
