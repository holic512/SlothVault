-- CreateTable
CREATE TABLE "system_config" (
    "id" BIGSERIAL NOT NULL,
    "config_key" VARCHAR(100) NOT NULL,
    "config_value" VARCHAR(500) NOT NULL,
    "description" VARCHAR(255),
    "created_at" TIMESTAMPTZ(6) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "updated_at" TIMESTAMPTZ(6) NOT NULL DEFAULT CURRENT_TIMESTAMP,

    CONSTRAINT "system_config_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "merkle_tree" (
    "id" BIGSERIAL NOT NULL,
    "name" VARCHAR(128) NOT NULL,
    "tree_address" VARCHAR(64) NOT NULL,
    "tree_authority" VARCHAR(64) NOT NULL,
    "creator_address" VARCHAR(64) NOT NULL,
    "max_depth" SMALLINT NOT NULL,
    "max_buffer_size" SMALLINT NOT NULL,
    "canopy_depth" SMALLINT NOT NULL,
    "network" VARCHAR(20) NOT NULL DEFAULT 'devnet',
    "total_minted" INTEGER NOT NULL DEFAULT 0,
    "max_capacity" BIGINT NOT NULL,
    "creation_cost" BIGINT NOT NULL,
    "tx_signature" VARCHAR(128),
    "status" SMALLINT NOT NULL DEFAULT 0,
    "created_at" TIMESTAMPTZ(6) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "updated_at" TIMESTAMPTZ(6) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "is_deleted" BOOLEAN NOT NULL DEFAULT false,

    CONSTRAINT "merkle_tree_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "compressed_nft" (
    "id" BIGSERIAL NOT NULL,
    "merkle_tree_id" BIGINT NOT NULL,
    "asset_id" VARCHAR(64) NOT NULL,
    "leaf_index" INTEGER NOT NULL,
    "name" VARCHAR(128) NOT NULL,
    "symbol" VARCHAR(32),
    "metadata_uri" VARCHAR(500),
    "owner_address" VARCHAR(64) NOT NULL,
    "mint_tx_signature" VARCHAR(128),
    "status" SMALLINT NOT NULL DEFAULT 0,
    "created_at" TIMESTAMPTZ(6) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "updated_at" TIMESTAMPTZ(6) NOT NULL DEFAULT CURRENT_TIMESTAMP,

    CONSTRAINT "compressed_nft_pkey" PRIMARY KEY ("id")
);

-- CreateIndex
CREATE UNIQUE INDEX "system_config_config_key_key" ON "system_config"("config_key");

-- CreateIndex
CREATE UNIQUE INDEX "merkle_tree_tree_address_key" ON "merkle_tree"("tree_address");

-- CreateIndex
CREATE INDEX "idx_merkle_tree_network" ON "merkle_tree"("network");

-- CreateIndex
CREATE INDEX "idx_merkle_tree_creator" ON "merkle_tree"("creator_address");

-- CreateIndex
CREATE UNIQUE INDEX "compressed_nft_asset_id_key" ON "compressed_nft"("asset_id");

-- CreateIndex
CREATE INDEX "idx_cnft_merkle_tree_id" ON "compressed_nft"("merkle_tree_id");

-- CreateIndex
CREATE INDEX "idx_cnft_owner" ON "compressed_nft"("owner_address");

-- AddForeignKey
ALTER TABLE "compressed_nft" ADD CONSTRAINT "fk_cnft_merkle_tree" FOREIGN KEY ("merkle_tree_id") REFERENCES "merkle_tree"("id") ON DELETE CASCADE ON UPDATE NO ACTION;
