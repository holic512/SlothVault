CREATE TABLE `mcp_api_key` (
    `id` INTEGER NOT NULL AUTO_INCREMENT,
    `user_id` INTEGER NOT NULL,
    `public_id` VARCHAR(32) NOT NULL,
    `secret_hash` VARCHAR(255) NOT NULL,
    `name` VARCHAR(80) NOT NULL,
    `status` SMALLINT NOT NULL DEFAULT 1,
    `expires_at` DATETIME(3) NULL,
    `last_used_at` DATETIME(3) NULL,
    `created_at` DATETIME(3) NOT NULL DEFAULT CURRENT_TIMESTAMP(3),
    `updated_at` DATETIME(3) NOT NULL DEFAULT CURRENT_TIMESTAMP(3),

    UNIQUE INDEX `uq_mcp_api_key_public_id`(`public_id`),
    INDEX `idx_mcp_api_key_user_status`(`user_id`, `status`),
    INDEX `idx_mcp_api_key_status_expires`(`status`, `expires_at`),
    PRIMARY KEY (`id`),
    CONSTRAINT `mcp_api_key_user_id_fkey` FOREIGN KEY (`user_id`) REFERENCES `auth_user`(`id`) ON DELETE CASCADE ON UPDATE NO ACTION
) DEFAULT CHARACTER SET utf8mb4 COLLATE utf8mb4_unicode_ci;
