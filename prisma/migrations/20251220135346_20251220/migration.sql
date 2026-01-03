/*
  Warnings:

  - You are about to drop the column `contentType` on the `NoteContent` table. All the data in the column will be lost.

*/
-- AlterTable
ALTER TABLE "docs"."NoteContent" DROP COLUMN "contentType";
