CREATE TABLE "mcp_api_key" (
    "id" INTEGER NOT NULL PRIMARY KEY AUTOINCREMENT,
    "user_id" INTEGER NOT NULL,
    "public_id" TEXT NOT NULL,
    "secret_hash" TEXT NOT NULL,
    "name" TEXT NOT NULL,
    "status" INTEGER NOT NULL DEFAULT 1,
    "expires_at" DATETIME,
    "last_used_at" DATETIME,
    "created_at" DATETIME NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "updated_at" DATETIME NOT NULL DEFAULT CURRENT_TIMESTAMP,
    CONSTRAINT "mcp_api_key_user_id_fkey" FOREIGN KEY ("user_id") REFERENCES "auth_user" ("id") ON DELETE CASCADE ON UPDATE NO ACTION,
    CONSTRAINT "uq_mcp_api_key_public_id" UNIQUE ("public_id")
);

CREATE INDEX "idx_mcp_api_key_user_status" ON "mcp_api_key"("user_id", "status");
CREATE INDEX "idx_mcp_api_key_status_expires" ON "mcp_api_key"("status", "expires_at");
