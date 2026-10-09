-- AlterTable
ALTER TABLE `commission_contract_template_version` ADD COLUMN `format` VARCHAR(191) NOT NULL DEFAULT 'LEGACY';

-- AlterTable
ALTER TABLE `commission` ADD COLUMN `confirmation_mode` VARCHAR(191) NOT NULL DEFAULT 'ONLINE',
    ADD COLUMN `maintenance_close_reason` VARCHAR(1000) NOT NULL DEFAULT '',
    ADD COLUMN `maintenance_closed_at` DATETIME(3) NULL,
    ADD COLUMN `maintenance_ends_at` DATETIME(3) NULL,
    ADD COLUMN `maintenance_started_at` DATETIME(3) NULL,
    ADD COLUMN `paused` BOOLEAN NOT NULL DEFAULT false,
    ADD COLUMN `payment_percent` INTEGER NOT NULL DEFAULT 0,
    ADD COLUMN `workflow_version` INTEGER NOT NULL DEFAULT 1,
    MODIFY `subject_user_id` INTEGER NULL;

-- CreateTable
CREATE TABLE `commission_invitation` (
    `id` INTEGER NOT NULL AUTO_INCREMENT,
    `commission_id` INTEGER NOT NULL,
    `token_hash` VARCHAR(255) NOT NULL,
    `expires_at` DATETIME(3) NOT NULL,
    `revoked_at` DATETIME(3) NULL,
    `claimed_at` DATETIME(3) NULL,
    `claimed_by_id` INTEGER NULL,
    `created_at` DATETIME(3) NOT NULL DEFAULT CURRENT_TIMESTAMP(3),

    UNIQUE INDEX `uq_commission_invitation_token`(`token_hash`),
    INDEX `idx_commission_invitation_owner`(`commission_id`),
    PRIMARY KEY (`id`)
) DEFAULT CHARACTER SET utf8mb4 COLLATE utf8mb4_unicode_ci;

-- CreateTable
CREATE TABLE `commission_agreement` (
    `id` INTEGER NOT NULL AUTO_INCREMENT,
    `public_id` VARCHAR(255) NOT NULL,
    `commission_id` INTEGER NOT NULL,
    `kind` VARCHAR(255) NOT NULL DEFAULT 'AGREEMENT',
    `status` VARCHAR(255) NOT NULL DEFAULT 'DRAFT',
    `title` VARCHAR(255) NOT NULL,
    `body` LONGTEXT NOT NULL,
    `template_json` LONGTEXT NOT NULL,
    `values_json` LONGTEXT NOT NULL,
    `file_keys_json` LONGTEXT NOT NULL DEFAULT ('[]'),
    `total_fen` BIGINT NULL,
    `maintenance_days` INTEGER NOT NULL DEFAULT 15,
    `confirmation_mode` VARCHAR(255) NOT NULL DEFAULT 'ONLINE',
    `published_event_id` VARCHAR(255) NULL,
    `confirmed_at` DATETIME(3) NULL,
    `created_at` DATETIME(3) NOT NULL DEFAULT CURRENT_TIMESTAMP(3),

    UNIQUE INDEX `uq_commission_agreement_public`(`public_id`),
    INDEX `idx_commission_agreement_owner_status`(`commission_id`, `status`),
    PRIMARY KEY (`id`)
) DEFAULT CHARACTER SET utf8mb4 COLLATE utf8mb4_unicode_ci;

-- CreateTable
CREATE TABLE `commission_submission` (
    `id` INTEGER NOT NULL AUTO_INCREMENT,
    `public_id` VARCHAR(255) NOT NULL,
    `commission_id` INTEGER NOT NULL,
    `sequence` INTEGER NOT NULL,
    `command_id` VARCHAR(255) NOT NULL,
    `request_hash` VARCHAR(255) NOT NULL,
    `actor_user_id` INTEGER NULL,
    `type` VARCHAR(255) NOT NULL,
    `snapshot_json` LONGTEXT NOT NULL,
    `snapshot_hash` VARCHAR(255) NOT NULL,
    `previous_hash` VARCHAR(255) NULL,
    `proof_revision` INTEGER NOT NULL DEFAULT 0,
    `created_at` DATETIME(3) NOT NULL DEFAULT CURRENT_TIMESTAMP(3),

    UNIQUE INDEX `uq_commission_submission_public`(`public_id`),
    UNIQUE INDEX `uq_commission_submission_sequence`(`commission_id`, `sequence`),
    UNIQUE INDEX `uq_commission_submission_command`(`commission_id`, `command_id`),
    PRIMARY KEY (`id`)
) DEFAULT CHARACTER SET utf8mb4 COLLATE utf8mb4_unicode_ci;

-- CreateTable
CREATE TABLE `commission_proof_attempt` (
    `id` INTEGER NOT NULL AUTO_INCREMENT,
    `submission_id` INTEGER NOT NULL,
    `network` VARCHAR(255) NOT NULL,
    `issuer_user_id` INTEGER NOT NULL,
    `signer_address` VARCHAR(255) NOT NULL,
    `status` VARCHAR(255) NOT NULL DEFAULT 'PREPARED',
    `memo` LONGTEXT NOT NULL,
    `message_hash` VARCHAR(255) NOT NULL,
    `transaction_base64` LONGTEXT NOT NULL,
    `last_valid_block_height` BIGINT NOT NULL,
    `expires_at` DATETIME(3) NOT NULL,
    `transaction_signature` VARCHAR(255) NULL,
    `slot` BIGINT NULL,
    `block_time` DATETIME(3) NULL,
    `fee_lamports` BIGINT NULL,
    `error` LONGTEXT NULL,
    `created_at` DATETIME(3) NOT NULL DEFAULT CURRENT_TIMESTAMP(3),
    `finalized_at` DATETIME(3) NULL,

    UNIQUE INDEX `uq_commission_proof_signature`(`transaction_signature`),
    INDEX `idx_commission_proof_submission_network`(`submission_id`, `network`),
    INDEX `idx_commission_proof_status`(`status`),
    PRIMARY KEY (`id`)
) DEFAULT CHARACTER SET utf8mb4 COLLATE utf8mb4_unicode_ci;

-- AddForeignKey
ALTER TABLE `commission_invitation` ADD CONSTRAINT `commission_invitation_commission_id_fkey` FOREIGN KEY (`commission_id`) REFERENCES `commission`(`id`) ON DELETE RESTRICT ON UPDATE NO ACTION;

-- AddForeignKey
ALTER TABLE `commission_agreement` ADD CONSTRAINT `commission_agreement_commission_id_fkey` FOREIGN KEY (`commission_id`) REFERENCES `commission`(`id`) ON DELETE RESTRICT ON UPDATE NO ACTION;

-- AddForeignKey
ALTER TABLE `commission_submission` ADD CONSTRAINT `commission_submission_commission_id_fkey` FOREIGN KEY (`commission_id`) REFERENCES `commission`(`id`) ON DELETE RESTRICT ON UPDATE NO ACTION;

-- AddForeignKey
ALTER TABLE `commission_proof_attempt` ADD CONSTRAINT `commission_proof_attempt_submission_id_fkey` FOREIGN KEY (`submission_id`) REFERENCES `commission_submission`(`id`) ON DELETE RESTRICT ON UPDATE NO ACTION;
