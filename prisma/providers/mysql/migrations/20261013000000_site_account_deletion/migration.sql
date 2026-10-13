-- Account references are attribution, not ownership. Frozen evidence bytes are retained.

ALTER TABLE `points_transaction` ADD COLUMN `attribution_json` VARCHAR(2048) NOT NULL DEFAULT '{}';

ALTER TABLE `points_gift_card_batch` ADD COLUMN `attribution_json` VARCHAR(2048) NOT NULL DEFAULT '{}';

ALTER TABLE `points_gift_card_batch` DROP FOREIGN KEY `points_gift_card_batch_created_by_id_fkey`;

ALTER TABLE `points_gift_card_batch` MODIFY COLUMN `created_by_id` INTEGER NULL;

ALTER TABLE `points_gift_card_batch` ADD CONSTRAINT `points_gift_card_batch_created_by_id_fkey` FOREIGN KEY (`created_by_id`) REFERENCES `auth_user`(`id`) ON DELETE SET NULL ON UPDATE NO ACTION;

ALTER TABLE `membership_grant` ADD COLUMN `attribution_json` VARCHAR(2048) NOT NULL DEFAULT '{}';

ALTER TABLE `membership_grant` DROP FOREIGN KEY `membership_grant_granted_by_user_id_fkey`;

ALTER TABLE `membership_grant` MODIFY COLUMN `granted_by_user_id` INTEGER NULL;

ALTER TABLE `membership_grant` ADD CONSTRAINT `membership_grant_granted_by_user_id_fkey` FOREIGN KEY (`granted_by_user_id`) REFERENCES `auth_user`(`id`) ON DELETE SET NULL ON UPDATE NO ACTION;

ALTER TABLE `membership_grant` DROP FOREIGN KEY `membership_grant_revoked_by_user_id_fkey`;

ALTER TABLE `membership_grant` MODIFY COLUMN `revoked_by_user_id` INTEGER NULL;

ALTER TABLE `membership_grant` ADD CONSTRAINT `membership_grant_revoked_by_user_id_fkey` FOREIGN KEY (`revoked_by_user_id`) REFERENCES `auth_user`(`id`) ON DELETE SET NULL ON UPDATE NO ACTION;

ALTER TABLE `docs_note_info` ADD COLUMN `attribution_json` VARCHAR(2048) NOT NULL DEFAULT '{}';

ALTER TABLE `docs_note_info` MODIFY COLUMN `author_id` INTEGER NULL;

ALTER TABLE `docs_note_info` ADD CONSTRAINT `docs_note_info_author_id_fkey` FOREIGN KEY (`author_id`) REFERENCES `auth_user`(`id`) ON DELETE SET NULL ON UPDATE NO ACTION;

ALTER TABLE `contract` ADD COLUMN `attribution_json` VARCHAR(2048) NOT NULL DEFAULT '{}';

ALTER TABLE `contract` DROP FOREIGN KEY `contract_issuer_user_id_fkey`;

ALTER TABLE `contract` MODIFY COLUMN `issuer_user_id` INTEGER NULL;

ALTER TABLE `contract` ADD CONSTRAINT `contract_issuer_user_id_fkey` FOREIGN KEY (`issuer_user_id`) REFERENCES `auth_user`(`id`) ON DELETE SET NULL ON UPDATE NO ACTION;

ALTER TABLE `contract_admin_audit` ADD COLUMN `attribution_json` VARCHAR(2048) NOT NULL DEFAULT '{}';

ALTER TABLE `contract_admin_audit` DROP FOREIGN KEY `contract_admin_audit_actor_user_id_fkey`;

ALTER TABLE `contract_admin_audit` MODIFY COLUMN `actor_user_id` INTEGER NULL;

ALTER TABLE `contract_admin_audit` ADD CONSTRAINT `contract_admin_audit_actor_user_id_fkey` FOREIGN KEY (`actor_user_id`) REFERENCES `auth_user`(`id`) ON DELETE SET NULL ON UPDATE NO ACTION;

