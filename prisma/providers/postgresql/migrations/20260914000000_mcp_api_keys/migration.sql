CREATE TABLE "mcp_api_key" (
    "id" SERIAL NOT NULL,
    "user_id" INTEGER NOT NULL,
    "public_id" VARCHAR(32) NOT NULL,
    "secret_hash" VARCHAR(255) NOT NULL,
    "name" VARCHAR(80) NOT NULL,
    "status" SMALLINT NOT NULL DEFAULT 1,
    "expires_at" TIMESTAMPTZ(3),
    "last_used_at" TIMESTAMPTZ(3),
    "created_at" TIMESTAMPTZ(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "updated_at" TIMESTAMPTZ(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,

    CONSTRAINT "mcp_api_key_pkey" PRIMARY KEY ("id"),
    CONSTRAINT "mcp_api_key_user_id_fkey" FOREIGN KEY ("user_id") REFERENCES "auth_user"("id") ON DELETE CASCADE ON UPDATE NO ACTION
);

CREATE UNIQUE INDEX "uq_mcp_api_key_public_id" ON "mcp_api_key"("public_id");
CREATE INDEX "idx_mcp_api_key_user_status" ON "mcp_api_key"("user_id", "status");
CREATE INDEX "idx_mcp_api_key_status_expires" ON "mcp_api_key"("status", "expires_at");
