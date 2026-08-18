-- Add one-to-one Web2 contract snapshots and their independent Solana evidence lifecycle.
CREATE TABLE `contract` (
    `id` INTEGER NOT NULL AUTO_INCREMENT,
    `contract_id` CHAR(36) NOT NULL,
    `installation_id` CHAR(36) NULL,
    `issuer_user_id` INTEGER NOT NULL,
    `subject_user_id` INTEGER NOT NULL,
    `title` VARCHAR(255) NOT NULL,
    `body` LONGTEXT NOT NULL,
    `body_hash` CHAR(64) NOT NULL,
    `contract_hash` CHAR(64) NULL,
    `attachment_file_id` INTEGER NULL,
    `attachment_hash` CHAR(64) NULL,
    `party_commitment` CHAR(64) NOT NULL,
    `status` SMALLINT NOT NULL DEFAULT 0,
    `issued_at` DATETIME(3) NULL,
    `signed_at` DATETIME(3) NULL,
    `signed_session_id` CHAR(36) NULL,
    `signed_ip` VARCHAR(255) NULL,
    `signed_user_agent` TEXT NULL,
    `declined_at` DATETIME(3) NULL,
    `decline_reason` VARCHAR(500) NULL,
    `cancelled_at` DATETIME(3) NULL,
    `created_at` DATETIME(3) NOT NULL DEFAULT CURRENT_TIMESTAMP(3),
    `updated_at` DATETIME(3) NOT NULL DEFAULT CURRENT_TIMESTAMP(3),
    UNIQUE INDEX `uq_contract_contract_id`(`contract_id`),
    UNIQUE INDEX `uq_contract_attachment_file_id`(`attachment_file_id`),
    INDEX `idx_contract_subject_status`(`subject_user_id`, `status`),
    INDEX `idx_contract_issuer_created`(`issuer_user_id`, `created_at`),
    PRIMARY KEY (`id`)
) DEFAULT CHARACTER SET utf8mb4 COLLATE utf8mb4_unicode_ci;

CREATE TABLE `contract_credential` (
    `id` INTEGER NOT NULL AUTO_INCREMENT,
    `contract_id` INTEGER NOT NULL,
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
    UNIQUE INDEX `uq_contract_credential_transaction_signature`(`transaction_signature`),
    UNIQUE INDEX `uq_contract_credential_contract_network`(`contract_id`, `network`),
    INDEX `idx_contract_credential_network_status`(`network`, `status`),
    INDEX `idx_contract_credential_signer`(`signer_address`),
    PRIMARY KEY (`id`)
) DEFAULT CHARACTER SET utf8mb4 COLLATE utf8mb4_unicode_ci;

CREATE TABLE `contract_credential_attempt` (
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
    INDEX `idx_contract_credential_attempt_status`(`credential_id`, `status`),
    INDEX `idx_contract_credential_attempt_signature`(`transaction_signature`),
    PRIMARY KEY (`id`)
) DEFAULT CHARACTER SET utf8mb4 COLLATE utf8mb4_unicode_ci;

ALTER TABLE `contract` ADD CONSTRAINT `contract_issuer_user_id_fkey` FOREIGN KEY (`issuer_user_id`) REFERENCES `auth_user`(`id`) ON DELETE RESTRICT ON UPDATE NO ACTION;
ALTER TABLE `contract` ADD CONSTRAINT `contract_subject_user_id_fkey` FOREIGN KEY (`subject_user_id`) REFERENCES `auth_user`(`id`) ON DELETE RESTRICT ON UPDATE NO ACTION;
ALTER TABLE `contract` ADD CONSTRAINT `contract_attachment_file_id_fkey` FOREIGN KEY (`attachment_file_id`) REFERENCES `files_file_management`(`id`) ON DELETE RESTRICT ON UPDATE NO ACTION;
ALTER TABLE `contract_credential` ADD CONSTRAINT `contract_credential_contract_id_fkey` FOREIGN KEY (`contract_id`) REFERENCES `contract`(`id`) ON DELETE CASCADE ON UPDATE NO ACTION;
ALTER TABLE `contract_credential` ADD CONSTRAINT `contract_credential_issuer_user_id_fkey` FOREIGN KEY (`issuer_user_id`) REFERENCES `auth_user`(`id`) ON DELETE RESTRICT ON UPDATE NO ACTION;
ALTER TABLE `contract_credential_attempt` ADD CONSTRAINT `contract_credential_attempt_credential_id_fkey` FOREIGN KEY (`credential_id`) REFERENCES `contract_credential`(`id`) ON DELETE CASCADE ON UPDATE NO ACTION;
ALTER TABLE `contract_credential_attempt` ADD CONSTRAINT `contract_credential_attempt_issuer_user_id_fkey` FOREIGN KEY (`issuer_user_id`) REFERENCES `auth_user`(`id`) ON DELETE RESTRICT ON UPDATE NO ACTION;

CREATE TABLE `contract_admin_audit` (
    `id` INTEGER NOT NULL AUTO_INCREMENT,
    `contract_id` INTEGER NOT NULL,
    `actor_user_id` INTEGER NOT NULL,
    `action` VARCHAR(64) NOT NULL,
    `created_at` DATETIME(3) NOT NULL DEFAULT CURRENT_TIMESTAMP(3),
    INDEX `idx_contract_admin_audit_contract_created`(`contract_id`, `created_at`),
    INDEX `idx_contract_admin_audit_actor_created`(`actor_user_id`, `created_at`),
    PRIMARY KEY (`id`)
) DEFAULT CHARACTER SET utf8mb4 COLLATE utf8mb4_unicode_ci;

ALTER TABLE `contract_admin_audit` ADD CONSTRAINT `contract_admin_audit_contract_id_fkey` FOREIGN KEY (`contract_id`) REFERENCES `contract`(`id`) ON DELETE CASCADE ON UPDATE NO ACTION;
ALTER TABLE `contract_admin_audit` ADD CONSTRAINT `contract_admin_audit_actor_user_id_fkey` FOREIGN KEY (`actor_user_id`) REFERENCES `auth_user`(`id`) ON DELETE RESTRICT ON UPDATE NO ACTION;