ALTER TABLE `contract_credential` ADD COLUMN `attribution_json` VARCHAR(2048) NOT NULL DEFAULT '{}';

ALTER TABLE `contract_credential` DROP FOREIGN KEY `contract_credential_issuer_user_id_fkey`;

ALTER TABLE `contract_credential` MODIFY COLUMN `issuer_user_id` INTEGER NULL;

ALTER TABLE `contract_credential` ADD CONSTRAINT `contract_credential_issuer_user_id_fkey` FOREIGN KEY (`issuer_user_id`) REFERENCES `auth_user`(`id`) ON DELETE SET NULL ON UPDATE NO ACTION;

ALTER TABLE `contract_credential_attempt` ADD COLUMN `attribution_json` VARCHAR(2048) NOT NULL DEFAULT '{}';

ALTER TABLE `contract_credential_attempt` DROP FOREIGN KEY `contract_credential_attempt_issuer_user_id_fkey`;

ALTER TABLE `contract_credential_attempt` MODIFY COLUMN `issuer_user_id` INTEGER NULL;

ALTER TABLE `contract_credential_attempt` ADD CONSTRAINT `contract_credential_attempt_issuer_user_id_fkey` FOREIGN KEY (`issuer_user_id`) REFERENCES `auth_user`(`id`) ON DELETE SET NULL ON UPDATE NO ACTION;

ALTER TABLE `release_credential` ADD COLUMN `attribution_json` VARCHAR(2048) NOT NULL DEFAULT '{}';

ALTER TABLE `release_credential` DROP FOREIGN KEY `release_credential_issuer_user_id_fkey`;

ALTER TABLE `release_credential` MODIFY COLUMN `issuer_user_id` INTEGER NULL;

ALTER TABLE `release_credential` ADD CONSTRAINT `release_credential_issuer_user_id_fkey` FOREIGN KEY (`issuer_user_id`) REFERENCES `auth_user`(`id`) ON DELETE SET NULL ON UPDATE NO ACTION;

ALTER TABLE `release_credential_attempt` ADD COLUMN `attribution_json` VARCHAR(2048) NOT NULL DEFAULT '{}';

ALTER TABLE `release_credential_attempt` DROP FOREIGN KEY `release_credential_attempt_issuer_user_id_fkey`;

ALTER TABLE `release_credential_attempt` MODIFY COLUMN `issuer_user_id` INTEGER NULL;

ALTER TABLE `release_credential_attempt` ADD CONSTRAINT `release_credential_attempt_issuer_user_id_fkey` FOREIGN KEY (`issuer_user_id`) REFERENCES `auth_user`(`id`) ON DELETE SET NULL ON UPDATE NO ACTION;

ALTER TABLE `commission_payment` ADD COLUMN `attribution_json` VARCHAR(2048) NOT NULL DEFAULT '{}';

ALTER TABLE `commission_payment` MODIFY COLUMN `created_by_id` INTEGER NULL;

ALTER TABLE `commission_payment` ADD CONSTRAINT `commission_payment_created_by_id_fkey` FOREIGN KEY (`created_by_id`) REFERENCES `auth_user`(`id`) ON DELETE SET NULL ON UPDATE NO ACTION;

ALTER TABLE `commission_payment` MODIFY COLUMN `confirmed_by_id` INTEGER NULL;

ALTER TABLE `commission_payment` ADD CONSTRAINT `commission_payment_confirmed_by_id_fkey` FOREIGN KEY (`confirmed_by_id`) REFERENCES `auth_user`(`id`) ON DELETE SET NULL ON UPDATE NO ACTION;

ALTER TABLE `commission_change` ADD COLUMN `attribution_json` VARCHAR(2048) NOT NULL DEFAULT '{}';

ALTER TABLE `commission_change` MODIFY COLUMN `created_by_id` INTEGER NULL;

ALTER TABLE `commission_change` ADD CONSTRAINT `commission_change_created_by_id_fkey` FOREIGN KEY (`created_by_id`) REFERENCES `auth_user`(`id`) ON DELETE SET NULL ON UPDATE NO ACTION;

