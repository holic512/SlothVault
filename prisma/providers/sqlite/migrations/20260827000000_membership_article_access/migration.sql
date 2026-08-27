CREATE TABLE "membership_level" (
    "id" INTEGER NOT NULL PRIMARY KEY AUTOINCREMENT,
    "name" TEXT NOT NULL,
    "rank" INTEGER NOT NULL,
    "price_points" INTEGER NOT NULL,
    "validity_days" INTEGER,
    "status" INTEGER NOT NULL DEFAULT 1,
    "created_at" DATETIME NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "updated_at" DATETIME NOT NULL DEFAULT CURRENT_TIMESTAMP,
    CONSTRAINT "uq_membership_level_rank" UNIQUE ("rank")
);

CREATE INDEX "idx_membership_level_status_rank" ON "membership_level"("status", "rank");

CREATE TABLE "membership_grant" (
    "id" INTEGER NOT NULL PRIMARY KEY AUTOINCREMENT,
    "user_id" INTEGER NOT NULL,
    "membership_level_id" INTEGER NOT NULL,
    "source" TEXT NOT NULL,
    "points_cost" INTEGER,
    "granted_by_user_id" INTEGER,
    "granted_at" DATETIME NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "expires_at" DATETIME,
    "revoked_at" DATETIME,
    "revoked_by_user_id" INTEGER,
    CONSTRAINT "membership_grant_user_id_fkey" FOREIGN KEY ("user_id") REFERENCES "auth_user"("id") ON DELETE RESTRICT ON UPDATE NO ACTION,
    CONSTRAINT "membership_grant_level_id_fkey" FOREIGN KEY ("membership_level_id") REFERENCES "membership_level"("id") ON DELETE RESTRICT ON UPDATE NO ACTION,
    CONSTRAINT "membership_grant_granted_by_user_id_fkey" FOREIGN KEY ("granted_by_user_id") REFERENCES "auth_user"("id") ON DELETE SET NULL ON UPDATE NO ACTION,
    CONSTRAINT "membership_grant_revoked_by_user_id_fkey" FOREIGN KEY ("revoked_by_user_id") REFERENCES "auth_user"("id") ON DELETE SET NULL ON UPDATE NO ACTION
);

CREATE INDEX "idx_membership_grant_user_active" ON "membership_grant"("user_id", "revoked_at", "expires_at");
CREATE INDEX "idx_membership_grant_level" ON "membership_grant"("membership_level_id");

ALTER TABLE "blog_article" ADD COLUMN "required_membership_level_id" INTEGER REFERENCES "membership_level"("id") ON DELETE RESTRICT ON UPDATE NO ACTION;
CREATE INDEX "idx_blog_article_required_membership_level" ON "blog_article"("required_membership_level_id");
