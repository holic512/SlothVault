-- Generalize release credentials so one ledger can evidence either a project release or a note content revision.
ALTER TABLE "docs_note_content" ADD COLUMN "evidence_id" UUID;
CREATE UNIQUE INDEX "uq_docs_note_content_evidence_id" ON "docs_note_content"("evidence_id");

ALTER TABLE "release_credential" ADD COLUMN "note_content_id" INTEGER;
ALTER TABLE "release_credential" ADD COLUMN "subject_type" VARCHAR(32) NOT NULL DEFAULT 'PROJECT_VERSION';
ALTER TABLE "release_credential" ADD COLUMN "subject_id" UUID;
ALTER TABLE "release_credential" ADD COLUMN "subject_hash" CHAR(64);
ALTER TABLE "release_credential" ADD COLUMN "subject_manifest_version" INTEGER;

UPDATE "release_credential" AS credential
SET "subject_id" = version."release_id"::uuid,
    "subject_hash" = version."release_hash",
    "subject_manifest_version" = version."manifest_version"
FROM "collections_project_version" AS version
WHERE version."id" = credential."project_version_id";

ALTER TABLE "release_credential" ALTER COLUMN "subject_id" SET NOT NULL;
ALTER TABLE "release_credential" ALTER COLUMN "subject_hash" SET NOT NULL;
ALTER TABLE "release_credential" ALTER COLUMN "subject_manifest_version" SET NOT NULL;

DROP INDEX "uq_release_credential_version_network";
CREATE UNIQUE INDEX "uq_release_credential_subject_network" ON "release_credential"("subject_type", "subject_id", "network");
CREATE INDEX "idx_release_credential_note_content" ON "release_credential"("note_content_id");

ALTER TABLE "release_credential" ADD CONSTRAINT "release_credential_note_content_id_fkey" FOREIGN KEY ("note_content_id") REFERENCES "docs_note_content"("id") ON DELETE RESTRICT ON UPDATE NO ACTION;
