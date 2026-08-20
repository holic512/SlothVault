-- Generalize release credentials so one ledger can evidence either a project release or a note content revision.
ALTER TABLE `docs_note_content` ADD COLUMN `evidence_id` CHAR(36) NULL;
CREATE UNIQUE INDEX `uq_docs_note_content_evidence_id` ON `docs_note_content`(`evidence_id`);

ALTER TABLE `release_credential`
    ADD COLUMN `note_content_id` INTEGER NULL,
    ADD COLUMN `subject_type` VARCHAR(32) NOT NULL DEFAULT 'PROJECT_VERSION',
    ADD COLUMN `subject_id` CHAR(36) NULL,
    ADD COLUMN `subject_hash` CHAR(64) NULL,
    ADD COLUMN `subject_manifest_version` INTEGER NULL;

UPDATE `release_credential` AS credential
INNER JOIN `collections_project_version` AS version ON version.`id` = credential.`project_version_id`
SET credential.`subject_id` = version.`release_id`,
    credential.`subject_hash` = version.`release_hash`,
    credential.`subject_manifest_version` = version.`manifest_version`;

ALTER TABLE `release_credential`
    MODIFY `subject_id` CHAR(36) NOT NULL,
    MODIFY `subject_hash` CHAR(64) NOT NULL,
    MODIFY `subject_manifest_version` INTEGER NOT NULL;

DROP INDEX `uq_release_credential_version_network` ON `release_credential`;
CREATE UNIQUE INDEX `uq_release_credential_subject_network` ON `release_credential`(`subject_type`, `subject_id`, `network`);
CREATE INDEX `idx_release_credential_note_content` ON `release_credential`(`note_content_id`);

ALTER TABLE `release_credential` ADD CONSTRAINT `release_credential_note_content_id_fkey` FOREIGN KEY (`note_content_id`) REFERENCES `docs_note_content`(`id`) ON DELETE RESTRICT ON UPDATE NO ACTION;
