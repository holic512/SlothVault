PRAGMA foreign_keys=OFF;

BEGIN TRANSACTION;

CREATE TEMP TABLE public_id_sequences AS SELECT name, seq FROM sqlite_sequence;

CREATE TABLE "new_blog_article" (
"public_id" TEXT NOT NULL,
"legacy_url_id" INTEGER,
    "id" INTEGER NOT NULL PRIMARY KEY AUTOINCREMENT,
    "title" TEXT NOT NULL,
    "summary" TEXT,
    "cover" TEXT,
    "content" TEXT NOT NULL,
    "status" INTEGER NOT NULL DEFAULT 0,
    "published_at" DATETIME,
    "created_at" DATETIME NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "updated_at" DATETIME NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "is_deleted" BOOLEAN NOT NULL DEFAULT false
, "required_membership_level_id" INTEGER REFERENCES "membership_level"("id") ON DELETE RESTRICT ON UPDATE NO ACTION, "deleted_at" DATETIME);

INSERT INTO "new_blog_article" ("public_id", "legacy_url_id", "id", "title", "summary", "cover", "content", "status", "published_at", "created_at", "updated_at", "is_deleted", "required_membership_level_id", "deleted_at") SELECT lower(hex(randomblob(4)) || '-' || hex(randomblob(2)) || '-4' || substr(hex(randomblob(2)), 2) || '-' || substr('89ab', (random() & 3) + 1, 1) || substr(hex(randomblob(2)), 2) || '-' || hex(randomblob(6))), "id", "id", "title", "summary", "cover", "content", "status", "published_at", "created_at", "updated_at", "is_deleted", "required_membership_level_id", "deleted_at" FROM "blog_article";

DROP TABLE "blog_article";

ALTER TABLE "new_blog_article" RENAME TO "blog_article";

CREATE INDEX "idx_blog_article_public"
ON "blog_article"("status", "is_deleted", "published_at");

CREATE INDEX "idx_blog_article_required_membership_level" ON "blog_article"("required_membership_level_id");

CREATE UNIQUE INDEX "uq_blog_article_public_id" ON "blog_article"("public_id");

CREATE UNIQUE INDEX "uq_blog_article_legacy_url_id" ON "blog_article"("legacy_url_id");

CREATE TABLE "new_collections_project" (
"public_id" TEXT NOT NULL,
"legacy_url_id" INTEGER,
    "id" INTEGER NOT NULL PRIMARY KEY AUTOINCREMENT,
    "project_name" TEXT NOT NULL,
    "avatar" TEXT,
    "weight" INTEGER NOT NULL,
    "status" INTEGER NOT NULL,
    "require_auth" BOOLEAN NOT NULL DEFAULT false,
    "created_at" DATETIME NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "updated_at" DATETIME NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "is_deleted" BOOLEAN NOT NULL DEFAULT false
, "deleted_at" DATETIME, "read_access_mode" TEXT NOT NULL DEFAULT 'PUBLIC', "download_access_mode" TEXT NOT NULL DEFAULT 'FOLLOW_READ');

INSERT INTO "new_collections_project" ("public_id", "legacy_url_id", "id", "project_name", "avatar", "weight", "status", "require_auth", "created_at", "updated_at", "is_deleted", "deleted_at", "read_access_mode", "download_access_mode") SELECT lower(hex(randomblob(4)) || '-' || hex(randomblob(2)) || '-4' || substr(hex(randomblob(2)), 2) || '-' || substr('89ab', (random() & 3) + 1, 1) || substr(hex(randomblob(2)), 2) || '-' || hex(randomblob(6))), "id", "id", "project_name", "avatar", "weight", "status", "require_auth", "created_at", "updated_at", "is_deleted", "deleted_at", "read_access_mode", "download_access_mode" FROM "collections_project";

DROP TABLE "collections_project";

ALTER TABLE "new_collections_project" RENAME TO "collections_project";

CREATE UNIQUE INDEX "uq_collections_project_public_id" ON "collections_project"("public_id");

CREATE UNIQUE INDEX "uq_collections_project_legacy_url_id" ON "collections_project"("legacy_url_id");

CREATE TABLE "new_collections_project_version" (
"public_id" TEXT NOT NULL,
"legacy_url_id" INTEGER,
    "id" INTEGER NOT NULL PRIMARY KEY AUTOINCREMENT,
    "project_id" INTEGER NOT NULL,
    "version" TEXT NOT NULL,
    "description" TEXT,
    "weight" INTEGER NOT NULL,
    "status" INTEGER NOT NULL,
    "created_at" DATETIME NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "updated_at" DATETIME NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "is_deleted" BOOLEAN NOT NULL DEFAULT false, "document_revision" INTEGER NOT NULL DEFAULT 0, "release_id" TEXT, "release_hash" TEXT, "manifest_version" INTEGER, "published_at" DATETIME, "deleted_at" DATETIME, "release_manifest_json" TEXT, "documentation_state_json" TEXT,
    CONSTRAINT "collections_project_version_project_id_fkey" FOREIGN KEY ("project_id") REFERENCES "collections_project" ("id") ON DELETE NO ACTION ON UPDATE NO ACTION
);

