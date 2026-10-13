ALTER TABLE `auth_user`
  ADD COLUMN `username_change_month` VARCHAR(7) NULL,
  ADD COLUMN `username_change_count` INTEGER NOT NULL DEFAULT 0,
  ADD COLUMN `credentials_revision` INTEGER NOT NULL DEFAULT 0,
  MODIFY COLUMN `wallet_address` VARCHAR(64) CHARACTER SET ascii COLLATE ascii_bin NULL;
CREATE TABLE `auth_user_wallet` (
  `id` INTEGER NOT NULL AUTO_INCREMENT,
  `user_id` INTEGER NOT NULL,
  `address` VARCHAR(64) CHARACTER SET ascii COLLATE ascii_bin NOT NULL,
  `created_at` DATETIME(3) NOT NULL DEFAULT CURRENT_TIMESTAMP(3),
  PRIMARY KEY (`id`),
  UNIQUE KEY `uq_auth_user_wallet_address_binding` (`address`),
  KEY `idx_auth_user_wallet_user_created` (`user_id`, `created_at`, `id`),
  CONSTRAINT `fk_auth_user_wallet_user` FOREIGN KEY (`user_id`) REFERENCES `auth_user`(`id`) ON DELETE CASCADE ON UPDATE NO ACTION
) DEFAULT CHARACTER SET utf8mb4 COLLATE utf8mb4_unicode_ci;
INSERT INTO `auth_user_wallet`(`user_id`, `address`) SELECT `id`, `wallet_address` FROM `auth_user` WHERE `wallet_address` IS NOT NULL ORDER BY `id`;
