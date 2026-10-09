-- AlterTable
ALTER TABLE "commission_contract_template_version" ADD COLUMN     "format" TEXT NOT NULL DEFAULT 'LEGACY';

-- AlterTable
ALTER TABLE "commission" ADD COLUMN     "confirmation_mode" TEXT NOT NULL DEFAULT 'ONLINE',
ADD COLUMN     "maintenance_close_reason" TEXT NOT NULL DEFAULT '',
ADD COLUMN     "maintenance_closed_at" TIMESTAMP(3),
ADD COLUMN     "maintenance_ends_at" TIMESTAMP(3),
ADD COLUMN     "maintenance_started_at" TIMESTAMP(3),
ADD COLUMN     "paused" BOOLEAN NOT NULL DEFAULT false,
ADD COLUMN     "payment_percent" INTEGER NOT NULL DEFAULT 0,
ADD COLUMN     "workflow_version" INTEGER NOT NULL DEFAULT 1,
ALTER COLUMN "subject_user_id" DROP NOT NULL;

-- CreateTable
CREATE TABLE "commission_invitation" (
    "id" SERIAL NOT NULL,
    "commission_id" INTEGER NOT NULL,
    "token_hash" VARCHAR(255) NOT NULL,
    "expires_at" TIMESTAMPTZ(3) NOT NULL,
    "revoked_at" TIMESTAMPTZ(3),
    "claimed_at" TIMESTAMPTZ(3),
    "claimed_by_id" INTEGER,
    "created_at" TIMESTAMPTZ(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,

    CONSTRAINT "commission_invitation_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "commission_agreement" (
    "id" SERIAL NOT NULL,
    "public_id" VARCHAR(255) NOT NULL,
    "commission_id" INTEGER NOT NULL,
    "kind" VARCHAR(255) NOT NULL DEFAULT 'AGREEMENT',
    "status" VARCHAR(255) NOT NULL DEFAULT 'DRAFT',
    "title" VARCHAR(255) NOT NULL,
    "body" TEXT NOT NULL,
    "template_json" TEXT NOT NULL,
    "values_json" TEXT NOT NULL,
    "file_keys_json" TEXT NOT NULL DEFAULT '[]',
    "total_fen" BIGINT,
    "maintenance_days" INTEGER NOT NULL DEFAULT 15,
    "confirmation_mode" VARCHAR(255) NOT NULL DEFAULT 'ONLINE',
    "published_event_id" VARCHAR(255),
    "confirmed_at" TIMESTAMPTZ(3),
    "created_at" TIMESTAMPTZ(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,

    CONSTRAINT "commission_agreement_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "commission_submission" (
    "id" SERIAL NOT NULL,
    "public_id" VARCHAR(255) NOT NULL,
    "commission_id" INTEGER NOT NULL,
    "sequence" INTEGER NOT NULL,
    "command_id" VARCHAR(255) NOT NULL,
    "request_hash" VARCHAR(255) NOT NULL,
    "actor_user_id" INTEGER,
    "type" VARCHAR(255) NOT NULL,
    "snapshot_json" TEXT NOT NULL,
    "snapshot_hash" VARCHAR(255) NOT NULL,
    "previous_hash" VARCHAR(255),
    "proof_revision" INTEGER NOT NULL DEFAULT 0,
    "created_at" TIMESTAMPTZ(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,

    CONSTRAINT "commission_submission_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "commission_proof_attempt" (
    "id" SERIAL NOT NULL,
    "submission_id" INTEGER NOT NULL,
    "network" VARCHAR(255) NOT NULL,
    "issuer_user_id" INTEGER NOT NULL,
    "signer_address" VARCHAR(255) NOT NULL,
    "status" VARCHAR(255) NOT NULL DEFAULT 'PREPARED',
    "memo" TEXT NOT NULL,
    "message_hash" VARCHAR(255) NOT NULL,
    "transaction_base64" TEXT NOT NULL,
    "last_valid_block_height" BIGINT NOT NULL,
    "expires_at" TIMESTAMPTZ(3) NOT NULL,
    "transaction_signature" VARCHAR(255),
    "slot" BIGINT,
    "block_time" TIMESTAMPTZ(3),
    "fee_lamports" BIGINT,
    "error" TEXT,
    "created_at" TIMESTAMPTZ(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "finalized_at" TIMESTAMPTZ(3),

    CONSTRAINT "commission_proof_attempt_pkey" PRIMARY KEY ("id")
);

-- CreateIndex
CREATE UNIQUE INDEX "uq_commission_invitation_token" ON "commission_invitation"("token_hash");

-- CreateIndex
CREATE INDEX "idx_commission_invitation_owner" ON "commission_invitation"("commission_id");

-- CreateIndex
CREATE UNIQUE INDEX "uq_commission_agreement_public" ON "commission_agreement"("public_id");

-- CreateIndex
CREATE INDEX "idx_commission_agreement_owner_status" ON "commission_agreement"("commission_id", "status");

-- CreateIndex
CREATE UNIQUE INDEX "uq_commission_submission_public" ON "commission_submission"("public_id");

-- CreateIndex
CREATE UNIQUE INDEX "uq_commission_submission_sequence" ON "commission_submission"("commission_id", "sequence");

-- CreateIndex
CREATE UNIQUE INDEX "uq_commission_submission_command" ON "commission_submission"("commission_id", "command_id");

-- CreateIndex
CREATE UNIQUE INDEX "uq_commission_proof_signature" ON "commission_proof_attempt"("transaction_signature");

-- CreateIndex
CREATE INDEX "idx_commission_proof_submission_network" ON "commission_proof_attempt"("submission_id", "network");

-- CreateIndex
CREATE INDEX "idx_commission_proof_status" ON "commission_proof_attempt"("status");

-- AddForeignKey
ALTER TABLE "commission_invitation" ADD CONSTRAINT "commission_invitation_commission_id_fkey" FOREIGN KEY ("commission_id") REFERENCES "commission"("id") ON DELETE RESTRICT ON UPDATE NO ACTION;

-- AddForeignKey
ALTER TABLE "commission_agreement" ADD CONSTRAINT "commission_agreement_commission_id_fkey" FOREIGN KEY ("commission_id") REFERENCES "commission"("id") ON DELETE RESTRICT ON UPDATE NO ACTION;

-- AddForeignKey
ALTER TABLE "commission_submission" ADD CONSTRAINT "commission_submission_commission_id_fkey" FOREIGN KEY ("commission_id") REFERENCES "commission"("id") ON DELETE RESTRICT ON UPDATE NO ACTION;

-- AddForeignKey
ALTER TABLE "commission_proof_attempt" ADD CONSTRAINT "commission_proof_attempt_submission_id_fkey" FOREIGN KEY ("submission_id") REFERENCES "commission_submission"("id") ON DELETE RESTRICT ON UPDATE NO ACTION;
