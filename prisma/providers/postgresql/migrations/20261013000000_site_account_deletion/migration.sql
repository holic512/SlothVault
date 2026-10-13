-- Account references are attribution, not ownership. Frozen evidence bytes are retained.

ALTER TABLE "points_transaction" ADD COLUMN "attribution_json" TEXT NOT NULL DEFAULT '{}';

ALTER TABLE "points_gift_card_batch" ADD COLUMN "attribution_json" TEXT NOT NULL DEFAULT '{}';

ALTER TABLE "points_gift_card_batch" DROP CONSTRAINT "points_gift_card_batch_created_by_id_fkey";

ALTER TABLE "points_gift_card_batch" ALTER COLUMN "created_by_id" DROP NOT NULL;

ALTER TABLE "points_gift_card_batch" ADD CONSTRAINT "points_gift_card_batch_created_by_id_fkey" FOREIGN KEY ("created_by_id") REFERENCES "auth_user"("id") ON DELETE SET NULL ON UPDATE NO ACTION;

ALTER TABLE "membership_grant" ADD COLUMN "attribution_json" TEXT NOT NULL DEFAULT '{}';

ALTER TABLE "membership_grant" DROP CONSTRAINT "membership_grant_granted_by_user_id_fkey";

ALTER TABLE "membership_grant" ALTER COLUMN "granted_by_user_id" DROP NOT NULL;

ALTER TABLE "membership_grant" ADD CONSTRAINT "membership_grant_granted_by_user_id_fkey" FOREIGN KEY ("granted_by_user_id") REFERENCES "auth_user"("id") ON DELETE SET NULL ON UPDATE NO ACTION;

ALTER TABLE "membership_grant" DROP CONSTRAINT "membership_grant_revoked_by_user_id_fkey";

ALTER TABLE "membership_grant" ALTER COLUMN "revoked_by_user_id" DROP NOT NULL;

ALTER TABLE "membership_grant" ADD CONSTRAINT "membership_grant_revoked_by_user_id_fkey" FOREIGN KEY ("revoked_by_user_id") REFERENCES "auth_user"("id") ON DELETE SET NULL ON UPDATE NO ACTION;

ALTER TABLE "docs_note_info" ADD COLUMN "attribution_json" TEXT NOT NULL DEFAULT '{}';

ALTER TABLE "docs_note_info" ALTER COLUMN "author_id" DROP NOT NULL;

ALTER TABLE "docs_note_info" ADD CONSTRAINT "docs_note_info_author_id_fkey" FOREIGN KEY ("author_id") REFERENCES "auth_user"("id") ON DELETE SET NULL ON UPDATE NO ACTION;

ALTER TABLE "contract" ADD COLUMN "attribution_json" TEXT NOT NULL DEFAULT '{}';

ALTER TABLE "contract" DROP CONSTRAINT "contract_issuer_user_id_fkey";

ALTER TABLE "contract" ALTER COLUMN "issuer_user_id" DROP NOT NULL;

ALTER TABLE "contract" ADD CONSTRAINT "contract_issuer_user_id_fkey" FOREIGN KEY ("issuer_user_id") REFERENCES "auth_user"("id") ON DELETE SET NULL ON UPDATE NO ACTION;

ALTER TABLE "contract_admin_audit" ADD COLUMN "attribution_json" TEXT NOT NULL DEFAULT '{}';

ALTER TABLE "contract_admin_audit" DROP CONSTRAINT "contract_admin_audit_actor_user_id_fkey";

ALTER TABLE "contract_admin_audit" ALTER COLUMN "actor_user_id" DROP NOT NULL;

ALTER TABLE "contract_admin_audit" ADD CONSTRAINT "contract_admin_audit_actor_user_id_fkey" FOREIGN KEY ("actor_user_id") REFERENCES "auth_user"("id") ON DELETE SET NULL ON UPDATE NO ACTION;

ALTER TABLE "contract_credential" ADD COLUMN "attribution_json" TEXT NOT NULL DEFAULT '{}';

ALTER TABLE "contract_credential" DROP CONSTRAINT "contract_credential_issuer_user_id_fkey";

ALTER TABLE "contract_credential" ALTER COLUMN "issuer_user_id" DROP NOT NULL;

ALTER TABLE "contract_credential" ADD CONSTRAINT "contract_credential_issuer_user_id_fkey" FOREIGN KEY ("issuer_user_id") REFERENCES "auth_user"("id") ON DELETE SET NULL ON UPDATE NO ACTION;

ALTER TABLE "contract_credential_attempt" ADD COLUMN "attribution_json" TEXT NOT NULL DEFAULT '{}';

ALTER TABLE "contract_credential_attempt" DROP CONSTRAINT "contract_credential_attempt_issuer_user_id_fkey";

ALTER TABLE "contract_credential_attempt" ALTER COLUMN "issuer_user_id" DROP NOT NULL;

ALTER TABLE "contract_credential_attempt" ADD CONSTRAINT "contract_credential_attempt_issuer_user_id_fkey" FOREIGN KEY ("issuer_user_id") REFERENCES "auth_user"("id") ON DELETE SET NULL ON UPDATE NO ACTION;

ALTER TABLE "release_credential" ADD COLUMN "attribution_json" TEXT NOT NULL DEFAULT '{}';

ALTER TABLE "release_credential" DROP CONSTRAINT "release_credential_issuer_user_id_fkey";

ALTER TABLE "release_credential" ALTER COLUMN "issuer_user_id" DROP NOT NULL;

ALTER TABLE "release_credential" ADD CONSTRAINT "release_credential_issuer_user_id_fkey" FOREIGN KEY ("issuer_user_id") REFERENCES "auth_user"("id") ON DELETE SET NULL ON UPDATE NO ACTION;

