-- CreateTable
CREATE TABLE "file_management" (
    "id" BIGSERIAL NOT NULL,
    "original_name" VARCHAR(255) NOT NULL,
    "file_name" VARCHAR(255) NOT NULL,
    "file_path" VARCHAR(500) NOT NULL,
    "file_size" BIGINT NOT NULL,
    "business_type" VARCHAR(50) NOT NULL,
    "status" SMALLINT NOT NULL DEFAULT 1,
    "create_time" TIMESTAMP(6) NOT NULL DEFAULT CURRENT_TIMESTAMP,

    CONSTRAINT "file_management_pkey" PRIMARY KEY ("id")
);
