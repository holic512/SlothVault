-- CreateTable
CREATE TABLE "collections"."ProjectHome" (
    "id" BIGSERIAL NOT NULL,
    "projectId" BIGINT NOT NULL,
    "content" TEXT NOT NULL,
    "status" SMALLINT NOT NULL DEFAULT 1,
    "createdAt" TIMESTAMPTZ(6) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "updatedAt" TIMESTAMPTZ(6) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "isDeleted" BOOLEAN NOT NULL DEFAULT false,

    CONSTRAINT "ProjectHome_pkey" PRIMARY KEY ("id")
);

-- CreateIndex
CREATE UNIQUE INDEX "ProjectHome_projectId_key" ON "collections"."ProjectHome"("projectId");

-- CreateIndex
CREATE INDEX "idx_project_home_projectid" ON "collections"."ProjectHome"("projectId");

-- AddForeignKey
ALTER TABLE "collections"."ProjectHome" ADD CONSTRAINT "fk_project_home_project" FOREIGN KEY ("projectId") REFERENCES "collections"."Project"("id") ON DELETE CASCADE ON UPDATE NO ACTION;
