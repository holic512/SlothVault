-- Generalize release credentials so one ledger can evidence either a project release or a note content revision.
ALTER TABLE "docs_note_content" ADD COLUMN "evidence_id" TEXT;
CREATE UNIQUE INDEX "uq_docs_note_content_evidence_id" ON "docs_note_content"("evidence_id");

ALTER TABLE "release_credential" ADD COLUMN "note_content_id" INTEGER REFERENCES "docs_note_content"("id") ON DELETE RESTRICT ON UPDATE NO ACTION;
ALTER TABLE "release_credential" ADD COLUMN "subject_type" TEXT NOT NULL DEFAULT 'PROJECT_VERSION';
ALTER TABLE "release_credential" ADD COLUMN "subject_id" TEXT NOT NULL DEFAULT '';
ALTER TABLE "release_credential" ADD COLUMN "subject_hash" TEXT NOT NULL DEFAULT '';
ALTER TABLE "release_credential" ADD COLUMN "subject_manifest_version" INTEGER NOT NULL DEFAULT 1;

UPDATE "release_credential"
SET "subject_id" = (
        SELECT "release_id" FROM "collections_project_version"
        WHERE "collections_project_version"."id" = "release_credential"."project_version_id"
    ),
    "subject_hash" = (
        SELECT "release_hash" FROM "collections_project_version"
        WHERE "collections_project_version"."id" = "release_credential"."project_version_id"
    ),
    "subject_manifest_version" = (
        SELECT "manifest_version" FROM "collections_project_version"
        WHERE "collections_project_version"."id" = "release_credential"."project_version_id"
    );

DROP INDEX "uq_release_credential_version_network";
CREATE UNIQUE INDEX "uq_release_credential_subject_network" ON "release_credential"("subject_type", "subject_id", "network");
CREATE INDEX "idx_release_credential_note_content" ON "release_credential"("note_content_id");
