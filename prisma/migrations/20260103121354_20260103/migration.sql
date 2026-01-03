-- CreateTable
CREATE TABLE "collections"."ProjectMenu" (
    "id" BIGSERIAL NOT NULL,
    "projectId" BIGINT NOT NULL,
    "parentId" BIGINT,
    "label" VARCHAR(64) NOT NULL,
    "url" VARCHAR(2048),
    "isExternal" BOOLEAN NOT NULL DEFAULT false,
    "weight" INTEGER NOT NULL DEFAULT 0,
    "status" SMALLINT NOT NULL DEFAULT 1,
    "createdAt" TIMESTAMPTZ(6) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "updatedAt" TIMESTAMPTZ(6) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "isDeleted" BOOLEAN NOT NULL DEFAULT false,

    CONSTRAINT "ProjectMenu_pkey" PRIMARY KEY ("id")
);

-- CreateIndex
CREATE INDEX "idx_project_menu_projectid" ON "collections"."ProjectMenu"("projectId");

-- CreateIndex
CREATE INDEX "idx_project_menu_parentid" ON "collections"."ProjectMenu"("parentId");

-- AddForeignKey
ALTER TABLE "collections"."ProjectMenu" ADD CONSTRAINT "fk_project_menu_project" FOREIGN KEY ("projectId") REFERENCES "collections"."Project"("id") ON DELETE CASCADE ON UPDATE NO ACTION;

-- AddForeignKey
ALTER TABLE "collections"."ProjectMenu" ADD CONSTRAINT "fk_project_menu_parent" FOREIGN KEY ("parentId") REFERENCES "collections"."ProjectMenu"("id") ON DELETE CASCADE ON UPDATE NO ACTION;
