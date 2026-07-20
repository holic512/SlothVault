-- Expand the original administrator account into the shared Web2 identity model.
ALTER TABLE "auth_user" ADD COLUMN "password_configured" BOOLEAN NOT NULL DEFAULT true;
ALTER TABLE "auth_user" ADD COLUMN "display_name" TEXT;
ALTER TABLE "auth_user" ADD COLUMN "avatar" TEXT;
ALTER TABLE "auth_user" ADD COLUMN "bio" TEXT;
ALTER TABLE "auth_user" ADD COLUMN "role" TEXT NOT NULL DEFAULT 'USER';
ALTER TABLE "auth_user" ADD COLUMN "status" INTEGER NOT NULL DEFAULT 1;
ALTER TABLE "auth_user" ADD COLUMN "points_balance" INTEGER NOT NULL DEFAULT 0;
ALTER TABLE "auth_user" ADD COLUMN "wallet_address" TEXT;
ALTER TABLE "auth_user" ADD COLUMN "last_login_at" DATETIME;

-- Every pre-migration account was created through the administrator installer.
UPDATE "auth_user" SET "role" = 'ADMIN';
UPDATE "auth_user" SET "username" = LOWER("username"), "email" = LOWER("email");
UPDATE "collections_project" SET "require_auth" = false;

CREATE UNIQUE INDEX "uq_auth_user_email" ON "auth_user"("email");
CREATE UNIQUE INDEX "uq_auth_user_wallet_address" ON "auth_user"("wallet_address");
CREATE INDEX "idx_auth_user_role_status" ON "auth_user"("role", "status");

ALTER TABLE "docs_note_info" ADD COLUMN "author_id" INTEGER;
UPDATE "docs_note_info"
SET "author_id" = (SELECT "id" FROM "auth_user" WHERE "role" = 'ADMIN' ORDER BY "id" LIMIT 1)
WHERE "author_id" IS NULL;
CREATE INDEX "idx_docs_note_info_author_id" ON "docs_note_info"("author_id");

CREATE TABLE "points_transaction" (
    "id" INTEGER NOT NULL PRIMARY KEY AUTOINCREMENT,
    "user_id" INTEGER NOT NULL,
    "amount" INTEGER NOT NULL,
    "balance_after" INTEGER NOT NULL,
    "type" TEXT NOT NULL,
    "reference_id" TEXT,
    "description" TEXT,
    "created_at" DATETIME NOT NULL DEFAULT CURRENT_TIMESTAMP,
    CONSTRAINT "points_transaction_user_id_fkey" FOREIGN KEY ("user_id") REFERENCES "auth_user" ("id") ON DELETE CASCADE ON UPDATE NO ACTION
);

CREATE TABLE "points_gift_card_batch" (
    "id" INTEGER NOT NULL PRIMARY KEY AUTOINCREMENT,
    "name" TEXT NOT NULL,
    "points" INTEGER NOT NULL,
    "quantity" INTEGER NOT NULL,
    "expires_at" DATETIME,
    "status" INTEGER NOT NULL DEFAULT 1,
    "created_by_id" INTEGER NOT NULL,
    "created_at" DATETIME NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "updated_at" DATETIME NOT NULL DEFAULT CURRENT_TIMESTAMP,
    CONSTRAINT "points_gift_card_batch_created_by_id_fkey" FOREIGN KEY ("created_by_id") REFERENCES "auth_user" ("id") ON DELETE RESTRICT ON UPDATE NO ACTION
);

CREATE TABLE "points_gift_card" (
    "id" INTEGER NOT NULL PRIMARY KEY AUTOINCREMENT,
    "batch_id" INTEGER NOT NULL,
    "code_hash" TEXT NOT NULL,
    "code_hint" TEXT NOT NULL,
    "status" INTEGER NOT NULL DEFAULT 1,
    "redeemed_by_id" INTEGER,
    "redeemed_at" DATETIME,
    "created_at" DATETIME NOT NULL DEFAULT CURRENT_TIMESTAMP,
    CONSTRAINT "points_gift_card_batch_id_fkey" FOREIGN KEY ("batch_id") REFERENCES "points_gift_card_batch" ("id") ON DELETE CASCADE ON UPDATE NO ACTION,
    CONSTRAINT "points_gift_card_redeemed_by_id_fkey" FOREIGN KEY ("redeemed_by_id") REFERENCES "auth_user" ("id") ON DELETE SET NULL ON UPDATE NO ACTION
);

CREATE INDEX "idx_points_transaction_user_created" ON "points_transaction"("user_id", "created_at");
CREATE INDEX "idx_points_transaction_reference" ON "points_transaction"("type", "reference_id");
CREATE INDEX "idx_gift_card_batch_creator" ON "points_gift_card_batch"("created_by_id");
CREATE INDEX "idx_gift_card_batch_status_expires" ON "points_gift_card_batch"("status", "expires_at");
CREATE UNIQUE INDEX "uq_gift_card_code_hash" ON "points_gift_card"("code_hash");
CREATE INDEX "idx_gift_card_batch_status" ON "points_gift_card"("batch_id", "status");
CREATE INDEX "idx_gift_card_redeemed_by" ON "points_gift_card"("redeemed_by_id");

-- cNFTs remain optional chain records, now attached to an article/copyright owner instead of read access.
ALTER TABLE "solana_compressed_nft" ADD COLUMN "note_info_id" INTEGER;
ALTER TABLE "solana_compressed_nft" ADD COLUMN "copyright_owner_id" INTEGER;
CREATE INDEX "idx_solana_compressed_nft_note_info_id" ON "solana_compressed_nft"("note_info_id");
CREATE INDEX "idx_solana_compressed_nft_copyright_owner_id" ON "solana_compressed_nft"("copyright_owner_id");
