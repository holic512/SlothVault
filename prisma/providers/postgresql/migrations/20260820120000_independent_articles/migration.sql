CREATE TABLE "blog_article" (
    "id" SERIAL NOT NULL,
    "title" VARCHAR(255) NOT NULL,
    "summary" VARCHAR(500),
    "cover" VARCHAR(500),
    "content" TEXT NOT NULL,
    "status" SMALLINT NOT NULL DEFAULT 0,
    "published_at" TIMESTAMPTZ(3),
    "created_at" TIMESTAMPTZ(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "updated_at" TIMESTAMPTZ(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "is_deleted" BOOLEAN NOT NULL DEFAULT false,

    CONSTRAINT "blog_article_pkey" PRIMARY KEY ("id")
);

CREATE INDEX "idx_blog_article_public"
ON "blog_article"("status", "is_deleted", "published_at");
