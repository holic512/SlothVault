/*
  Warnings:

  - You are about to drop the `NoteAttachment` table. If the table is not empty, all the data it contains will be lost.

*/
-- DropForeignKey
ALTER TABLE "docs"."NoteAttachment" DROP CONSTRAINT "fk_noteattachment_notecontent";

-- DropTable
DROP TABLE "docs"."NoteAttachment";
