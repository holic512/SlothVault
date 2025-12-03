-- CreateSchema
CREATE SCHEMA IF NOT EXISTS "collections";

-- CreateSchema
CREATE SCHEMA IF NOT EXISTS "docs";

-- CreateTable
CREATE TABLE "collections"."Project" (
    "id" BIGSERIAL NOT NULL,
    "projectName" VARCHAR(128) NOT NULL,
    "weight" INTEGER NOT NULL,
    "status" SMALLINT NOT NULL,
    "requireAuth" BOOLEAN NOT NULL DEFAULT false,
    "createdAt" TIMESTAMPTZ(6) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "updatedAt" TIMESTAMPTZ(6) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "isDeleted" BOOLEAN NOT NULL DEFAULT false,

    CONSTRAINT "Project_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "collections"."ProjectVersion" (
    "id" BIGSERIAL NOT NULL,
    "projectId" BIGINT NOT NULL,
    "version" VARCHAR(64) NOT NULL,
    "description" TEXT,
    "weight" INTEGER NOT NULL,
    "status" SMALLINT NOT NULL,
    "createdAt" TIMESTAMPTZ(6) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "updatedAt" TIMESTAMPTZ(6) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "isDeleted" BOOLEAN NOT NULL DEFAULT false,

    CONSTRAINT "ProjectVersion_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "collections"."Category" (
    "id" BIGSERIAL NOT NULL,
    "projectVersionId" BIGINT NOT NULL,
    "categoryName" VARCHAR(64) NOT NULL,
    "weight" INTEGER NOT NULL,
    "status" SMALLINT NOT NULL,
    "createdAt" TIMESTAMPTZ(6) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "updatedAt" TIMESTAMPTZ(6) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "isDeleted" BOOLEAN NOT NULL DEFAULT false,

    CONSTRAINT "Category_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "docs"."NoteInfo" (
    "id" BIGSERIAL NOT NULL,
    "categoryId" BIGINT NOT NULL,
    "noteTitle" VARCHAR(255) NOT NULL,
    "weight" INTEGER NOT NULL,
    "status" SMALLINT NOT NULL,
    "createdAt" TIMESTAMPTZ(6) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "updatedAt" TIMESTAMPTZ(6) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "isDeleted" BOOLEAN NOT NULL DEFAULT false,

    CONSTRAINT "NoteInfo_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "docs"."NoteContent" (
    "id" BIGSERIAL NOT NULL,
    "noteInfoId" BIGINT NOT NULL,
    "content" TEXT NOT NULL,
    "contentType" VARCHAR(16) NOT NULL,
    "versionNote" VARCHAR(255),
    "isPrimary" BOOLEAN NOT NULL DEFAULT false,
    "status" SMALLINT NOT NULL,
    "createdAt" TIMESTAMPTZ(6) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "updatedAt" TIMESTAMPTZ(6) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "isDeleted" BOOLEAN NOT NULL DEFAULT false,

    CONSTRAINT "NoteContent_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "docs"."NoteAttachment" (
    "id" BIGSERIAL NOT NULL,
    "noteContentId" BIGINT NOT NULL,
    "attachmentName" VARCHAR(255) NOT NULL,
    "attachmentDesc" VARCHAR(1024),
    "localUrl" VARCHAR(2048),
    "lanzouUrl" VARCHAR(2048),
    "baiduUrl" VARCHAR(2048),
    "pan123Url" VARCHAR(2048),
    "quarkUrl" VARCHAR(2048),
    "status" SMALLINT NOT NULL,
    "createdAt" TIMESTAMPTZ(6) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "updatedAt" TIMESTAMPTZ(6) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "isDeleted" BOOLEAN NOT NULL DEFAULT false,

    CONSTRAINT "NoteAttachment_pkey" PRIMARY KEY ("id")
);

-- CreateIndex
CREATE INDEX "idx_project_version_projectid" ON "collections"."ProjectVersion"("projectId");

-- CreateIndex
CREATE INDEX "idx_category_projectversionid" ON "collections"."Category"("projectVersionId");

-- CreateIndex
CREATE INDEX "idx_noteinfo_categoryid" ON "docs"."NoteInfo"("categoryId");

-- CreateIndex
CREATE INDEX "idx_notecontent_noteinfoid" ON "docs"."NoteContent"("noteInfoId");

-- CreateIndex
CREATE INDEX "idx_noteattachment_notecontentid" ON "docs"."NoteAttachment"("noteContentId");

-- AddForeignKey
ALTER TABLE "collections"."ProjectVersion" ADD CONSTRAINT "fk_project_version_project" FOREIGN KEY ("projectId") REFERENCES "collections"."Project"("id") ON DELETE NO ACTION ON UPDATE NO ACTION;

-- AddForeignKey
ALTER TABLE "collections"."Category" ADD CONSTRAINT "fk_category_project_version" FOREIGN KEY ("projectVersionId") REFERENCES "collections"."ProjectVersion"("id") ON DELETE NO ACTION ON UPDATE NO ACTION;

-- AddForeignKey
ALTER TABLE "docs"."NoteInfo" ADD CONSTRAINT "fk_noteinfo_category" FOREIGN KEY ("categoryId") REFERENCES "collections"."Category"("id") ON DELETE NO ACTION ON UPDATE NO ACTION;

-- AddForeignKey
ALTER TABLE "docs"."NoteContent" ADD CONSTRAINT "fk_notecontent_noteinfo" FOREIGN KEY ("noteInfoId") REFERENCES "docs"."NoteInfo"("id") ON DELETE NO ACTION ON UPDATE NO ACTION;

-- AddForeignKey
ALTER TABLE "docs"."NoteAttachment" ADD CONSTRAINT "fk_noteattachment_notecontent" FOREIGN KEY ("noteContentId") REFERENCES "docs"."NoteContent"("id") ON DELETE NO ACTION ON UPDATE NO ACTION;
