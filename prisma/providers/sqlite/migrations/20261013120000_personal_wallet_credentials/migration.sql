ALTER TABLE "auth_user" ADD COLUMN "username_change_month" TEXT;
ALTER TABLE "auth_user" ADD COLUMN "username_change_count" INTEGER NOT NULL DEFAULT 0;
ALTER TABLE "auth_user" ADD COLUMN "credentials_revision" INTEGER NOT NULL DEFAULT 0;
CREATE TABLE "auth_user_wallet" (
  "id" INTEGER NOT NULL PRIMARY KEY AUTOINCREMENT,
  "user_id" INTEGER NOT NULL,
  "address" TEXT COLLATE BINARY NOT NULL,
  "created_at" DATETIME NOT NULL DEFAULT CURRENT_TIMESTAMP,
  CONSTRAINT "fk_auth_user_wallet_user" FOREIGN KEY ("user_id") REFERENCES "auth_user"("id") ON DELETE CASCADE ON UPDATE NO ACTION
);
CREATE UNIQUE INDEX "uq_auth_user_wallet_address_binding" ON "auth_user_wallet"("address");
CREATE INDEX "idx_auth_user_wallet_user_created" ON "auth_user_wallet"("user_id", "created_at", "id");
INSERT INTO "auth_user_wallet"("user_id", "address") SELECT "id", "wallet_address" FROM "auth_user" WHERE "wallet_address" IS NOT NULL ORDER BY "id";
