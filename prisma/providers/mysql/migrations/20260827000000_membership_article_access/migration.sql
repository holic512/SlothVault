CREATE TABLE `membership_level` (
    `id` INTEGER NOT NULL AUTO_INCREMENT,
    `name` VARCHAR(80) NOT NULL,
    `rank` SMALLINT NOT NULL,
    `price_points` INTEGER NOT NULL,
    `validity_days` INTEGER NULL,
    `status` SMALLINT NOT NULL DEFAULT 1,
    `created_at` DATETIME(3) NOT NULL DEFAULT CURRENT_TIMESTAMP(3),
    `updated_at` DATETIME(3) NOT NULL DEFAULT CURRENT_TIMESTAMP(3),

    UNIQUE INDEX `uq_membership_level_rank`(`rank`),
    INDEX `idx_membership_level_status_rank`(`status`, `rank`),
    PRIMARY KEY (`id`)
) DEFAULT CHARACTER SET utf8mb4 COLLATE utf8mb4_unicode_ci;

CREATE TABLE `membership_grant` (
    `id` INTEGER NOT NULL AUTO_INCREMENT,
    `user_id` INTEGER NOT NULL,
    `membership_level_id` INTEGER NOT NULL,
    `source` VARCHAR(32) NOT NULL,
    `points_cost` INTEGER NULL,
    `granted_by_user_id` INTEGER NULL,
    `granted_at` DATETIME(3) NOT NULL DEFAULT CURRENT_TIMESTAMP(3),
    `expires_at` DATETIME(3) NULL,
    `revoked_at` DATETIME(3) NULL,
    `revoked_by_user_id` INTEGER NULL,

    INDEX `idx_membership_grant_user_active`(`user_id`, `revoked_at`, `expires_at`),
    INDEX `idx_membership_grant_level`(`membership_level_id`),
    PRIMARY KEY (`id`),
    CONSTRAINT `membership_grant_user_id_fkey` FOREIGN KEY (`user_id`) REFERENCES `auth_user`(`id`) ON DELETE RESTRICT ON UPDATE NO ACTION,
    CONSTRAINT `membership_grant_level_id_fkey` FOREIGN KEY (`membership_level_id`) REFERENCES `membership_level`(`id`) ON DELETE RESTRICT ON UPDATE NO ACTION,
    CONSTRAINT `membership_grant_granted_by_user_id_fkey` FOREIGN KEY (`granted_by_user_id`) REFERENCES `auth_user`(`id`) ON DELETE SET NULL ON UPDATE NO ACTION,
    CONSTRAINT `membership_grant_revoked_by_user_id_fkey` FOREIGN KEY (`revoked_by_user_id`) REFERENCES `auth_user`(`id`) ON DELETE SET NULL ON UPDATE NO ACTION
) DEFAULT CHARACTER SET utf8mb4 COLLATE utf8mb4_unicode_ci;

ALTER TABLE `blog_article` ADD COLUMN `required_membership_level_id` INTEGER NULL;
ALTER TABLE `blog_article`
  ADD CONSTRAINT `blog_article_required_membership_level_id_fkey`
  FOREIGN KEY (`required_membership_level_id`) REFERENCES `membership_level`(`id`) ON DELETE RESTRICT ON UPDATE NO ACTION;
CREATE INDEX `idx_blog_article_required_membership_level` ON `blog_article`(`required_membership_level_id`);
