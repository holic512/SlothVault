ALTER TABLE `blog_article` ADD COLUMN `public_id` VARCHAR(36) NULL, ADD COLUMN `legacy_url_id` INTEGER NULL;

UPDATE `blog_article` SET `public_id` = LOWER(CONCAT(HEX(RANDOM_BYTES(4)), '-', HEX(RANDOM_BYTES(2)), '-4', SUBSTRING(HEX(RANDOM_BYTES(2)), 2), '-', SUBSTRING('89ab', 1 + MOD(ORD(RANDOM_BYTES(1)), 4), 1), SUBSTRING(HEX(RANDOM_BYTES(2)), 2), '-', HEX(RANDOM_BYTES(6)))), `legacy_url_id` = `id`;

ALTER TABLE `blog_article` MODIFY `public_id` VARCHAR(36) NOT NULL, ADD UNIQUE INDEX `uq_blog_article_public_id` (`public_id`), ADD UNIQUE INDEX `uq_blog_article_legacy_url_id` (`legacy_url_id`);

ALTER TABLE `collections_project` ADD COLUMN `public_id` VARCHAR(36) NULL, ADD COLUMN `legacy_url_id` INTEGER NULL;

UPDATE `collections_project` SET `public_id` = LOWER(CONCAT(HEX(RANDOM_BYTES(4)), '-', HEX(RANDOM_BYTES(2)), '-4', SUBSTRING(HEX(RANDOM_BYTES(2)), 2), '-', SUBSTRING('89ab', 1 + MOD(ORD(RANDOM_BYTES(1)), 4), 1), SUBSTRING(HEX(RANDOM_BYTES(2)), 2), '-', HEX(RANDOM_BYTES(6)))), `legacy_url_id` = `id`;

ALTER TABLE `collections_project` MODIFY `public_id` VARCHAR(36) NOT NULL, ADD UNIQUE INDEX `uq_collections_project_public_id` (`public_id`), ADD UNIQUE INDEX `uq_collections_project_legacy_url_id` (`legacy_url_id`);

ALTER TABLE `collections_project_version` ADD COLUMN `public_id` VARCHAR(36) NULL, ADD COLUMN `legacy_url_id` INTEGER NULL;

UPDATE `collections_project_version` SET `public_id` = LOWER(CONCAT(HEX(RANDOM_BYTES(4)), '-', HEX(RANDOM_BYTES(2)), '-4', SUBSTRING(HEX(RANDOM_BYTES(2)), 2), '-', SUBSTRING('89ab', 1 + MOD(ORD(RANDOM_BYTES(1)), 4), 1), SUBSTRING(HEX(RANDOM_BYTES(2)), 2), '-', HEX(RANDOM_BYTES(6)))), `legacy_url_id` = `id`;

ALTER TABLE `collections_project_version` MODIFY `public_id` VARCHAR(36) NOT NULL, ADD UNIQUE INDEX `uq_collections_project_version_public_id` (`public_id`), ADD UNIQUE INDEX `uq_collections_project_version_legacy_url_id` (`legacy_url_id`);

ALTER TABLE `docs_note_info` ADD COLUMN `public_id` VARCHAR(36) NULL, ADD COLUMN `legacy_url_id` INTEGER NULL;

UPDATE `docs_note_info` SET `public_id` = LOWER(CONCAT(HEX(RANDOM_BYTES(4)), '-', HEX(RANDOM_BYTES(2)), '-4', SUBSTRING(HEX(RANDOM_BYTES(2)), 2), '-', SUBSTRING('89ab', 1 + MOD(ORD(RANDOM_BYTES(1)), 4), 1), SUBSTRING(HEX(RANDOM_BYTES(2)), 2), '-', HEX(RANDOM_BYTES(6)))), `legacy_url_id` = `id`;

ALTER TABLE `docs_note_info` MODIFY `public_id` VARCHAR(36) NOT NULL, ADD UNIQUE INDEX `uq_docs_note_info_public_id` (`public_id`), ADD UNIQUE INDEX `uq_docs_note_info_legacy_url_id` (`legacy_url_id`);
