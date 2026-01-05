/*
  Warnings:

  - Added the required column `encrypted_key` to the `merkle_tree` table without a default value. This is not possible if the table is not empty.

*/
-- AlterTable
ALTER TABLE "merkle_tree" ADD COLUMN     "encrypted_key" TEXT NOT NULL;
