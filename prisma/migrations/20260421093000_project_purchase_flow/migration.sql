-- AlterTable
ALTER TABLE "collections"."Project"
ADD COLUMN "accessPriceLamports" BIGINT;

-- AlterTable
ALTER TABLE "compressed_nft"
ADD COLUMN "grant_source" VARCHAR(20) NOT NULL DEFAULT 'manual',
ADD COLUMN "purchase_record_id" BIGINT;

-- CreateTable
CREATE TABLE "project_purchase_record" (
    "id" BIGSERIAL NOT NULL,
    "project_id" BIGINT NOT NULL,
    "buyer_wallet_address" VARCHAR(64) NOT NULL,
    "receiver_wallet_address" VARCHAR(64) NOT NULL,
    "network" VARCHAR(20) NOT NULL,
    "price_lamports" BIGINT NOT NULL,
    "tx_signature" VARCHAR(128),
    "cnft_id" BIGINT,
    "asset_id" VARCHAR(64),
    "status" SMALLINT NOT NULL DEFAULT 0,
    "failure_reason" TEXT,
    "confirmed_at" TIMESTAMPTZ(6),
    "created_at" TIMESTAMPTZ(6) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "updated_at" TIMESTAMPTZ(6) NOT NULL DEFAULT CURRENT_TIMESTAMP,

    CONSTRAINT "project_purchase_record_pkey" PRIMARY KEY ("id")
);

-- CreateIndex
CREATE INDEX "idx_cnft_purchase_record_id" ON "compressed_nft"("purchase_record_id");

-- CreateIndex
CREATE INDEX "idx_project_purchase_project_id" ON "project_purchase_record"("project_id");

-- CreateIndex
CREATE INDEX "idx_project_purchase_buyer_wallet" ON "project_purchase_record"("buyer_wallet_address");

-- CreateIndex
CREATE INDEX "idx_project_purchase_network_status" ON "project_purchase_record"("network", "status");

-- CreateIndex
CREATE INDEX "idx_project_purchase_tx_signature" ON "project_purchase_record"("tx_signature");

-- AddForeignKey
ALTER TABLE "compressed_nft"
ADD CONSTRAINT "fk_cnft_purchase_record" FOREIGN KEY ("purchase_record_id") REFERENCES "project_purchase_record"("id") ON DELETE SET NULL ON UPDATE NO ACTION;
