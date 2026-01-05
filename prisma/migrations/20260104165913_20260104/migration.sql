/*
  Warnings:

  - Added the required column `project_id` to the `compressed_nft` table without a default value. This is not possible if the table is not empty.

*/
-- DropIndex
DROP INDEX "idx_merkle_tree_network";

-- AlterTable
ALTER TABLE "compressed_nft" ADD COLUMN     "project_id" BIGINT NOT NULL;

-- AlterTable
ALTER TABLE "merkle_tree" ADD COLUMN     "priority" INTEGER NOT NULL DEFAULT 0;

-- CreateIndex
CREATE INDEX "idx_cnft_project_id" ON "compressed_nft"("project_id");

-- CreateIndex
CREATE INDEX "idx_cnft_project_owner" ON "compressed_nft"("project_id", "owner_address");

-- CreateIndex
CREATE INDEX "idx_merkle_tree_network_status" ON "merkle_tree"("network", "status");
