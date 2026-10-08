ALTER TABLE "collections_project" ADD COLUMN "read_access_mode" TEXT NOT NULL DEFAULT 'PUBLIC';
ALTER TABLE "collections_project" ADD COLUMN "download_access_mode" TEXT NOT NULL DEFAULT 'FOLLOW_READ';

CREATE TABLE "article_membership" (
  "article_id" INTEGER NOT NULL,
  "membership_level_id" INTEGER NOT NULL,
  PRIMARY KEY ("article_id", "membership_level_id"),
  CONSTRAINT "article_membership_parent_fkey" FOREIGN KEY ("article_id") REFERENCES "blog_article" ("id") ON DELETE CASCADE ON UPDATE NO ACTION,
  CONSTRAINT "article_membership_level_fkey" FOREIGN KEY ("membership_level_id") REFERENCES "membership_level" ("id") ON DELETE RESTRICT ON UPDATE NO ACTION
);
CREATE INDEX "idx_article_membership_level" ON "article_membership" ("membership_level_id");

CREATE TABLE "project_read_membership" (
  "project_id" INTEGER NOT NULL,
  "membership_level_id" INTEGER NOT NULL,
  PRIMARY KEY ("project_id", "membership_level_id"),
  CONSTRAINT "project_read_membership_parent_fkey" FOREIGN KEY ("project_id") REFERENCES "collections_project" ("id") ON DELETE CASCADE ON UPDATE NO ACTION,
  CONSTRAINT "project_read_membership_level_fkey" FOREIGN KEY ("membership_level_id") REFERENCES "membership_level" ("id") ON DELETE RESTRICT ON UPDATE NO ACTION
);
CREATE INDEX "idx_project_read_membership_level" ON "project_read_membership" ("membership_level_id");

CREATE TABLE "project_download_membership" (
  "project_id" INTEGER NOT NULL,
  "membership_level_id" INTEGER NOT NULL,
  PRIMARY KEY ("project_id", "membership_level_id"),
  CONSTRAINT "project_download_membership_parent_fkey" FOREIGN KEY ("project_id") REFERENCES "collections_project" ("id") ON DELETE CASCADE ON UPDATE NO ACTION,
  CONSTRAINT "project_download_membership_level_fkey" FOREIGN KEY ("membership_level_id") REFERENCES "membership_level" ("id") ON DELETE RESTRICT ON UPDATE NO ACTION
);
CREATE INDEX "idx_project_download_membership_level" ON "project_download_membership" ("membership_level_id");

CREATE TABLE "files_file_reference" (
  "id" INTEGER NOT NULL PRIMARY KEY AUTOINCREMENT,
  "file_id" INTEGER NOT NULL,
  "source_type" TEXT NOT NULL,
  "source_id" INTEGER NOT NULL,
  "project_id" INTEGER,
  "usage" TEXT NOT NULL,
  CONSTRAINT "files_file_reference_file_id_fkey" FOREIGN KEY ("file_id") REFERENCES "files_file_management" ("id") ON DELETE CASCADE ON UPDATE NO ACTION,
  CONSTRAINT "files_file_reference_project_id_fkey" FOREIGN KEY ("project_id") REFERENCES "collections_project" ("id") ON DELETE CASCADE ON UPDATE NO ACTION
);
CREATE UNIQUE INDEX "uq_file_reference_source_usage" ON "files_file_reference" ("file_id", "source_type", "source_id", "usage");
CREATE INDEX "idx_file_reference_source" ON "files_file_reference" ("source_type", "source_id");
CREATE INDEX "idx_file_reference_project" ON "files_file_reference" ("project_id");

-- Snapshot the formerly eligible types without changing any body, grant or release hash.
INSERT INTO "article_membership" ("article_id", "membership_level_id")
SELECT a."id", eligible."id"
FROM "blog_article" a
JOIN "membership_level" required_level ON required_level."id" = a."required_membership_level_id"
JOIN "membership_level" eligible ON eligible."rank" >= required_level."rank";
