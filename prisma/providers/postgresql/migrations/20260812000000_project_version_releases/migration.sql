-- Add immutable project-version release identity and publication metadata.
ALTER TABLE "collections_project_version"
    ADD COLUMN "document_revision" INTEGER NOT NULL DEFAULT 0,
    ADD COLUMN "release_id" VARCHAR(36),
    ADD COLUMN "release_hash" CHAR(64),
    ADD COLUMN "manifest_version" INTEGER,
    ADD COLUMN "published_at" TIMESTAMPTZ(3);

-- Historical visibility flags were not strict releases; migrate every version to a draft.
UPDATE "collections_project_version"
SET "status" = 0,
    "release_id" = NULL,
    "release_hash" = NULL,
    "manifest_version" = NULL,
    "published_at" = NULL;

CREATE UNIQUE INDEX "uq_collections_project_version_release_id"
ON "collections_project_version"("release_id");
CREATE UNIQUE INDEX "uq_collections_project_version_release_hash"
ON "collections_project_version"("release_hash");
