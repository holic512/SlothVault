ALTER TABLE "blog_article" ADD COLUMN "deleted_at" DATETIME;
ALTER TABLE "collections_project" ADD COLUMN "deleted_at" DATETIME;
ALTER TABLE "collections_project_version" ADD COLUMN "deleted_at" DATETIME;
ALTER TABLE "collections_category" ADD COLUMN "deleted_at" DATETIME;
ALTER TABLE "docs_note_info" ADD COLUMN "deleted_at" DATETIME;
ALTER TABLE "docs_note_content" ADD COLUMN "deleted_at" DATETIME;
ALTER TABLE "collections_project_home" ADD COLUMN "deleted_at" DATETIME;
ALTER TABLE "collections_project_menu" ADD COLUMN "deleted_at" DATETIME;