ALTER TABLE "release_credential_attempt" ADD COLUMN "attribution_json" TEXT NOT NULL DEFAULT '{}';

ALTER TABLE "release_credential_attempt" DROP CONSTRAINT "release_credential_attempt_issuer_user_id_fkey";

ALTER TABLE "release_credential_attempt" ALTER COLUMN "issuer_user_id" DROP NOT NULL;

ALTER TABLE "release_credential_attempt" ADD CONSTRAINT "release_credential_attempt_issuer_user_id_fkey" FOREIGN KEY ("issuer_user_id") REFERENCES "auth_user"("id") ON DELETE SET NULL ON UPDATE NO ACTION;

ALTER TABLE "commission_payment" ADD COLUMN "attribution_json" TEXT NOT NULL DEFAULT '{}';

ALTER TABLE "commission_payment" ALTER COLUMN "created_by_id" DROP NOT NULL;

ALTER TABLE "commission_payment" ADD CONSTRAINT "commission_payment_created_by_id_fkey" FOREIGN KEY ("created_by_id") REFERENCES "auth_user"("id") ON DELETE SET NULL ON UPDATE NO ACTION;

ALTER TABLE "commission_payment" ALTER COLUMN "confirmed_by_id" DROP NOT NULL;

ALTER TABLE "commission_payment" ADD CONSTRAINT "commission_payment_confirmed_by_id_fkey" FOREIGN KEY ("confirmed_by_id") REFERENCES "auth_user"("id") ON DELETE SET NULL ON UPDATE NO ACTION;

ALTER TABLE "commission_change" ADD COLUMN "attribution_json" TEXT NOT NULL DEFAULT '{}';

ALTER TABLE "commission_change" ALTER COLUMN "created_by_id" DROP NOT NULL;

ALTER TABLE "commission_change" ADD CONSTRAINT "commission_change_created_by_id_fkey" FOREIGN KEY ("created_by_id") REFERENCES "auth_user"("id") ON DELETE SET NULL ON UPDATE NO ACTION;

ALTER TABLE "commission_issue" ADD COLUMN "attribution_json" TEXT NOT NULL DEFAULT '{}';

ALTER TABLE "commission_issue" ALTER COLUMN "created_by_id" DROP NOT NULL;

ALTER TABLE "commission_issue" ADD CONSTRAINT "commission_issue_created_by_id_fkey" FOREIGN KEY ("created_by_id") REFERENCES "auth_user"("id") ON DELETE SET NULL ON UPDATE NO ACTION;

ALTER TABLE "commission_file" ADD COLUMN "attribution_json" TEXT NOT NULL DEFAULT '{}';

ALTER TABLE "commission_file" ALTER COLUMN "uploader_user_id" DROP NOT NULL;

ALTER TABLE "commission_file" ADD CONSTRAINT "commission_file_uploader_user_id_fkey" FOREIGN KEY ("uploader_user_id") REFERENCES "auth_user"("id") ON DELETE SET NULL ON UPDATE NO ACTION;

ALTER TABLE "commission_event" ADD COLUMN "attribution_json" TEXT NOT NULL DEFAULT '{}';

ALTER TABLE "commission_event" DROP CONSTRAINT "commission_event_actor_user_id_fkey";

ALTER TABLE "commission_event" ALTER COLUMN "actor_user_id" DROP NOT NULL;

ALTER TABLE "commission_event" ADD CONSTRAINT "commission_event_actor_user_id_fkey" FOREIGN KEY ("actor_user_id") REFERENCES "auth_user"("id") ON DELETE SET NULL ON UPDATE NO ACTION;

ALTER TABLE "commission_submission" ADD COLUMN "attribution_json" TEXT NOT NULL DEFAULT '{}';

ALTER TABLE "commission_submission" ALTER COLUMN "actor_user_id" DROP NOT NULL;

ALTER TABLE "commission_submission" ADD CONSTRAINT "commission_submission_actor_user_id_fkey" FOREIGN KEY ("actor_user_id") REFERENCES "auth_user"("id") ON DELETE SET NULL ON UPDATE NO ACTION;

ALTER TABLE "commission_proof_attempt" ADD COLUMN "attribution_json" TEXT NOT NULL DEFAULT '{}';

ALTER TABLE "commission_proof_attempt" ALTER COLUMN "issuer_user_id" DROP NOT NULL;

ALTER TABLE "commission_proof_attempt" ADD CONSTRAINT "commission_proof_attempt_issuer_user_id_fkey" FOREIGN KEY ("issuer_user_id") REFERENCES "auth_user"("id") ON DELETE SET NULL ON UPDATE NO ACTION;

ALTER TABLE "commission_invitation" ALTER COLUMN "claimed_by_id" DROP NOT NULL;

ALTER TABLE "commission_invitation" ADD CONSTRAINT "commission_invitation_claimed_by_id_fkey" FOREIGN KEY ("claimed_by_id") REFERENCES "auth_user"("id") ON DELETE RESTRICT ON UPDATE NO ACTION;

CREATE TABLE "auth_user_deletion_record" ("id" SERIAL NOT NULL, "public_id" TEXT NOT NULL, "username" TEXT NOT NULL, "user_snapshot_json" TEXT NOT NULL, "actor_snapshot_json" TEXT NOT NULL, "summary_json" TEXT NOT NULL, "user_created_at" TIMESTAMP(3) NOT NULL, "deleted_at" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP, PRIMARY KEY ("id"));

CREATE UNIQUE INDEX "uq_auth_user_deletion_public_id" ON "auth_user_deletion_record"("public_id");

CREATE INDEX "idx_auth_user_deletion_deleted_at" ON "auth_user_deletion_record"("deleted_at");
