CREATE TABLE `knowledge_package` (
    `id` INTEGER NOT NULL AUTO_INCREMENT,
    `project_version_id` INTEGER NOT NULL,
    `package_kind` VARCHAR(16) NOT NULL,
    `title` VARCHAR(255) NOT NULL,
    `summary` TEXT NULL,
    `schema_version` INTEGER NOT NULL,
    `package_hash` CHAR(64) NOT NULL,
    `manifest` LONGTEXT NOT NULL,
    `created_at` DATETIME(3) NOT NULL DEFAULT CURRENT_TIMESTAMP(3),

    INDEX `idx_knowledge_package_project_version_id`(`project_version_id`),
    PRIMARY KEY (`id`),
    CONSTRAINT `knowledge_package_project_version_id_fkey` FOREIGN KEY (`project_version_id`) REFERENCES `collections_project_version`(`id`) ON DELETE CASCADE ON UPDATE NO ACTION
) DEFAULT CHARACTER SET utf8mb4 COLLATE utf8mb4_unicode_ci;

CREATE TABLE `knowledge_article` (
    `id` INTEGER NOT NULL AUTO_INCREMENT,
    `package_id` INTEGER NOT NULL,
    `note_info_id` INTEGER NOT NULL,
    `external_id` VARCHAR(128) NOT NULL,
    `slug` VARCHAR(160) NOT NULL,
    `article_type` VARCHAR(64) NOT NULL,
    `summary` TEXT NULL,
    `tags_json` TEXT NOT NULL,
    `source_references_json` LONGTEXT NOT NULL,
    `created_at` DATETIME(3) NOT NULL DEFAULT CURRENT_TIMESTAMP(3),

    UNIQUE INDEX `uq_knowledge_article_note_info_id`(`note_info_id`),
    UNIQUE INDEX `uq_knowledge_article_package_external_id`(`package_id`, `external_id`),
    INDEX `idx_knowledge_article_package_id`(`package_id`),
    PRIMARY KEY (`id`),
    CONSTRAINT `knowledge_article_package_id_fkey` FOREIGN KEY (`package_id`) REFERENCES `knowledge_package`(`id`) ON DELETE CASCADE ON UPDATE NO ACTION,
    CONSTRAINT `knowledge_article_note_info_id_fkey` FOREIGN KEY (`note_info_id`) REFERENCES `docs_note_info`(`id`) ON DELETE CASCADE ON UPDATE NO ACTION
) DEFAULT CHARACTER SET utf8mb4 COLLATE utf8mb4_unicode_ci;
