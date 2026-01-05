-- AlterTable
ALTER TABLE "compressed_nft" ADD COLUMN     "description" TEXT,
ADD COLUMN     "image_cid" VARCHAR(128),
ADD COLUMN     "metadata_cid" VARCHAR(128),
ADD COLUMN     "original_image_id" BIGINT;
