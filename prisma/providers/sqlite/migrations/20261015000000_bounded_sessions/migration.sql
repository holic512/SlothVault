-- Old sessions are deliberately revoked once; no user or credential data is removed.
ALTER TABLE "auth_session" ADD COLUMN "persistent" BOOLEAN NOT NULL DEFAULT false;
UPDATE "auth_session" SET "revoked_at" = strftime('%Y-%m-%dT%H:%M:%fZ', 'now') WHERE "revoked_at" IS NULL;
