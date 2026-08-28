CREATE TABLE "knowledge_package" (
    "id" INTEGER NOT NULL PRIMARY KEY AUTOINCREMENT,
    "project_version_id" INTEGER NOT NULL,
    "package_kind" TEXT NOT NULL,
    "title" TEXT NOT NULL,
    "summary" TEXT,
    "schema_version" INTEGER NOT NULL,
    "package_hash" TEXT NOT NULL,
    "manifest" TEXT NOT NULL,
    "created_at" DATETIME NOT NULL DEFAULT CURRENT_TIMESTAMP,
    CONSTRAINT "knowledge_package_project_version_id_fkey" FOREIGN KEY ("project_version_id") REFERENCES "collections_project_version"("id") ON DELETE CASCADE ON UPDATE NO ACTION
);

CREATE INDEX "idx_knowledge_package_project_version_id" ON "knowledge_package"("project_version_id");

CREATE TABLE "knowledge_article" (
    "id" INTEGER NOT NULL PRIMARY KEY AUTOINCREMENT,
    "package_id" INTEGER NOT NULL,
    "note_info_id" INTEGER NOT NULL,
    "external_id" TEXT NOT NULL,
    "slug" TEXT NOT NULL,
    "article_type" TEXT NOT NULL,
    "summary" TEXT,
    "tags_json" TEXT NOT NULL,
    "source_references_json" TEXT NOT NULL,
    "created_at" DATETIME NOT NULL DEFAULT CURRENT_TIMESTAMP,
    CONSTRAINT "uq_knowledge_article_note_info_id" UNIQUE ("note_info_id"),
    CONSTRAINT "uq_knowledge_article_package_external_id" UNIQUE ("package_id", "external_id"),
    CONSTRAINT "knowledge_article_package_id_fkey" FOREIGN KEY ("package_id") REFERENCES "knowledge_package"("id") ON DELETE CASCADE ON UPDATE NO ACTION,
    CONSTRAINT "knowledge_article_note_info_id_fkey" FOREIGN KEY ("note_info_id") REFERENCES "docs_note_info"("id") ON DELETE CASCADE ON UPDATE NO ACTION
);

CREATE INDEX "idx_knowledge_article_package_id" ON "knowledge_article"("package_id");