ALTER TABLE `commission_issue` ADD COLUMN `attribution_json` VARCHAR(2048) NOT NULL DEFAULT '{}';

ALTER TABLE `commission_issue` MODIFY COLUMN `created_by_id` INTEGER NULL;

ALTER TABLE `commission_issue` ADD CONSTRAINT `commission_issue_created_by_id_fkey` FOREIGN KEY (`created_by_id`) REFERENCES `auth_user`(`id`) ON DELETE SET NULL ON UPDATE NO ACTION;

ALTER TABLE `commission_file` ADD COLUMN `attribution_json` VARCHAR(2048) NOT NULL DEFAULT '{}';

ALTER TABLE `commission_file` MODIFY COLUMN `uploader_user_id` INTEGER NULL;

ALTER TABLE `commission_file` ADD CONSTRAINT `commission_file_uploader_user_id_fkey` FOREIGN KEY (`uploader_user_id`) REFERENCES `auth_user`(`id`) ON DELETE SET NULL ON UPDATE NO ACTION;

ALTER TABLE `commission_event` ADD COLUMN `attribution_json` VARCHAR(2048) NOT NULL DEFAULT '{}';

ALTER TABLE `commission_event` DROP FOREIGN KEY `commission_event_actor_user_id_fkey`;

ALTER TABLE `commission_event` MODIFY COLUMN `actor_user_id` INTEGER NULL;

ALTER TABLE `commission_event` ADD CONSTRAINT `commission_event_actor_user_id_fkey` FOREIGN KEY (`actor_user_id`) REFERENCES `auth_user`(`id`) ON DELETE SET NULL ON UPDATE NO ACTION;

ALTER TABLE `commission_submission` ADD COLUMN `attribution_json` VARCHAR(2048) NOT NULL DEFAULT '{}';

ALTER TABLE `commission_submission` MODIFY COLUMN `actor_user_id` INTEGER NULL;

ALTER TABLE `commission_submission` ADD CONSTRAINT `commission_submission_actor_user_id_fkey` FOREIGN KEY (`actor_user_id`) REFERENCES `auth_user`(`id`) ON DELETE SET NULL ON UPDATE NO ACTION;

ALTER TABLE `commission_proof_attempt` ADD COLUMN `attribution_json` VARCHAR(2048) NOT NULL DEFAULT '{}';

ALTER TABLE `commission_proof_attempt` MODIFY COLUMN `issuer_user_id` INTEGER NULL;

ALTER TABLE `commission_proof_attempt` ADD CONSTRAINT `commission_proof_attempt_issuer_user_id_fkey` FOREIGN KEY (`issuer_user_id`) REFERENCES `auth_user`(`id`) ON DELETE SET NULL ON UPDATE NO ACTION;

ALTER TABLE `commission_invitation` MODIFY COLUMN `claimed_by_id` INTEGER NULL;

ALTER TABLE `commission_invitation` ADD CONSTRAINT `commission_invitation_claimed_by_id_fkey` FOREIGN KEY (`claimed_by_id`) REFERENCES `auth_user`(`id`) ON DELETE RESTRICT ON UPDATE NO ACTION;

CREATE TABLE `auth_user_deletion_record` (`id` INTEGER NOT NULL AUTO_INCREMENT, `public_id` VARCHAR(191) NOT NULL, `username` VARCHAR(255) NOT NULL, `user_snapshot_json` TEXT NOT NULL, `actor_snapshot_json` TEXT NOT NULL, `summary_json` TEXT NOT NULL, `user_created_at` DATETIME(3) NOT NULL, `deleted_at` DATETIME(3) NOT NULL DEFAULT CURRENT_TIMESTAMP(3), PRIMARY KEY (`id`)) ENGINE=InnoDB DEFAULT CHARACTER SET utf8mb4 COLLATE utf8mb4_unicode_ci;

CREATE UNIQUE INDEX `uq_auth_user_deletion_public_id` ON `auth_user_deletion_record`(`public_id`);

CREATE INDEX `idx_auth_user_deletion_deleted_at` ON `auth_user_deletion_record`(`deleted_at`);
