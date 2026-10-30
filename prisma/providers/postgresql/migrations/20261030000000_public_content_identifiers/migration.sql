ALTER TABLE "blog_article" ADD COLUMN "public_id" VARCHAR(36), ADD COLUMN "legacy_url_id" INTEGER;

UPDATE "blog_article" SET "public_id" = gen_random_uuid()::text, "legacy_url_id" = "id";

ALTER TABLE "blog_article" ALTER COLUMN "public_id" SET NOT NULL;

CREATE UNIQUE INDEX "uq_blog_article_public_id" ON "blog_article"("public_id");

CREATE UNIQUE INDEX "uq_blog_article_legacy_url_id" ON "blog_article"("legacy_url_id");

ALTER TABLE "collections_project" ADD COLUMN "public_id" VARCHAR(36), ADD COLUMN "legacy_url_id" INTEGER;

UPDATE "collections_project" SET "public_id" = gen_random_uuid()::text, "legacy_url_id" = "id";

ALTER TABLE "collections_project" ALTER COLUMN "public_id" SET NOT NULL;

CREATE UNIQUE INDEX "uq_collections_project_public_id" ON "collections_project"("public_id");

CREATE UNIQUE INDEX "uq_collections_project_legacy_url_id" ON "collections_project"("legacy_url_id");

ALTER TABLE "collections_project_version" ADD COLUMN "public_id" VARCHAR(36), ADD COLUMN "legacy_url_id" INTEGER;

UPDATE "collections_project_version" SET "public_id" = gen_random_uuid()::text, "legacy_url_id" = "id";

ALTER TABLE "collections_project_version" ALTER COLUMN "public_id" SET NOT NULL;

CREATE UNIQUE INDEX "uq_collections_project_version_public_id" ON "collections_project_version"("public_id");

CREATE UNIQUE INDEX "uq_collections_project_version_legacy_url_id" ON "collections_project_version"("legacy_url_id");

ALTER TABLE "docs_note_info" ADD COLUMN "public_id" VARCHAR(36), ADD COLUMN "legacy_url_id" INTEGER;

UPDATE "docs_note_info" SET "public_id" = gen_random_uuid()::text, "legacy_url_id" = "id";

ALTER TABLE "docs_note_info" ALTER COLUMN "public_id" SET NOT NULL;

CREATE UNIQUE INDEX "uq_docs_note_info_public_id" ON "docs_note_info"("public_id");

CREATE UNIQUE INDEX "uq_docs_note_info_legacy_url_id" ON "docs_note_info"("legacy_url_id");