INSERT INTO "new_collections_project_version" ("public_id", "legacy_url_id", "id", "project_id", "version", "description", "weight", "status", "created_at", "updated_at", "is_deleted", "document_revision", "release_id", "release_hash", "manifest_version", "published_at", "deleted_at", "release_manifest_json", "documentation_state_json") SELECT lower(hex(randomblob(4)) || '-' || hex(randomblob(2)) || '-4' || substr(hex(randomblob(2)), 2) || '-' || substr('89ab', (random() & 3) + 1, 1) || substr(hex(randomblob(2)), 2) || '-' || hex(randomblob(6))), "id", "id", "project_id", "version", "description", "weight", "status", "created_at", "updated_at", "is_deleted", "document_revision", "release_id", "release_hash", "manifest_version", "published_at", "deleted_at", "release_manifest_json", "documentation_state_json" FROM "collections_project_version";

DROP TABLE "collections_project_version";

ALTER TABLE "new_collections_project_version" RENAME TO "collections_project_version";

CREATE INDEX "idx_collections_project_version_project_id" ON "collections_project_version"("project_id");

CREATE UNIQUE INDEX "uq_collections_project_version_release_id"
ON "collections_project_version"("release_id");

CREATE UNIQUE INDEX "uq_collections_project_version_public_id" ON "collections_project_version"("public_id");

CREATE UNIQUE INDEX "uq_collections_project_version_legacy_url_id" ON "collections_project_version"("legacy_url_id");

CREATE TABLE "new_docs_note_info" (
"public_id" TEXT NOT NULL,
"legacy_url_id" INTEGER,
 "attribution_json" TEXT NOT NULL DEFAULT '{}',
    "id" INTEGER NOT NULL PRIMARY KEY AUTOINCREMENT,
    "category_id" INTEGER NOT NULL,
    "note_title" TEXT NOT NULL,
    "weight" INTEGER NOT NULL,
    "status" INTEGER NOT NULL,
    "content_revision" INTEGER NOT NULL DEFAULT 0,
    "created_at" DATETIME NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "updated_at" DATETIME NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "is_deleted" BOOLEAN NOT NULL DEFAULT false, "author_id" INTEGER, "deleted_at" DATETIME, "tags_json" TEXT,
    CONSTRAINT "docs_note_info_category_id_fkey" FOREIGN KEY ("category_id") REFERENCES "collections_category" ("id") ON DELETE NO ACTION ON UPDATE NO ACTION
,
 CONSTRAINT "docs_note_info_author_id_fkey" FOREIGN KEY ("author_id") REFERENCES "auth_user"("id") ON DELETE SET NULL ON UPDATE NO ACTION
);

INSERT INTO "new_docs_note_info" ("public_id", "legacy_url_id", "attribution_json", "id", "category_id", "note_title", "weight", "status", "content_revision", "created_at", "updated_at", "is_deleted", "author_id", "deleted_at", "tags_json") SELECT lower(hex(randomblob(4)) || '-' || hex(randomblob(2)) || '-4' || substr(hex(randomblob(2)), 2) || '-' || substr('89ab', (random() & 3) + 1, 1) || substr(hex(randomblob(2)), 2) || '-' || hex(randomblob(6))), "id", "attribution_json", "id", "category_id", "note_title", "weight", "status", "content_revision", "created_at", "updated_at", "is_deleted", "author_id", "deleted_at", "tags_json" FROM "docs_note_info";

DROP TABLE "docs_note_info";

ALTER TABLE "new_docs_note_info" RENAME TO "docs_note_info";

CREATE INDEX "idx_docs_note_info_category_id" ON "docs_note_info"("category_id");

CREATE INDEX "idx_docs_note_info_author_id" ON "docs_note_info"("author_id");

CREATE UNIQUE INDEX "uq_docs_note_info_public_id" ON "docs_note_info"("public_id");

CREATE UNIQUE INDEX "uq_docs_note_info_legacy_url_id" ON "docs_note_info"("legacy_url_id");

UPDATE sqlite_sequence SET seq = max(seq, coalesce((SELECT seq FROM public_id_sequences WHERE name = sqlite_sequence.name), 0));

DROP TABLE public_id_sequences;

COMMIT;

PRAGMA foreign_keys=ON;
